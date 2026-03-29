import { useEffect, useRef } from 'react'
import { Application, Graphics } from 'pixi.js'
import type { Room, FinishMaterial } from '@/types'

interface Props {
  room: Room
  finishMaterials: FinishMaterial[]
}

// 2:1 isometric projection constants
// Width direction (room X, going right):  screen (+T, -T/2) per metre
// Depth direction (room Y, going back):   screen (-T, -T/2) per metre
const T = 64   // pixels per metre (horizontal scale)

// Wall height in pixels from ceiling_height_cm.
// Vertical scale = T * 0.6 px/m  (compressed for isometric perspective)
function wallHeightPx(ceiling_height_cm: number): number {
  return Math.round((ceiling_height_cm / 100) * T * 0.6)
}

function hexToPixi(hex: string): number {
  return parseInt(hex.replace('#', '0x'), 16)
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function getFinishColor(
  room: Room,
  finishMaterials: FinishMaterial[],
  type: 'wall' | 'floor' | 'door' | 'window' | 'lighting',
  fallback: number,
): number {
  const id = room.finishes?.[type]?.material_id
  if (id) {
    const mat = finishMaterials.find((m) => m.id === id && m.type === type)
    if (mat?.thumbnail_path.startsWith('#')) return hexToPixi(mat.thumbnail_path)
  }
  return fallback
}

function blendColor(base: number, overlay: number, amount: number): number {
  const br = (base >> 16) & 0xFF, bg = (base >> 8) & 0xFF, bb = base & 0xFF
  const or = (overlay >> 16) & 0xFF, og = (overlay >> 8) & 0xFF, ob = overlay & 0xFF
  return (
    (Math.round(br + (or - br) * amount) << 16) |
    (Math.round(bg + (og - bg) * amount) << 8) |
    Math.round(bb + (ob - bb) * amount)
  )
}

/**
 * Compute the 4 floor corners of an isometric parallelogram centered at (cx, cy).
 *
 * In 2:1 isometric:
 *   Width axis  → screen (+T,  -T/2) per metre  (right and UP)
 *   Depth axis  → screen (-T,  -T/2) per metre  (left  and UP)
 */
function computeFloorVertices(W: number, D: number, cx: number, cy: number) {
  const fx = cx - (W - D) * T / 2
  const fy = cy + (W + D) * T / 4

  return {
    front: { x: fx,               y: fy },
    right: { x: fx + W * T,       y: fy - W * T / 2 },
    back:  { x: fx + (W - D) * T, y: fy - (W + D) * T / 2 },
    left:  { x: fx - D * T,       y: fy - D * T / 2 },
  }
}

function drawRoom(app: Application, room: Room, finishMaterials: FinishMaterial[]) {
  app.stage.removeChildren()

  const sw = app.screen.width
  const sh = app.screen.height

  const W = room.width_cm / 100   // metres
  const D = room.height_cm / 100  // metres (schema calls this height_cm = depth)

  const wallH = wallHeightPx(room.ceiling_height_cm)

  const cx = sw / 2
  const cy = sh / 2 + wallH / 2

  const v = computeFloorVertices(W, D, cx, cy)

  const wallColor    = getFinishColor(room, finishMaterials, 'wall',    0xECE9E4)
  const floorColor   = getFinishColor(room, finishMaterials, 'floor',   0xD4CFC8)
  const doorColor    = getFinishColor(room, finishMaterials, 'door',    0xC8A882)
  const windowColor  = getFinishColor(room, finishMaterials, 'window',  0xE8EDF0)
  const lightColor   = getFinishColor(room, finishMaterials, 'lighting', 0xFFE4A0)

  const edgeStroke = { color: 0xB8B3AC, width: 1 }

  // ── 1. Left back wall (depth D) ──────────────────────────────────────────
  const leftWall = new Graphics()
  leftWall.poly([
    v.back.x,  v.back.y,
    v.left.x,  v.left.y,
    v.left.x,  v.left.y  - wallH,
    v.back.x,  v.back.y  - wallH,
  ])
  leftWall.fill({ color: blendColor(wallColor, 0x000000, 0.10) })
  leftWall.stroke(edgeStroke)
  app.stage.addChild(leftWall)

  // ── 2. Right back wall (width W) ─────────────────────────────────────────
  const rightWall = new Graphics()
  rightWall.poly([
    v.back.x,  v.back.y,
    v.right.x, v.right.y,
    v.right.x, v.right.y - wallH,
    v.back.x,  v.back.y  - wallH,
  ])
  rightWall.fill({ color: blendColor(wallColor, 0xFFFFFF, 0.10) })
  rightWall.stroke(edgeStroke)
  app.stage.addChild(rightWall)

  // ── 3. Floor ─────────────────────────────────────────────────────────────
  const floor = new Graphics()
  floor.poly([
    v.front.x, v.front.y,
    v.right.x, v.right.y,
    v.back.x,  v.back.y,
    v.left.x,  v.left.y,
  ])
  floor.fill({ color: floorColor })
  floor.stroke(edgeStroke)
  app.stage.addChild(floor)

  // ── 4. Door on left wall (depth direction), centered ─────────────────────
  // Door: ~0.8 m wide, ~2.1 m tall (82% of wall height)
  const DOOR_W_M = Math.min(0.8, D * 0.4)
  const DOOR_H   = wallH * 0.82
  const dt0 = Math.max(0.08, 0.5 - DOOR_W_M / 2 / D)
  const dt1 = Math.min(0.92, 0.5 + DOOR_W_M / 2 / D)
  const dbl = lerp(v.back, v.left, dt0)
  const dbr = lerp(v.back, v.left, dt1)

  const door = new Graphics()
  door.poly([
    dbl.x, dbl.y,
    dbr.x, dbr.y,
    dbr.x, dbr.y - DOOR_H,
    dbl.x, dbl.y - DOOR_H,
  ])
  door.fill({ color: doorColor })
  door.stroke({ color: blendColor(doorColor, 0x000000, 0.30), width: 1.5 })
  app.stage.addChild(door)

  // Door handle — small circle on the opening side (right edge, mid height)
  const handleBase = lerp(dbl, dbr, 0.82)
  const handle = new Graphics()
  handle.circle(handleBase.x, handleBase.y - DOOR_H * 0.45, 2.5)
  handle.fill({ color: blendColor(doorColor, 0x000000, 0.45) })
  app.stage.addChild(handle)

  // ── 5. Window on right wall (width direction), centered ──────────────────
  // Window: ~1.0 m wide, sill at 0.75 m, top at 1.95 m (30%–78% of wall height)
  const WIN_W_M   = Math.min(1.0, W * 0.4)
  const WIN_SILL  = wallH * 0.30
  const WIN_TOP   = wallH * 0.78
  const wt0 = Math.max(0.08, 0.5 - WIN_W_M / 2 / W)
  const wt1 = Math.min(0.92, 0.5 + WIN_W_M / 2 / W)
  const wbl = lerp(v.back, v.right, wt0)
  const wbr = lerp(v.back, v.right, wt1)

  // Glass pane
  const windowGlass = new Graphics()
  windowGlass.poly([
    wbl.x, wbl.y - WIN_SILL,
    wbr.x, wbr.y - WIN_SILL,
    wbr.x, wbr.y - WIN_TOP,
    wbl.x, wbl.y - WIN_TOP,
  ])
  windowGlass.fill({ color: 0xC8E8F4, alpha: 0.65 })
  app.stage.addChild(windowGlass)

  // Window frame
  const windowFrame = new Graphics()
  windowFrame.poly([
    wbl.x, wbl.y - WIN_SILL,
    wbr.x, wbr.y - WIN_SILL,
    wbr.x, wbr.y - WIN_TOP,
    wbl.x, wbl.y - WIN_TOP,
  ])
  windowFrame.fill({ color: 0x000000, alpha: 0 })
  windowFrame.stroke({ color: windowColor, width: 2.5 })
  app.stage.addChild(windowFrame)

  // ── 6. Lighting fixture at ceiling center ────────────────────────────────
  // Ceiling center = floor centroid raised by wallH (centroid of floor = cx, cy)
  const lightX = cx
  const lightY = cy - wallH

  const glow = new Graphics()
  glow.circle(lightX, lightY, 22)
  glow.fill({ color: lightColor, alpha: 0.18 })
  app.stage.addChild(glow)

  const fixture = new Graphics()
  fixture.circle(lightX, lightY, 5)
  fixture.fill({ color: lightColor })
  fixture.stroke({ color: blendColor(lightColor, 0x000000, 0.30), width: 1 })
  app.stage.addChild(fixture)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function IsometricCanvas({ room, finishMaterials }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)

  // Keep latest props accessible inside the async init without re-running it
  const roomRef = useRef(room)
  const materialsRef = useRef(finishMaterials)
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { materialsRef.current = finishMaterials }, [finishMaterials])

  // Init PixiJS once; draw immediately once init resolves
  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    let cancelled = false

    const init = async () => {
      const app = new Application()
      await app.init({
        width: container.clientWidth,
        height: container.clientHeight,
        background: 0xF5F3EF,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })
      if (cancelled) { app.destroy(true); return }
      container.appendChild(app.canvas)
      appRef.current = app
      drawRoom(app, roomRef.current, materialsRef.current)
    }

    init()

    return () => {
      cancelled = true
      appRef.current?.destroy(true)
      appRef.current = null
    }
  }, [])

  // Redraw whenever room data or finishes change after init
  useEffect(() => {
    if (!appRef.current) return
    drawRoom(appRef.current, room, finishMaterials)
  }, [room, finishMaterials])

  return (
    <>
      <div ref={containerRef} className="pixi-container" />
      <style>{`
        .pixi-container { width: 100%; height: 100%; }
        .pixi-container canvas { display: block; width: 100% !important; height: 100% !important; }
      `}</style>
    </>
  )
}
