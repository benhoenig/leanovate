/**
 * renderConstructionDrawings.ts
 *
 * Renders construction working drawings on plain HTML5 Canvas 2D:
 *   - Floor plan (top-down orthographic with dimension lines)
 *   - Wall elevations (head-on view per wall segment with door/window cutouts)
 *
 * Assembled into a multi-page PDF via jsPDF for contractor handoff.
 */

import { jsPDF } from 'jspdf'
import type { Room, RoomVertex, RoomDoor, RoomWindow, RoomGeometry } from '@/types'
import { getVertices, wallSegmentLength } from '@/lib/roomGeometry'

// ── Constants ────────────────────────────────────────────────────────────────

const DPR = 2 // 2x resolution for print quality
const LINE_COLOR = '#1a1a1a'
const DIM_COLOR = '#444444'
const THIN_LINE = 1
const WALL_LINE = 2.5
const DIM_FONT = '11px Inter, sans-serif'
const TITLE_FONT = 'bold 14px Inter, sans-serif'
const SUBTITLE_FONT = '12px Inter, sans-serif'
const DIM_OFFSET = 30 // px offset for dimension lines from wall
const DIM_TICK = 6 // tick mark length

// ── Floor Plan ───────────────────────────────────────────────────────────────

export function renderFloorPlan(
  room: Room,
  projectName: string,
  scale: number, // e.g. 50 means 1:50
): HTMLCanvasElement {
  const vertices = getVertices(room)
  const geo = room.geometry as RoomGeometry

  // Scale so room fits in ~700px wide
  const us = vertices.map(v => v.u)
  const vs = vertices.map(v => v.v)
  const roomW = (Math.max(...us) - Math.min(...us)) // in metres
  const roomD = (Math.max(...vs) - Math.min(...vs))
  const minU = Math.min(...us)
  const minV = Math.min(...vs)

  const targetSize = 700
  const fitScale = targetSize / Math.max(roomW, roomD)
  const pxPerM = fitScale

  const margin = 100
  const canvasW = Math.ceil(roomW * pxPerM + margin * 2)
  const canvasH = Math.ceil(roomD * pxPerM + margin * 2 + 60) // extra for title block

  const canvas = document.createElement('canvas')
  canvas.width = canvasW * DPR
  canvas.height = canvasH * DPR
  const ctx = canvas.getContext('2d')!
  ctx.scale(DPR, DPR)

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)

  // Transform: room coords to canvas coords
  const toX = (u: number) => margin + (u - minU) * pxPerM
  const toY = (v: number) => margin + (v - minV) * pxPerM

  // Draw room outline
  ctx.strokeStyle = LINE_COLOR
  ctx.lineWidth = WALL_LINE
  ctx.lineJoin = 'miter'
  ctx.lineCap = 'butt'

  // Collect door/window positions for wall gap rendering
  const doors = geo.doors ?? []
  const windows = geo.windows ?? []

  // Draw each wall segment (with door gaps)
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]

    // Find doors and windows on this wall
    const wallDoors = doors.filter(d => d.wall_index === i)
    const wallWindows = windows.filter(w => w.wall_index === i)

    // Compute wall vector
    const wallLen = wallSegmentLength(a, b)
    const dx = b.u - a.u
    const dy = b.v - a.v

    // Collect "gaps" in the wall for doors
    const gaps: { start: number; end: number; type: 'door' | 'window' }[] = []
    for (const door of wallDoors) {
      const halfW = (door.width_m / 2) / wallLen
      gaps.push({
        start: Math.max(0, door.position - halfW),
        end: Math.min(1, door.position + halfW),
        type: 'door',
      })
    }

    // Sort gaps by position
    gaps.sort((a, b) => a.start - b.start)

    // Draw wall as segments between gaps
    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = WALL_LINE
    let t = 0
    for (const gap of gaps) {
      if (gap.start > t) {
        drawSegment(ctx, a, dx, dy, t, gap.start, toX, toY)
      }
      t = gap.end
    }
    if (t < 1) {
      drawSegment(ctx, a, dx, dy, t, 1, toX, toY)
    }

    // Draw door swing arcs
    for (const door of wallDoors) {
      drawDoorArc(ctx, a, b, door, pxPerM, toX, toY)
    }

    // Draw windows (double-line marks on wall)
    for (const win of wallWindows) {
      drawWindowMark(ctx, a, b, win, toX, toY)
    }
  }

  // Draw dimension lines on all wall segments
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    drawDimensionLine(ctx, toX(a.u), toY(a.v), toX(b.u), toY(b.v), wallSegmentLength(a, b) * 100, margin)
  }

  // Title block
  const titleY = canvasH - 30
  ctx.fillStyle = LINE_COLOR
  ctx.font = TITLE_FONT
  ctx.textAlign = 'left'
  ctx.fillText(`${room.name} — Floor Plan`, margin, titleY)

  ctx.font = SUBTITLE_FONT
  ctx.fillStyle = DIM_COLOR
  ctx.textAlign = 'right'
  ctx.fillText(`${projectName}  |  Scale 1:${scale}  |  ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`, canvasW - margin, titleY)

  return canvas
}

// ── Elevation View ───────────────────────────────────────────────────────────

export function renderElevation(
  room: Room,
  wallIndex: number,
  projectName: string,
  scale: number,
): HTMLCanvasElement {
  const vertices = getVertices(room)
  const geo = room.geometry as RoomGeometry
  const a = vertices[wallIndex]
  const b = vertices[(wallIndex + 1) % vertices.length]

  const wallLen = wallSegmentLength(a, b) // metres
  const ceilingH = (room.ceiling_height_cm || 260) / 100 // metres

  // Scale to fit canvas
  const targetW = 700
  const pxPerM = targetW / Math.max(wallLen, ceilingH * 0.8)

  const margin = 80
  const wallPxW = wallLen * pxPerM
  const wallPxH = ceilingH * pxPerM
  const canvasW = Math.ceil(wallPxW + margin * 2)
  const canvasH = Math.ceil(wallPxH + margin * 2 + 60)

  const canvas = document.createElement('canvas')
  canvas.width = canvasW * DPR
  canvas.height = canvasH * DPR
  const ctx = canvas.getContext('2d')!
  ctx.scale(DPR, DPR)

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)

  // Wall coordinates in elevation space
  const wallLeft = margin
  const wallTop = margin
  const wallRight = margin + wallPxW
  const wallBottom = margin + wallPxH

  // Draw wall rectangle
  ctx.strokeStyle = LINE_COLOR
  ctx.lineWidth = WALL_LINE
  ctx.strokeRect(wallLeft, wallTop, wallPxW, wallPxH)

  // Find doors/windows on this wall
  const doors = (geo.doors ?? []).filter(d => d.wall_index === wallIndex)
  const windows = (geo.windows ?? []).filter(w => w.wall_index === wallIndex)

  // Draw door cutouts
  for (const door of doors) {
    const doorW = door.width_m * pxPerM
    const doorH = (door.height_m ?? ceilingH * 0.82) * pxPerM
    const centerX = wallLeft + door.position * wallPxW
    const x = centerX - doorW / 2
    const y = wallBottom - doorH

    // Draw door opening (dashed rectangle)
    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = THIN_LINE
    ctx.setLineDash([4, 3])
    ctx.strokeRect(x, y, doorW, doorH)
    ctx.setLineDash([])

    // Door width dimension
    drawHorizontalDim(ctx, x, x + doorW, wallBottom + 15, door.width_m * 100)

    // Door height dimension
    drawVerticalDim(ctx, x - 15, y, wallBottom, (door.height_m ?? ceilingH * 0.82) * 100)
  }

  // Draw window cutouts
  for (const win of windows) {
    const winW = win.width_m * pxPerM
    const sillH = (win.sill_m ?? ceilingH * 0.30) * pxPerM
    const winH = (win.height_m ?? ceilingH * 0.48) * pxPerM
    const centerX = wallLeft + win.position * wallPxW
    const x = centerX - winW / 2
    const y = wallBottom - sillH - winH

    // Draw window opening
    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = THIN_LINE
    ctx.strokeRect(x, y, winW, winH)

    // Cross lines in window
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + winW, y + winH)
    ctx.moveTo(x + winW, y)
    ctx.lineTo(x, y + winH)
    ctx.stroke()

    // Window width dimension
    drawHorizontalDim(ctx, x, x + winW, y - 15, win.width_m * 100)

    // Sill height dimension (from floor)
    drawVerticalDim(ctx, x + winW + 15, wallBottom - sillH, wallBottom, (win.sill_m ?? ceilingH * 0.30) * 100)

    // Window height dimension
    drawVerticalDim(ctx, x + winW + 15, y, y + winH, (win.height_m ?? ceilingH * 0.48) * 100)
  }

  // Overall wall width dimension (top)
  drawHorizontalDim(ctx, wallLeft, wallRight, wallTop - 25, wallLen * 100)

  // Ceiling height dimension (right side)
  drawVerticalDim(ctx, wallRight + 30, wallTop, wallBottom, ceilingH * 100)

  // Title block
  const titleY = canvasH - 30
  ctx.fillStyle = LINE_COLOR
  ctx.font = TITLE_FONT
  ctx.textAlign = 'left'
  ctx.fillText(`${room.name} — Wall ${wallIndex + 1} Elevation`, margin, titleY)

  ctx.font = SUBTITLE_FONT
  ctx.fillStyle = DIM_COLOR
  ctx.textAlign = 'right'
  ctx.fillText(`${projectName}  |  Scale 1:${scale}  |  ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`, canvasW - margin, titleY)

  return canvas
}

// ── PDF Export ────────────────────────────────────────────────────────────────

export async function exportConstructionPDF(
  room: Room,
  projectName: string,
): Promise<Blob> {
  const vertices = getVertices(room)
  const numWalls = vertices.length

  // Auto-calculate scale
  const us = vertices.map(v => v.u)
  const vs = vertices.map(v => v.v)
  const roomW = Math.max(...us) - Math.min(...us)
  const roomD = Math.max(...vs) - Math.min(...vs)
  const maxDim = Math.max(roomW, roomD)

  // Choose scale: 1:25 for small rooms, 1:50 for medium, 1:100 for large
  let scale = 50
  if (maxDim < 3) scale = 25
  else if (maxDim > 8) scale = 100

  // Page 1: Floor plan (landscape A4)
  const floorCanvas = renderFloorPlan(room, projectName, scale)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Fit floor plan canvas to A4 landscape (297 x 210 mm)
  const fpAspect = floorCanvas.width / floorCanvas.height
  const pageW = 277 // 297 - 20 margin
  const pageH = 190 // 210 - 20 margin
  let fpW = pageW
  let fpH = fpW / fpAspect
  if (fpH > pageH) { fpH = pageH; fpW = fpH * fpAspect }

  const fpImg = floorCanvas.toDataURL('image/png')
  doc.addImage(fpImg, 'PNG', (297 - fpW) / 2, (210 - fpH) / 2, fpW, fpH)

  // Pages 2..N: one elevation per wall
  for (let i = 0; i < numWalls; i++) {
    doc.addPage('a4', 'portrait')
    const elevCanvas = renderElevation(room, i, projectName, scale)
    const elAspect = elevCanvas.width / elevCanvas.height
    const elPageW = 170 // 210 - 40 margin
    const elPageH = 257 // 297 - 40 margin
    let elW = elPageW
    let elH = elW / elAspect
    if (elH > elPageH) { elH = elPageH; elW = elH * elAspect }

    const elImg = elevCanvas.toDataURL('image/png')
    doc.addImage(elImg, 'PNG', (210 - elW) / 2, (297 - elH) / 2, elW, elH)
  }

  return doc.output('blob')
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

function drawSegment(
  ctx: CanvasRenderingContext2D,
  a: RoomVertex, dx: number, dy: number,
  t0: number, t1: number,
  toX: (u: number) => number, toY: (v: number) => number,
) {
  ctx.beginPath()
  ctx.moveTo(toX(a.u + dx * t0), toY(a.v + dy * t0))
  ctx.lineTo(toX(a.u + dx * t1), toY(a.v + dy * t1))
  ctx.stroke()
}

function drawDoorArc(
  ctx: CanvasRenderingContext2D,
  a: RoomVertex, b: RoomVertex,
  door: RoomDoor,
  pxPerM: number,
  toX: (u: number) => number, toY: (v: number) => number,
) {
  const wallLen = wallSegmentLength(a, b)
  const dx = (b.u - a.u) / wallLen
  const dy = (b.v - a.v) / wallLen
  // Normal pointing inward (into the room for CCW winding)
  const nx = -dy
  const ny = dx

  const halfW = door.width_m / 2
  // Hinge side: left edge of door
  const hingeT = door.position - halfW / wallLen
  const hingeU = a.u + (b.u - a.u) * hingeT
  const hingeV = a.v + (b.v - a.v) * hingeT

  const radius = door.width_m * pxPerM
  const hingeX = toX(hingeU)
  const hingeY = toY(hingeV)

  ctx.strokeStyle = DIM_COLOR
  ctx.lineWidth = THIN_LINE
  ctx.setLineDash([3, 3])
  ctx.beginPath()

  // Screen-space angles (Canvas Y is inverted)
  const screenWallAngle = Math.atan2(-(dy), dx)
  const screenInwardAngle = Math.atan2(-(ny), nx)

  ctx.arc(hingeX, hingeY, radius, screenWallAngle, screenInwardAngle, false)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawWindowMark(
  ctx: CanvasRenderingContext2D,
  a: RoomVertex, b: RoomVertex,
  win: RoomWindow,
  toX: (u: number) => number, toY: (v: number) => number,
) {
  const wallLen = wallSegmentLength(a, b)
  const dx = (b.u - a.u) / wallLen
  const dy = (b.v - a.v) / wallLen
  const nx = -dy, ny = dx // inward normal

  const halfW = win.width_m / 2
  const t0 = win.position - halfW / wallLen
  const t1 = win.position + halfW / wallLen

  const x0 = toX(a.u + (b.u - a.u) * t0)
  const y0 = toY(a.v + (b.v - a.v) * t0)
  const x1 = toX(a.u + (b.u - a.u) * t1)
  const y1 = toY(a.v + (b.v - a.v) * t1)

  // Double-line perpendicular to wall (architectural convention)
  const offset = 4
  const nxPx = nx * offset, nyPx = -ny * offset // screen-space (y-inverted)

  ctx.strokeStyle = LINE_COLOR
  ctx.lineWidth = WALL_LINE * 0.8
  // Outer line
  ctx.beginPath()
  ctx.moveTo(x0 + nxPx, y0 + nyPx)
  ctx.lineTo(x1 + nxPx, y1 + nyPx)
  ctx.stroke()
  // Inner line
  ctx.beginPath()
  ctx.moveTo(x0 - nxPx, y0 - nyPx)
  ctx.lineTo(x1 - nxPx, y1 - nyPx)
  ctx.stroke()
  // End caps
  ctx.lineWidth = THIN_LINE
  ctx.beginPath()
  ctx.moveTo(x0 + nxPx, y0 + nyPx)
  ctx.lineTo(x0 - nxPx, y0 - nyPx)
  ctx.moveTo(x1 + nxPx, y1 + nyPx)
  ctx.lineTo(x1 - nxPx, y1 - nyPx)
  ctx.stroke()
}

function drawDimensionLine(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number,
  x1: number, y1: number,
  valueCm: number,
  _margin: number,
) {
  const dx = x1 - x0, dy = y1 - y0
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 5) return

  // Normal pointing outward from room center (heuristic: offset away from center)
  const nx = -dy / len, ny = dx / len

  // Offset the dimension line outside the polygon
  const off = DIM_OFFSET
  const ax = x0 + nx * off, ay = y0 + ny * off
  const bx = x1 + nx * off, by = y1 + ny * off

  ctx.strokeStyle = DIM_COLOR
  ctx.lineWidth = 0.7

  // Extension lines
  ctx.beginPath()
  ctx.moveTo(x0 + nx * 8, y0 + ny * 8)
  ctx.lineTo(ax + nx * 4, ay + ny * 4)
  ctx.moveTo(x1 + nx * 8, y1 + ny * 8)
  ctx.lineTo(bx + nx * 4, by + ny * 4)
  ctx.stroke()

  // Dimension line
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.stroke()

  // Tick marks at ends (perpendicular to dimension line)
  const tdx = dx / len, tdy = dy / len
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(ax - tdx * 0 + nx * DIM_TICK / 2, ay - tdy * 0 + ny * DIM_TICK / 2)
  ctx.lineTo(ax - tdx * 0 - nx * DIM_TICK / 2, ay - tdy * 0 - ny * DIM_TICK / 2)
  ctx.moveTo(bx + tdx * 0 + nx * DIM_TICK / 2, by + tdy * 0 + ny * DIM_TICK / 2)
  ctx.lineTo(bx + tdx * 0 - nx * DIM_TICK / 2, by + tdy * 0 - ny * DIM_TICK / 2)
  ctx.stroke()

  // Label
  const midX = (ax + bx) / 2, midY = (ay + by) / 2
  const label = `${Math.round(valueCm)} cm`
  ctx.fillStyle = DIM_COLOR
  ctx.font = DIM_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Rotate text to align with dimension line
  const angle = Math.atan2(dy, dx)
  ctx.save()
  ctx.translate(midX + nx * 10, midY + ny * 10)
  // Flip text if it would be upside-down
  const displayAngle = (angle > Math.PI / 2 || angle < -Math.PI / 2) ? angle + Math.PI : angle
  ctx.rotate(displayAngle)
  ctx.fillText(label, 0, 0)
  ctx.restore()
}

function drawHorizontalDim(
  ctx: CanvasRenderingContext2D,
  x0: number, x1: number,
  y: number,
  valueCm: number,
) {
  ctx.strokeStyle = DIM_COLOR
  ctx.lineWidth = 0.7

  // Dimension line
  ctx.beginPath()
  ctx.moveTo(x0, y)
  ctx.lineTo(x1, y)
  ctx.stroke()

  // Ticks
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x0, y - DIM_TICK / 2)
  ctx.lineTo(x0, y + DIM_TICK / 2)
  ctx.moveTo(x1, y - DIM_TICK / 2)
  ctx.lineTo(x1, y + DIM_TICK / 2)
  ctx.stroke()

  // Label
  const label = `${Math.round(valueCm)} cm`
  ctx.fillStyle = DIM_COLOR
  ctx.font = DIM_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(label, (x0 + x1) / 2, y - 3)
}

function drawVerticalDim(
  ctx: CanvasRenderingContext2D,
  x: number,
  y0: number, y1: number,
  valueCm: number,
) {
  ctx.strokeStyle = DIM_COLOR
  ctx.lineWidth = 0.7

  // Dimension line
  ctx.beginPath()
  ctx.moveTo(x, y0)
  ctx.lineTo(x, y1)
  ctx.stroke()

  // Ticks
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - DIM_TICK / 2, y0)
  ctx.lineTo(x + DIM_TICK / 2, y0)
  ctx.moveTo(x - DIM_TICK / 2, y1)
  ctx.lineTo(x + DIM_TICK / 2, y1)
  ctx.stroke()

  // Label (rotated 90°)
  const label = `${Math.round(valueCm)} cm`
  ctx.fillStyle = DIM_COLOR
  ctx.font = DIM_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.save()
  ctx.translate(x - 6, (y0 + y1) / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText(label, 0, 0)
  ctx.restore()
}
