import { useEffect, useRef, useCallback } from 'react'
import { Application, Graphics, Sprite, Texture, Container, Assets, Text } from 'pixi.js'
import type { Room, FinishMaterial, PlacedFurniture, Direction, RoomGeometry, RoomVertex } from '@/types'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { supabase } from '@/lib/supabase'
import {
  getVertices, computeBoundingBox, pointInPolygon, nearestPointOnPolygon,
  polygonCentroid, wallSegmentLength, rotateVertices, rotatePoint, unrotatePoint,
  isWallVisible, isWallLeftFacing, migrateFixtureWallIndex,
  computeFront, roomToScreen, screenToRoom,
} from '@/lib/roomGeometry'

interface Props {
  room: Room
  finishMaterials: FinishMaterial[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const T = 64
const SPRITE_SIZE = 512
const DIRECTIONS: Direction[] = ['front_left', 'front_right', 'back_right', 'back_left']

// ── Visible wall info for hit testing ─────────────────────────────────────────

interface VisibleWallInfo {
  wallIndex: number
  screenA: { x: number; y: number }
  screenB: { x: number; y: number }
  quad: { x: number; y: number }[]
  lengthM: number
}

// ── Hit testing helpers ───────────────────────────────────────────────────────

function pointInConvexQuad(px: number, py: number, q: { x: number; y: number }[]): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4]
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)
    if (cross > 0) { if (sign < 0) return false; sign = 1 }
    else if (cross < 0) { if (sign > 0) return false; sign = -1 }
  }
  return true
}

function projectOnSegment(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return 0
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  return Math.max(0, Math.min(1, t))
}

// ── Isometric math ────────────────────────────────────────────────────────────

function wallHeightPx(ceilingCm: number): number {
  return Math.round((ceilingCm / 100) * T * 0.6)
}

function hexToPixi(hex: string): number {
  return parseInt(hex.replace('#', '0x'), 16)
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function getFinishColor(
  room: Room, materials: FinishMaterial[],
  type: 'wall' | 'floor' | 'door' | 'window' | 'lighting', fallback: number,
): number {
  const id = room.finishes?.[type]?.material_id
  if (id) {
    const mat = materials.find((m) => m.id === id && m.type === type)
    if (mat?.thumbnail_path.startsWith('#')) return hexToPixi(mat.thumbnail_path)
  }
  return fallback
}

function blendColor(base: number, overlay: number, amount: number): number {
  const br = (base >> 16) & 0xFF, bg = (base >> 8) & 0xFF, bb = base & 0xFF
  const or_ = (overlay >> 16) & 0xFF, og = (overlay >> 8) & 0xFF, ob = overlay & 0xFF
  return (
    (Math.round(br + (or_ - br) * amount) << 16) |
    (Math.round(bg + (og - bg) * amount) << 8) |
    Math.round(bb + (ob - bb) * amount)
  )
}

function apparentDirection(itemDir: Direction, rotation: Direction): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(itemDir) + DIRECTIONS.indexOf(rotation)) % 4]
}

// ── Sprite helpers ────────────────────────────────────────────────────────────

function getSpriteUrl(variantId: string, direction: Direction): string | null {
  const sprites = useCatalogStore.getState().getSpritesForVariant(variantId)
  const sprite = sprites.find((s) => s.direction === direction)
  if (!sprite) return null
  return supabase.storage.from('sprites').getPublicUrl(sprite.image_path).data.publicUrl
}

function getFallbackUrl(variantId: string, itemId: string): string | null {
  const variants = useCatalogStore.getState().getVariantsForItem(itemId)
  const v = variants.find((x) => x.id === variantId)
  return v?.clean_image_url ?? v?.original_image_url ?? null
}

// ── Room drawing (polygon-based) ─────────────────────────────────────────────

function drawRoomShell(
  container: Container, room: Room, materials: FinishMaterial[],
  rot: Direction, cx: number, cy: number,
  onFixtureClick?: (id: string) => void,
  selectedFixtureId?: string | null,
) {
  container.removeChildren()

  // Get polygon vertices and rotate
  const origVerts = getVertices(room)
  const bboxW = Math.max(...origVerts.map(v => v.u)) - Math.min(...origVerts.map(v => v.u))
  const bboxD = Math.max(...origVerts.map(v => v.v)) - Math.min(...origVerts.map(v => v.v))
  const rotVerts = rotateVertices(origVerts, bboxW, bboxD, rot)

  // Compute effective bounding box of rotated vertices
  const effW = Math.max(...rotVerts.map(v => v.u)) - Math.min(...rotVerts.map(v => v.u))
  const effD = Math.max(...rotVerts.map(v => v.v)) - Math.min(...rotVerts.map(v => v.v))

  const wallH = wallHeightPx(room.ceiling_height_cm)
  const front = computeFront(effW, effD, cx, cy)

  const wallColor  = getFinishColor(room, materials, 'wall', 0xECE9E4)
  const floorColor = getFinishColor(room, materials, 'floor', 0xD4CFC8)
  const doorColor  = getFinishColor(room, materials, 'door', 0xC8A882)
  const winColor   = getFinishColor(room, materials, 'window', 0xE8EDF0)
  const lightColor = getFinishColor(room, materials, 'lighting', 0xFFE4A0)
  const stroke = { color: 0xB8B3AC, width: 1 }

  // ── Find visible walls and sort back-to-front ─────────────────────────
  const visibleWalls: VisibleWallInfo[] = []
  for (let i = 0; i < rotVerts.length; i++) {
    const a = rotVerts[i], b = rotVerts[(i + 1) % rotVerts.length]
    // Use rotated vertices for visibility check (rotation is front_left in rotated space)
    if (!isWallVisible(a, b, 'front_left')) continue
    const sa = roomToScreen(a.u, a.v, front)
    const sb = roomToScreen(b.u, b.v, front)
    visibleWalls.push({
      wallIndex: i,
      screenA: { x: sa.sx, y: sa.sy },
      screenB: { x: sb.sx, y: sb.sy },
      quad: [
        { x: sa.sx, y: sa.sy },
        { x: sb.sx, y: sb.sy },
        { x: sb.sx, y: sb.sy - wallH },
        { x: sa.sx, y: sa.sy - wallH },
      ],
      lengthM: wallSegmentLength(origVerts[i], origVerts[(i + 1) % origVerts.length]),
    })
  }

  // Sort by midpoint depth (smaller u+v = further back = draw first)
  visibleWalls.sort((a, b) => {
    const ai = a.wallIndex, bi = b.wallIndex
    const midA = (rotVerts[ai].u + rotVerts[(ai + 1) % rotVerts.length].u) / 2 +
                 (rotVerts[ai].v + rotVerts[(ai + 1) % rotVerts.length].v) / 2
    const midB = (rotVerts[bi].u + rotVerts[(bi + 1) % rotVerts.length].u) / 2 +
                 (rotVerts[bi].v + rotVerts[(bi + 1) % rotVerts.length].v) / 2
    return midA - midB
  })

  // ── Draw walls (back to front) ────────────────────────────────────────
  for (const wall of visibleWalls) {
    const origA = origVerts[wall.wallIndex]
    const origB = origVerts[(wall.wallIndex + 1) % origVerts.length]
    const leftFacing = isWallLeftFacing(origA, origB)
    const shade = leftFacing
      ? blendColor(wallColor, 0x000000, 0.10)
      : blendColor(wallColor, 0xFFFFFF, 0.10)

    const g = new Graphics()
    g.poly([
      wall.screenA.x, wall.screenA.y,
      wall.screenB.x, wall.screenB.y,
      wall.screenB.x, wall.screenB.y - wallH,
      wall.screenA.x, wall.screenA.y - wallH,
    ])
    g.fill({ color: shade }); g.stroke(stroke)
    container.addChild(g)
  }

  // ── Draw floor polygon ────────────────────────────────────────────────
  const fl = new Graphics()
  const floorPts: number[] = []
  for (const v of rotVerts) {
    const s = roomToScreen(v.u, v.v, front)
    floorPts.push(s.sx, s.sy)
  }
  fl.poly(floorPts)
  fl.fill({ color: floorColor }); fl.stroke(stroke)
  container.addChild(fl)

  // ── Render fixtures on visible walls ──────────────────────────────────
  const geo = room.geometry as RoomGeometry
  const doors = geo?.doors ?? []
  const windows = geo?.windows ?? []
  const pxPerM = T * 0.6

  const renderFixture = (
    id: string, wallIndex: number, position: number, widthM: number,
    type: 'door' | 'window', heightM?: number, sillM?: number,
    curtainStyle?: string, curtainColor?: string,
  ) => {
    // Find this wall in visible walls
    const vw = visibleWalls.find(w => w.wallIndex === wallIndex)
    if (!vw) return // not visible in this rotation

    const halfT = (widthM / 2) / vw.lengthM
    const t0 = Math.max(0.02, position - halfT)
    const t1 = Math.min(0.98, position + halfT)
    const bl = lerp(vw.screenA, vw.screenB, t0)
    const br = lerp(vw.screenA, vw.screenB, t1)

    const isSelected = id === selectedFixtureId

    if (type === 'door') {
      const dH = heightM != null ? heightM * pxPerM : wallH * 0.82
      const g = new Graphics()
      g.poly([bl.x, bl.y, br.x, br.y, br.x, br.y - dH, bl.x, bl.y - dH])
      g.fill({ color: doorColor })
      g.stroke({ color: isSelected ? 0x2BA8A0 : blendColor(doorColor, 0x000000, 0.30), width: isSelected ? 2.5 : 1.5 })
      g.eventMode = 'static'; g.cursor = 'pointer'
      g.on('pointerdown', (e: { stopPropagation: () => void }) => { e.stopPropagation(); onFixtureClick?.(id) })
      container.addChild(g)
      const hb = lerp(bl, br, 0.82)
      const hd = new Graphics(); hd.circle(hb.x, hb.y - dH * 0.45, 2.5)
      hd.fill({ color: blendColor(doorColor, 0x000000, 0.45) }); container.addChild(hd)
    } else {
      const sillPx = sillM != null ? sillM * pxPerM : wallH * 0.30
      const topPx = heightM != null ? sillPx + heightM * pxPerM : wallH * 0.78
      const wg = new Graphics()
      wg.poly([bl.x, bl.y - sillPx, br.x, br.y - sillPx, br.x, br.y - topPx, bl.x, bl.y - topPx])
      wg.fill({ color: 0xC8E8F4, alpha: 0.65 })
      wg.eventMode = 'static'; wg.cursor = 'pointer'
      wg.on('pointerdown', (e: { stopPropagation: () => void }) => { e.stopPropagation(); onFixtureClick?.(id) })
      container.addChild(wg)
      const wf = new Graphics()
      wf.poly([bl.x, bl.y - sillPx, br.x, br.y - sillPx, br.x, br.y - topPx, bl.x, bl.y - topPx])
      wf.fill({ color: 0x000000, alpha: 0 })
      wf.stroke({ color: isSelected ? 0x2BA8A0 : winColor, width: isSelected ? 3 : 2.5 })
      wf.eventMode = 'none'
      container.addChild(wf)

      // ── Curtain rendering ──
      const cStyle = curtainStyle ?? 'none'
      if (cStyle !== 'none') {
        const cHex = curtainColor ?? '#F5F0E8'
        const cColor = parseInt(cHex.slice(1), 16)
        const cDark = blendColor(cColor, 0x000000, 0.35)
        const rodY = Math.min(bl.y, br.y) - topPx - 5

        // Rod
        const rod = new Graphics()
        rod.moveTo(bl.x - 4, rodY).lineTo(br.x + 4, rodY)
        rod.stroke({ color: cDark, width: 2 })
        rod.circle(bl.x - 4, rodY, 2.5).fill({ color: cDark })
        rod.circle(br.x + 4, rodY, 2.5).fill({ color: cDark })
        rod.eventMode = 'none'
        container.addChild(rod)

        if (cStyle === 'closed') {
          // Full fabric covering window
          const curtain = new Graphics()
          curtain.poly([bl.x, rodY, br.x, rodY, br.x, br.y - sillPx + 6, bl.x, bl.y - sillPx + 6])
          curtain.fill({ color: cColor, alpha: 0.85 })
          curtain.eventMode = 'none'
          container.addChild(curtain)

          // Fold lines
          const folds = new Graphics()
          const numFolds = 5
          for (let i = 1; i < numFolds; i++) {
            const t = i / numFolds
            const fx = bl.x + (br.x - bl.x) * t
            const fy1 = rodY
            const fy2Base = bl.y + (br.y - bl.y) * t
            const fy2 = fy2Base - sillPx + 6
            folds.moveTo(fx, fy1).lineTo(fx, fy2)
          }
          folds.stroke({ color: cDark, width: 1, alpha: 0.2 })
          folds.eventMode = 'none'
          container.addChild(folds)
        } else {
          // Open curtain — two bunched panels at sides
          const panelFrac = 0.15
          const bottomL = bl.y - sillPx + 6
          const bottomR = br.y - sillPx + 6
          const innerL = bl.x + (br.x - bl.x) * panelFrac
          const innerR = br.x - (br.x - bl.x) * panelFrac
          const innerBottomL = bl.y + (br.y - bl.y) * panelFrac - sillPx + 6
          const innerBottomR = br.y - (br.y - bl.y) * panelFrac - sillPx + 6

          // Left panel
          const lp = new Graphics()
          lp.poly([bl.x, rodY, innerL, rodY, innerL, innerBottomL, bl.x, bottomL])
          lp.fill({ color: cColor, alpha: 0.85 })
          lp.eventMode = 'none'
          container.addChild(lp)

          // Left panel fold
          const lfold = new Graphics()
          const lmx = (bl.x + innerL) / 2
          const lmb = (bottomL + innerBottomL) / 2
          lfold.moveTo(lmx, rodY).lineTo(lmx, lmb)
          lfold.stroke({ color: cDark, width: 1, alpha: 0.25 })
          lfold.eventMode = 'none'
          container.addChild(lfold)

          // Left tieback
          const tieY = rodY + (bottomL - rodY) * 0.6
          const ltie = new Graphics()
          ltie.moveTo(bl.x + 1, tieY).lineTo(innerL - 1, tieY)
          ltie.stroke({ color: cDark, width: 1.5 })
          ltie.eventMode = 'none'
          container.addChild(ltie)

          // Right panel
          const rp = new Graphics()
          rp.poly([innerR, rodY, br.x, rodY, br.x, bottomR, innerR, innerBottomR])
          rp.fill({ color: cColor, alpha: 0.85 })
          rp.eventMode = 'none'
          container.addChild(rp)

          // Right panel fold
          const rfold = new Graphics()
          const rmx = (innerR + br.x) / 2
          const rmb = (innerBottomR + bottomR) / 2
          rfold.moveTo(rmx, rodY).lineTo(rmx, rmb)
          rfold.stroke({ color: cDark, width: 1, alpha: 0.25 })
          rfold.eventMode = 'none'
          container.addChild(rfold)

          // Right tieback
          const tieYR = rodY + (bottomR - rodY) * 0.6
          const rtie = new Graphics()
          rtie.moveTo(innerR + 1, tieYR).lineTo(br.x - 1, tieYR)
          rtie.stroke({ color: cDark, width: 1.5 })
          rtie.eventMode = 'none'
          container.addChild(rtie)
        }
      }
    }
  }

  for (const door of doors) {
    const wi = migrateFixtureWallIndex(door)
    renderFixture(door.id, wi, door.position, door.width_m, 'door', door.height_m)
  }
  for (const win of windows) {
    const wi = migrateFixtureWallIndex(win)
    renderFixture(win.id, wi, win.position, win.width_m, 'window', win.height_m, win.sill_m, win.curtain_style, win.curtain_color)
  }

  // ── Lighting at polygon centroid ──────────────────────────────────────
  const centroid = polygonCentroid(rotVerts)
  const cScreen = roomToScreen(centroid.u, centroid.v, front)
  const glow = new Graphics(); glow.circle(cScreen.sx, cScreen.sy - wallH, 22)
  glow.fill({ color: lightColor, alpha: 0.18 }); container.addChild(glow)
  const fix = new Graphics(); fix.circle(cScreen.sx, cScreen.sy - wallH, 5)
  fix.fill({ color: lightColor })
  fix.stroke({ color: blendColor(lightColor, 0x000000, 0.30), width: 1 })
  container.addChild(fix)

  return { front, wallH, visibleWalls, rotatedVertices: rotVerts, bboxW, bboxD }
}

// ── Furniture drawing ─────────────────────────────────────────────────────────

const textureCache = new Map<string, Texture>()

async function loadTex(url: string): Promise<Texture> {
  const cached = textureCache.get(url)
  if (cached && !cached.destroyed) return cached
  try {
    const tex = await Assets.load(url)
    textureCache.set(url, tex)
    return tex
  } catch { return Texture.EMPTY }
}

function getItemScale(itemId: string, variantId: string): number {
  const cat = useCatalogStore.getState()
  const variants = cat.getVariantsForItem(itemId)
  const variant = variants.find((v) => v.id === variantId)
  const item = cat.items.find((i) => i.id === itemId)
  const maxCm = Math.max(
    variant?.width_cm ?? item?.width_cm ?? 60,
    variant?.depth_cm ?? item?.depth_cm ?? 60,
    variant?.height_cm ?? item?.height_cm ?? 60,
  )
  return (maxCm / 100) * T / SPRITE_SIZE
}

async function drawFurnitureLayer(
  container: Container,
  items: PlacedFurniture[],
  rot: Direction,
  front: { x: number; y: number },
  bboxW: number, bboxD: number,
  selectedId: string | null,
  onSelect: (id: string) => void,
  onDragStart: (id: string) => void,
) {
  container.removeChildren()

  // Depth sort: back items first (smaller u+v in rotated space)
  const sorted = [...items].sort((a, b) => {
    const at = rotatePoint(a.x, a.y, bboxW, bboxD, rot)
    const bt = rotatePoint(b.x, b.y, bboxW, bboxD, rot)
    return (at.u + at.v) - (bt.u + bt.v)
  })

  for (const item of sorted) {
    const dir = apparentDirection(item.direction, rot)
    const url = getSpriteUrl(item.selected_variant_id, dir)
      ?? getFallbackUrl(item.selected_variant_id, item.furniture_item_id)
    if (!url) continue

    const tex = await loadTex(url)
    if (tex === Texture.EMPTY) continue

    const spr = new Sprite(tex)
    spr.anchor.set(0.5, 0.85)
    spr.scale.set(getItemScale(item.furniture_item_id, item.selected_variant_id))

    const rp = rotatePoint(item.x, item.y, bboxW, bboxD, rot)
    const pos = roomToScreen(rp.u, rp.v, front)
    spr.position.set(pos.sx, pos.sy)

    spr.eventMode = 'static'
    spr.cursor = 'pointer'

    const id = item.id
    spr.on('pointerdown', (e: { stopPropagation: () => void }) => {
      e.stopPropagation()
      onSelect(id)
      onDragStart(id)
    })

    // Selection highlight
    if (item.id === selectedId) {
      const highlight = new Graphics()
      const hw = spr.width * 0.6, hh = hw * 0.5
      highlight.ellipse(0, 0, hw, hh)
      highlight.fill({ color: 0x2BA8A0, alpha: 0.2 })
      highlight.position.set(pos.sx, pos.sy + 4)
      container.addChild(highlight)
    }

    container.addChild(spr)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function IsometricCanvas({ room, finishMaterials }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const roomLayerRef = useRef<Container | null>(null)
  const furnitureLayerRef = useRef<Container | null>(null)
  const shapeLayerRef = useRef<Container | null>(null)
  const ghostRef = useRef<Sprite | null>(null)
  const frontRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const bboxRef = useRef<{ W: number; D: number }>({ W: 3, D: 3 })
  const wallHRef = useRef(0)
  const visibleWallsRef = useRef<VisibleWallInfo[]>([])
  const rotatedVertsRef = useRef<RoomVertex[]>([])

  const dragRef = useRef<{ active: boolean; itemId: string | null }>({
    active: false, itemId: null,
  })
  const fixtureDragRef = useRef<{
    active: boolean; fixtureId: string; type: 'door' | 'window'; originalGeo: RoomGeometry
  } | null>(null)
  const vertexDragRef = useRef<{ active: boolean; vertexIndex: number } | null>(null)
  const wallDragRef = useRef<{
    active: boolean
    insertedIdx1: number       // index of first inserted vertex (A')
    insertedIdx2: number       // index of second inserted vertex (B')
    normalU: number
    normalV: number
    startA: RoomVertex         // initial position of A' (same as original corner A)
    startB: RoomVertex         // initial position of B' (same as original corner B)
    startMouseU: number
    startMouseV: number
    originalGeo: RoomGeometry  // for undo if no movement
    originalWidthCm: number
    originalHeightCm: number
  } | null>(null)

  const roomRef = useRef(room)
  const matsRef = useRef(finishMaterials)
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { matsRef.current = finishMaterials }, [finishMaterials])

  const redraw = useCallback(async () => {
    const app = appRef.current
    const rl = roomLayerRef.current
    const fl = furnitureLayerRef.current
    if (!app || !rl || !fl) return

    const sw = app.screen.width, sh = app.screen.height
    const wallH = wallHeightPx(roomRef.current.ceiling_height_cm)
    const cx = sw / 2, cy = sh / 2 + wallH / 2
    const state = useCanvasStore.getState()

    const result = drawRoomShell(
      rl, roomRef.current, matsRef.current, state.roomRotation, cx, cy,
      (id) => {
        // Sims-style: click fixture to pick it up; click again to place
        if (fixtureDragRef.current?.active) {
          const wasSame = fixtureDragRef.current.fixtureId === id
          useProjectStore.getState().updateRoom(roomRef.current.id, { geometry: roomRef.current.geometry })
          fixtureDragRef.current = null
          if (wasSame) return
        }
        useCanvasStore.getState().setSelectedFixture(id)
        const geo = roomRef.current.geometry as RoomGeometry
        const isDoor = (geo.doors ?? []).some(d => d.id === id)
        fixtureDragRef.current = {
          active: true,
          fixtureId: id,
          type: isDoor ? 'door' : 'window',
          originalGeo: JSON.parse(JSON.stringify(geo)),
        }
      },
      state.selectedFixtureId,
    )

    frontRef.current = result.front
    visibleWallsRef.current = result.visibleWalls
    rotatedVertsRef.current = result.rotatedVertices
    wallHRef.current = result.wallH
    bboxRef.current = { W: result.bboxW, D: result.bboxD }

    await drawFurnitureLayer(
      fl, state.placedFurniture, state.roomRotation,
      result.front, result.bboxW, result.bboxD,
      state.selectedItemId,
      (id) => {
        if (fixtureDragRef.current?.active) {
          useProjectStore.getState().updateRoom(roomRef.current.id, { geometry: roomRef.current.geometry })
          fixtureDragRef.current = null
        }
        state.setSelectedItem(id)
      },
      (id) => {
        if (fixtureDragRef.current?.active) {
          useProjectStore.getState().updateRoom(roomRef.current.id, { geometry: roomRef.current.geometry })
          fixtureDragRef.current = null
        }
        dragRef.current = { active: true, itemId: id }
        state.setDragging(true)
      },
    )

    // ── Shape edit handles ──────────────────────────────────────────────
    const sl = shapeLayerRef.current
    if (sl) {
      sl.removeChildren()
      if (state.shapeEditMode) {
        const origVerts = getVertices(roomRef.current)
        const rotVerts = result.rotatedVertices

        // Draw wall segment hit areas (for wall push/pull drag — lowest priority)
        for (let i = 0; i < rotVerts.length; i++) {
          const a = rotVerts[i], b = rotVerts[(i + 1) % rotVerts.length]
          const sa = roomToScreen(a.u, a.v, result.front)
          const sb = roomToScreen(b.u, b.v, result.front)

          // Build a thin quad along the wall for hit detection (12px wide)
          const dx = sb.sx - sa.sx, dy = sb.sy - sa.sy
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len === 0) continue
          const nx = -dy / len * 6, ny = dx / len * 6

          const wg = new Graphics()
          wg.poly([
            sa.sx + nx, sa.sy + ny,
            sb.sx + nx, sb.sy + ny,
            sb.sx - nx, sb.sy - ny,
            sa.sx - nx, sa.sy - ny,
          ])
          wg.fill({ color: 0x2BA8A0, alpha: 0.12 })
          wg.eventMode = 'static'
          wg.cursor = 'grab'
          wg.on('pointerover', () => { wg.tint = 0xFFFFFF; wg.alpha = 2.5 })
          wg.on('pointerout', () => { wg.alpha = 1.0 })

          const segIdx = i
          wg.on('pointerdown', (ev: { stopPropagation: () => void; global: { x: number; y: number } }) => {
            ev.stopPropagation()
            const oa = origVerts[segIdx]
            const ob = origVerts[(segIdx + 1) % origVerts.length]
            const wdu = ob.u - oa.u, wdv = ob.v - oa.v
            const wlen = Math.sqrt(wdu * wdu + wdv * wdv)
            if (wlen === 0) return
            // Outward normal for CCW winding
            const normalU = wdv / wlen
            const normalV = -wdu / wlen

            const cs = useCanvasStore.getState()
            const mouseRoom = screenToRoom(ev.global.x, ev.global.y, frontRef.current)
            const mouseOrig = unrotatePoint(mouseRoom.u, mouseRoom.v, bboxRef.current.W, bboxRef.current.D, cs.roomRotation)

            // Save original geometry for undo
            const geo = roomRef.current.geometry as RoomGeometry
            const origGeo = JSON.parse(JSON.stringify(geo)) as RoomGeometry

            // Insert 2 new vertices after segIdx (initially at A and B positions)
            // Wall A→B becomes: A → A'(new) → B'(new) → B
            const newVerts = [...origVerts]
            newVerts.splice(segIdx + 1, 0, { ...oa }, { ...ob })

            // Remap fixture wall_index values to account for 2 inserted vertices
            const newGeo: RoomGeometry = { ...geo, vertices: newVerts }
            if (newGeo.doors) {
              newGeo.doors = newGeo.doors.map(d => {
                const wi = migrateFixtureWallIndex(d)
                if (wi === segIdx) return { ...d, wall_index: segIdx + 1 }
                if (wi > segIdx) return { ...d, wall_index: wi + 2 }
                return d
              })
            }
            if (newGeo.windows) {
              newGeo.windows = newGeo.windows.map(w => {
                const wi = migrateFixtureWallIndex(w)
                if (wi === segIdx) return { ...w, wall_index: segIdx + 1 }
                if (wi > segIdx) return { ...w, wall_index: wi + 2 }
                return w
              })
            }

            // Update ref immediately (visual stays same since A'=A, B'=B)
            const bbox = computeBoundingBox(newVerts)
            roomRef.current = { ...roomRef.current, geometry: newGeo, width_cm: bbox.width_cm, height_cm: bbox.height_cm }

            wallDragRef.current = {
              active: true,
              insertedIdx1: segIdx + 1,
              insertedIdx2: segIdx + 2,
              normalU, normalV,
              startA: { ...oa },
              startB: { ...ob },
              startMouseU: mouseOrig.u,
              startMouseV: mouseOrig.v,
              originalGeo: origGeo,
              originalWidthCm: roomRef.current.width_cm,
              originalHeightCm: roomRef.current.height_cm,
            }
            cs.setSelectedVertex(null)
          })
          sl.addChild(wg)
        }

        // Draw wall dimension labels
        const centroid = polygonCentroid(rotVerts)
        const centroidScreen = roomToScreen(centroid.u, centroid.v, result.front)
        for (let i = 0; i < rotVerts.length; i++) {
          const a = rotVerts[i], b = rotVerts[(i + 1) % rotVerts.length]
          const sa = roomToScreen(a.u, a.v, result.front)
          const sb = roomToScreen(b.u, b.v, result.front)
          const lenM = wallSegmentLength(origVerts[i], origVerts[(i + 1) % origVerts.length])
          const lenCm = Math.round(lenM * 100)

          const mx = (sa.sx + sb.sx) / 2, my = (sa.sy + sb.sy) / 2
          const dx = sb.sx - sa.sx, dy = sb.sy - sa.sy
          const slen = Math.sqrt(dx * dx + dy * dy)
          if (slen < 1) continue

          // Perpendicular offset pointing away from polygon centroid
          const n1x = -dy / slen, n1y = dx / slen
          const toC = (centroidScreen.sx - mx) * n1x + (centroidScreen.sy - my) * n1y
          const off = 16
          const nx = toC < 0 ? n1x * off : -n1x * off
          const ny = toC < 0 ? n1y * off : -n1y * off

          // Background pill
          const labelText = `${lenCm} cm`
          const pillW = labelText.length * 6.5 + 10, pillH = 16
          const bg = new Graphics()
          bg.roundRect(mx + nx - pillW / 2, my + ny - pillH / 2, pillW, pillH, 4)
          bg.fill({ color: 0xFFFFFF, alpha: 0.88 })
          bg.stroke({ color: 0xE8E5E0, width: 0.5 })
          bg.eventMode = 'none'
          sl.addChild(bg)

          const label = new Text({
            text: labelText,
            style: { fontSize: 10, fontFamily: 'Inter, sans-serif', fill: 0x555555, fontWeight: '600' },
          })
          label.anchor.set(0.5, 0.5)
          label.position.set(mx + nx, my + ny)
          label.eventMode = 'none'
          sl.addChild(label)
        }

        // Draw midpoint handles (+ buttons to add vertex)
        for (let i = 0; i < rotVerts.length; i++) {
          const a = rotVerts[i], b = rotVerts[(i + 1) % rotVerts.length]
          const midU = (a.u + b.u) / 2, midV = (a.v + b.v) / 2
          const ms = roomToScreen(midU, midV, result.front)
          const mp = new Graphics()
          mp.circle(ms.sx, ms.sy, 7)
          mp.fill({ color: 0xFFFFFF, alpha: 0.9 })
          mp.stroke({ color: 0x2BA8A0, width: 1.5 })
          // Draw + sign
          const pl = new Graphics()
          pl.moveTo(ms.sx - 3, ms.sy); pl.lineTo(ms.sx + 3, ms.sy)
          pl.moveTo(ms.sx, ms.sy - 3); pl.lineTo(ms.sx, ms.sy + 3)
          pl.stroke({ color: 0x2BA8A0, width: 1.5 })
          mp.eventMode = 'static'; mp.cursor = 'pointer'
          const segIdx = i
          mp.on('pointerdown', (ev: { stopPropagation: () => void }) => {
            ev.stopPropagation()
            // Insert a new vertex at the midpoint of this segment
            const newVerts = [...origVerts]
            const oa = origVerts[segIdx], ob = origVerts[(segIdx + 1) % origVerts.length]
            const newVert = { u: Math.round(((oa.u + ob.u) / 2) * 10) / 10, v: Math.round(((oa.v + ob.v) / 2) * 10) / 10 }
            newVerts.splice(segIdx + 1, 0, newVert)
            const bbox = computeBoundingBox(newVerts)
            const newGeo = { ...(roomRef.current.geometry as RoomGeometry), vertices: newVerts }
            useProjectStore.getState().updateRoom(roomRef.current.id, {
              geometry: newGeo, width_cm: bbox.width_cm, height_cm: bbox.height_cm,
            })
            // Start dragging the new vertex
            useCanvasStore.getState().setSelectedVertex(segIdx + 1)
            vertexDragRef.current = { active: true, vertexIndex: segIdx + 1 }
          })
          sl.addChild(mp); sl.addChild(pl)
        }

        // Draw vertex handles
        for (let i = 0; i < rotVerts.length; i++) {
          const rv = rotVerts[i]
          const vs = roomToScreen(rv.u, rv.v, result.front)
          const isSelected = state.selectedVertexIndex === i
          const vh = new Graphics()
          vh.circle(vs.sx, vs.sy, isSelected ? 8 : 6)
          vh.fill({ color: isSelected ? 0x2BA8A0 : 0xFFFFFF })
          vh.stroke({ color: 0x2BA8A0, width: 2 })
          vh.eventMode = 'static'; vh.cursor = 'grab'
          const vIdx = i
          vh.on('pointerdown', (ev: { stopPropagation: () => void }) => {
            ev.stopPropagation()
            useCanvasStore.getState().setSelectedVertex(vIdx)
            vertexDragRef.current = { active: true, vertexIndex: vIdx }
          })
          sl.addChild(vh)
        }
      }
    }
  }, [])

  // Subscribe to canvas store
  useEffect(() => {
    const unsub = useCanvasStore.subscribe(() => { redraw() })
    return unsub
  }, [redraw])

  // Init PixiJS
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    let cancelled = false

    const init = async () => {
      const app = new Application()
      await app.init({
        width: el.clientWidth, height: el.clientHeight,
        background: 0xF5F3EF, antialias: true,
        resolution: window.devicePixelRatio || 1, autoDensity: true,
      })
      if (cancelled) { app.destroy(true); return }
      el.appendChild(app.canvas)
      appRef.current = app

      const rl = new Container(); const fl = new Container(); const sl = new Container()
      app.stage.addChild(rl); app.stage.addChild(fl); app.stage.addChild(sl)
      roomLayerRef.current = rl; furnitureLayerRef.current = fl; shapeLayerRef.current = sl

      app.stage.eventMode = 'static'
      app.stage.hitArea = app.screen

      // ── Stage click: place furniture, place fixture, or deselect ────
      app.stage.on('pointerdown', (e) => {
        const s = useCanvasStore.getState()
        const p = e.global

        // Finalize fixture drag (Sims-style: click anywhere to place)
        if (fixtureDragRef.current?.active) {
          useProjectStore.getState().updateRoom(roomRef.current.id, { geometry: roomRef.current.geometry })
          fixtureDragRef.current = null
          return
        }

        // Furniture placement mode
        if (s.placementMode) {
          const rotated = screenToRoom(p.x, p.y, frontRef.current)
          const orig = unrotatePoint(rotated.u, rotated.v, bboxRef.current.W, bboxRef.current.D, s.roomRotation)
          const verts = getVertices(roomRef.current)
          if (pointInPolygon(orig.u, orig.v, verts)) {
            s.placeItem(roomRef.current.id, orig.u, orig.v)
          }
          return
        }

        // Fixture placement mode (door/window)
        if (s.fixturePlacementType && visibleWallsRef.current.length > 0) {
          const px = p.x, py = p.y
          for (const vw of visibleWallsRef.current) {
            if (pointInConvexQuad(px, py, vw.quad)) {
              const screenPos = projectOnSegment(px, py, vw.screenA.x, vw.screenA.y, vw.screenB.x, vw.screenB.y)
              const defaultWidth = s.fixturePlacementType === 'door' ? 0.8 : 1.0
              const halfT = (defaultWidth / 2) / vw.lengthM
              const clampedPos = Math.max(halfT + 0.02, Math.min(1 - halfT - 0.02, screenPos))

              const newFixture = {
                id: crypto.randomUUID(),
                wall_index: vw.wallIndex,
                position: clampedPos,
                width_m: defaultWidth,
              }
              const geo = roomRef.current.geometry as RoomGeometry
              const newGeo = s.fixturePlacementType === 'door'
                ? { ...geo, doors: [...(geo.doors ?? []), newFixture] }
                : { ...geo, windows: [...(geo.windows ?? []), newFixture] }
              useProjectStore.getState().updateRoom(roomRef.current.id, { geometry: newGeo })
              s.setFixturePlacementMode(null)
              break
            }
          }
          return
        }

        if (!dragRef.current.active) {
          s.setSelectedItem(null)
          s.setSelectedFixture(null)
        }
      })

      // ── Drag + ghost ─────────────────────────────────────────────────
      app.stage.on('pointermove', (e) => {
        const s = useCanvasStore.getState()
        const p = e.global

        // Vertex drag (shape edit mode)
        if (vertexDragRef.current?.active && s.shapeEditMode) {
          const rotated = screenToRoom(p.x, p.y, frontRef.current)
          const orig = unrotatePoint(rotated.u, rotated.v, bboxRef.current.W, bboxRef.current.D, s.roomRotation)
          // Snap to 10cm grid
          const snappedU = Math.round(orig.u * 10) / 10
          const snappedV = Math.round(orig.v * 10) / 10
          const verts = getVertices(roomRef.current)
          const newVerts = [...verts]
          newVerts[vertexDragRef.current.vertexIndex] = { u: snappedU, v: snappedV }
          const bbox = computeBoundingBox(newVerts)
          const newGeo = { ...(roomRef.current.geometry as RoomGeometry), vertices: newVerts }
          roomRef.current = { ...roomRef.current, geometry: newGeo, width_cm: bbox.width_cm, height_cm: bbox.height_cm }
          redraw()
          return
        }

        // Wall drag (shape edit mode — push/pull rectangular extrusion)
        if (wallDragRef.current?.active && s.shapeEditMode) {
          const rotated = screenToRoom(p.x, p.y, frontRef.current)
          const orig = unrotatePoint(rotated.u, rotated.v, bboxRef.current.W, bboxRef.current.D, s.roomRotation)
          const wd = wallDragRef.current
          const deltaU = orig.u - wd.startMouseU
          const deltaV = orig.v - wd.startMouseV
          // Project displacement onto wall normal
          const projDist = deltaU * wd.normalU + deltaV * wd.normalV
          const snapped = Math.round(projDist * 10) / 10
          // Move the 2 inserted vertices perpendicular (original corners stay fixed)
          const newA = {
            u: Math.round((wd.startA.u + snapped * wd.normalU) * 10) / 10,
            v: Math.round((wd.startA.v + snapped * wd.normalV) * 10) / 10,
          }
          const newB = {
            u: Math.round((wd.startB.u + snapped * wd.normalU) * 10) / 10,
            v: Math.round((wd.startB.v + snapped * wd.normalV) * 10) / 10,
          }
          const verts = getVertices(roomRef.current)
          const newVerts = [...verts]
          newVerts[wd.insertedIdx1] = newA
          newVerts[wd.insertedIdx2] = newB
          const bbox = computeBoundingBox(newVerts)
          const newGeo = { ...(roomRef.current.geometry as RoomGeometry), vertices: newVerts }
          roomRef.current = { ...roomRef.current, geometry: newGeo, width_cm: bbox.width_cm, height_cm: bbox.height_cm }
          redraw()
          return
        }

        // Fixture drag: follow cursor along visible walls
        const fDrag = fixtureDragRef.current
        if (fDrag?.active && visibleWallsRef.current.length > 0) {
          for (const vw of visibleWallsRef.current) {
            if (pointInConvexQuad(p.x, p.y, vw.quad)) {
              const screenPos = projectOnSegment(p.x, p.y, vw.screenA.x, vw.screenA.y, vw.screenB.x, vw.screenB.y)
              const geo = roomRef.current.geometry as RoomGeometry
              const fixture = fDrag.type === 'door'
                ? (geo.doors ?? []).find(d => d.id === fDrag.fixtureId)
                : (geo.windows ?? []).find(w => w.id === fDrag.fixtureId)
              if (fixture) {
                const halfT = (fixture.width_m / 2) / vw.lengthM
                const clamped = Math.max(halfT + 0.02, Math.min(1 - halfT - 0.02, screenPos))
                const updated = { ...fixture, wall_index: vw.wallIndex, position: clamped }
                // Remove deprecated wall field from updated fixture
                delete (updated as Record<string, unknown>).wall
                const newGeo = { ...geo }
                if (fDrag.type === 'door') {
                  newGeo.doors = (geo.doors ?? []).map(d => d.id === fDrag.fixtureId ? updated : d)
                } else {
                  newGeo.windows = (geo.windows ?? []).map(w => w.id === fDrag.fixtureId ? updated : w)
                }
                roomRef.current = { ...roomRef.current, geometry: newGeo }
                redraw()
              }
              break
            }
          }
        }

        // Furniture drag: point-in-polygon clamping
        if (dragRef.current.active && dragRef.current.itemId) {
          const rotated = screenToRoom(p.x, p.y, frontRef.current)
          const orig = unrotatePoint(rotated.u, rotated.v, bboxRef.current.W, bboxRef.current.D, s.roomRotation)
          const verts = getVertices(roomRef.current)
          let u = orig.u, v = orig.v
          if (!pointInPolygon(u, v, verts)) {
            const nearest = nearestPointOnPolygon(u, v, verts)
            u = nearest.u; v = nearest.v
          }
          s.moveItem(dragRef.current.itemId, u, v)
        }

        // Ghost sprite follows cursor
        if (s.placementMode && ghostRef.current) {
          const rotated = screenToRoom(p.x, p.y, frontRef.current)
          const pos = roomToScreen(rotated.u, rotated.v, frontRef.current)
          ghostRef.current.position.set(pos.sx, pos.sy)
        }
      })

      app.stage.on('pointerup', () => {
        if (vertexDragRef.current?.active) {
          // Commit vertex position to DB
          const geo = roomRef.current.geometry as RoomGeometry
          const bbox = computeBoundingBox(geo.vertices ?? [])
          useProjectStore.getState().updateRoom(roomRef.current.id, {
            geometry: geo, width_cm: bbox.width_cm, height_cm: bbox.height_cm,
          })
          vertexDragRef.current = null
          return
        }
        if (wallDragRef.current?.active) {
          const wd = wallDragRef.current
          const geo = roomRef.current.geometry as RoomGeometry
          const verts = geo.vertices ?? []

          // Check if the inserted vertices actually moved from their start positions
          const v1 = verts[wd.insertedIdx1]
          const v2 = verts[wd.insertedIdx2]
          const moved = v1 && v2 && (
            Math.abs(v1.u - wd.startA.u) > 0.01 || Math.abs(v1.v - wd.startA.v) > 0.01 ||
            Math.abs(v2.u - wd.startB.u) > 0.01 || Math.abs(v2.v - wd.startB.v) > 0.01
          )

          if (moved) {
            // Commit the extrusion
            const bbox = computeBoundingBox(verts)
            useProjectStore.getState().updateRoom(roomRef.current.id, {
              geometry: geo, width_cm: bbox.width_cm, height_cm: bbox.height_cm,
            })
          } else {
            // No movement — revert to original geometry (remove inserted vertices)
            roomRef.current = {
              ...roomRef.current,
              geometry: wd.originalGeo,
              width_cm: wd.originalWidthCm,
              height_cm: wd.originalHeightCm,
            }
            redraw()
          }
          wallDragRef.current = null
          return
        }
        if (dragRef.current.active) {
          dragRef.current = { active: false, itemId: null }
          useCanvasStore.getState().setDragging(false)
        }
      })

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (fixtureDragRef.current?.active) {
            roomRef.current = { ...roomRef.current, geometry: fixtureDragRef.current.originalGeo }
            fixtureDragRef.current = null
            useCanvasStore.getState().setSelectedFixture(null)
            redraw()
          } else {
            useCanvasStore.getState().cancelPlacement()
          }
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLInputElement)) {
          const s = useCanvasStore.getState()
          if (s.shapeEditMode && s.selectedVertexIndex != null) {
            const verts = getVertices(roomRef.current)
            if (verts.length > 4) {
              const newVerts = verts.filter((_, i) => i !== s.selectedVertexIndex)
              const bbox = computeBoundingBox(newVerts)
              const geo = roomRef.current.geometry as RoomGeometry
              useProjectStore.getState().updateRoom(roomRef.current.id, {
                geometry: { ...geo, vertices: newVerts },
                width_cm: bbox.width_cm,
                height_cm: bbox.height_cm,
              })
              s.setSelectedVertex(null)
            }
          } else if (s.selectedItemId) {
            s.removeItem(s.selectedItemId)
          }
        }
      }
      window.addEventListener('keydown', onKey)

      const ro = new ResizeObserver(() => {
        if (appRef.current && containerRef.current) {
          appRef.current.renderer.resize(containerRef.current.clientWidth, containerRef.current.clientHeight)
          appRef.current.stage.hitArea = appRef.current.screen
          redraw()
        }
      })
      ro.observe(el)

      redraw()

      ;(el as unknown as Record<string, unknown>)._cleanup = () => {
        window.removeEventListener('keydown', onKey)
        ro.disconnect()
      }
    }

    init()
    return () => {
      cancelled = true
      ;(el as unknown as Record<string, () => void>)._cleanup?.()
      appRef.current?.destroy(true)
      appRef.current = null
    }
  }, [redraw])

  // Redraw on room / material changes
  useEffect(() => { redraw() }, [room, finishMaterials, redraw])

  // Ghost sprite lifecycle
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (state.placementMode === prev.placementMode &&
          state.placementVariantId === prev.placementVariantId) return
      const app = appRef.current
      if (!app) return

      // Remove old ghost
      if (ghostRef.current) { ghostRef.current.destroy(); ghostRef.current = null }

      if (state.placementMode && state.placementVariantId && state.placementItemId) {
        const dir = apparentDirection('front_left', state.roomRotation)
        const url = getSpriteUrl(state.placementVariantId, dir)
          ?? getFallbackUrl(state.placementVariantId, state.placementItemId)
        if (url) {
          loadTex(url).then((tex) => {
            if (tex === Texture.EMPTY || !appRef.current) return
            const g = new Sprite(tex)
            g.anchor.set(0.5, 0.85)
            g.alpha = 0.5
            g.scale.set(getItemScale(state.placementItemId!, state.placementVariantId!))
            appRef.current!.stage.addChild(g)
            ghostRef.current = g
          })
        }
      }
    })
    return unsub
  }, [])

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
