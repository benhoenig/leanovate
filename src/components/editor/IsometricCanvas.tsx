import { useEffect, useRef, useCallback } from 'react'
import { Application, Graphics, Sprite, Texture, Container, Assets } from 'pixi.js'
import type { Room, FinishMaterial, PlacedFurniture, Direction, PhysicalWall, RoomGeometry } from '@/types'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { supabase } from '@/lib/supabase'

interface Props {
  room: Room
  finishMaterials: FinishMaterial[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const T = 64
const SPRITE_SIZE = 512
const DIRECTIONS: Direction[] = ['front_left', 'front_right', 'back_right', 'back_left']

// ── Wall rotation mapping ────────────────────────────────────────────────────
// Each room has 4 physical walls (north/east/south/west). Only 2 are visible
// per rotation. This maps physical walls to screen walls with position transforms.

interface ScreenWallMapping {
  screenWall: 'left' | 'right'
  toScreen: (t: number) => number
}

const WALL_SCREEN_MAP: Record<Direction, Partial<Record<PhysicalWall, ScreenWallMapping>>> = {
  front_left: {
    north: { screenWall: 'left',  toScreen: t => 1 - t },
    east:  { screenWall: 'right', toScreen: t => 1 - t },
  },
  front_right: {
    east:  { screenWall: 'left',  toScreen: t => t },
    south: { screenWall: 'right', toScreen: t => 1 - t },
  },
  back_right: {
    south: { screenWall: 'left',  toScreen: t => t },
    west:  { screenWall: 'right', toScreen: t => t },
  },
  back_left: {
    west:  { screenWall: 'left',  toScreen: t => 1 - t },
    north: { screenWall: 'right', toScreen: t => t },
  },
}

const SCREEN_TO_PHYSICAL: Record<Direction, {
  left:  { wall: PhysicalWall; toPhysical: (ts: number) => number }
  right: { wall: PhysicalWall; toPhysical: (ts: number) => number }
}> = {
  front_left: {
    left:  { wall: 'north', toPhysical: ts => 1 - ts },
    right: { wall: 'east',  toPhysical: ts => 1 - ts },
  },
  front_right: {
    left:  { wall: 'east',  toPhysical: ts => ts },
    right: { wall: 'south', toPhysical: ts => 1 - ts },
  },
  back_right: {
    left:  { wall: 'south', toPhysical: ts => ts },
    right: { wall: 'west',  toPhysical: ts => ts },
  },
  back_left: {
    left:  { wall: 'west',  toPhysical: ts => 1 - ts },
    right: { wall: 'north', toPhysical: ts => ts },
  },
}

function physicalWallLength(wall: PhysicalWall, W: number, D: number): number {
  return (wall === 'north' || wall === 'south') ? W : D
}

// ── Wall hit testing ─────────────────────────────────────────────────────────

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
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
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

function computeFloorVertices(W: number, D: number, cx: number, cy: number) {
  const fx = cx - (W - D) * T / 2
  const fy = cy + (W + D) * T / 4
  return {
    front: { x: fx, y: fy },
    right: { x: fx + W * T, y: fy - W * T / 2 },
    back:  { x: fx + (W - D) * T, y: fy - (W + D) * T / 2 },
    left:  { x: fx - D * T, y: fy - D * T / 2 },
  }
}

function roomToScreen(u: number, v: number, front: { x: number; y: number }) {
  return { sx: front.x + u * T - v * T, sy: front.y - u * T / 2 - v * T / 2 }
}

function screenToRoom(sx: number, sy: number, front: { x: number; y: number }) {
  const dx = sx - front.x, dy = sy - front.y
  return { u: (dx - 2 * dy) / (2 * T), v: (-dx - 2 * dy) / (2 * T) }
}

function apparentDirection(itemDir: Direction, rotation: Direction): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(itemDir) + DIRECTIONS.indexOf(rotation)) % 4]
}

function transformForRotation(u: number, v: number, W: number, D: number, rot: Direction) {
  switch (rot) {
    case 'front_left':  return { u, v, effW: W, effD: D }
    case 'front_right': return { u: D - v, v: u, effW: D, effD: W }
    case 'back_right':  return { u: W - u, v: D - v, effW: W, effD: D }
    case 'back_left':   return { u: v, v: W - u, effW: D, effD: W }
  }
}

function screenToRoomRotated(
  sx: number, sy: number, front: { x: number; y: number },
  W: number, D: number, rot: Direction,
) {
  const raw = screenToRoom(sx, sy, front)
  switch (rot) {
    case 'front_left':  return raw
    case 'front_right': return { u: raw.v, v: D - raw.u }
    case 'back_right':  return { u: W - raw.u, v: D - raw.v }
    case 'back_left':   return { u: W - raw.v, v: raw.u }
  }
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

// ── Room drawing ──────────────────────────────────────────────────────────────

interface FloorVerts {
  front: { x: number; y: number }
  right: { x: number; y: number }
  back:  { x: number; y: number }
  left:  { x: number; y: number }
}

function drawRoomShell(
  container: Container, room: Room, materials: FinishMaterial[],
  rot: Direction, cx: number, cy: number,
  onFixtureClick?: (id: string) => void,
  selectedFixtureId?: string | null,
) {
  container.removeChildren()
  const W = room.width_cm / 100, D = room.height_cm / 100
  const { effW, effD } = transformForRotation(0, 0, W, D, rot)
  const wallH = wallHeightPx(room.ceiling_height_cm)
  const v = computeFloorVertices(effW, effD, cx, cy)

  const wallColor  = getFinishColor(room, materials, 'wall', 0xECE9E4)
  const floorColor = getFinishColor(room, materials, 'floor', 0xD4CFC8)
  const doorColor  = getFinishColor(room, materials, 'door', 0xC8A882)
  const winColor   = getFinishColor(room, materials, 'window', 0xE8EDF0)
  const lightColor = getFinishColor(room, materials, 'lighting', 0xFFE4A0)
  const stroke = { color: 0xB8B3AC, width: 1 }

  // Left wall
  const lw = new Graphics()
  lw.poly([v.back.x, v.back.y, v.left.x, v.left.y, v.left.x, v.left.y - wallH, v.back.x, v.back.y - wallH])
  lw.fill({ color: blendColor(wallColor, 0x000000, 0.10) }); lw.stroke(stroke)
  container.addChild(lw)

  // Right wall
  const rw = new Graphics()
  rw.poly([v.back.x, v.back.y, v.right.x, v.right.y, v.right.x, v.right.y - wallH, v.back.x, v.back.y - wallH])
  rw.fill({ color: blendColor(wallColor, 0xFFFFFF, 0.10) }); rw.stroke(stroke)
  container.addChild(rw)

  // Floor
  const fl = new Graphics()
  fl.poly([v.front.x, v.front.y, v.right.x, v.right.y, v.back.x, v.back.y, v.left.x, v.left.y])
  fl.fill({ color: floorColor }); fl.stroke(stroke)
  container.addChild(fl)

  // ── Render fixtures from geometry ─────────────────────────────────────
  const geo = room.geometry as RoomGeometry
  const doors = geo?.doors ?? []
  const windows = geo?.windows ?? []
  const wallMap = WALL_SCREEN_MAP[rot]

  const renderFixture = (
    id: string, wall: PhysicalWall, position: number, widthM: number,
    type: 'door' | 'window',
  ) => {
    const mapping = wallMap[wall]
    if (!mapping) return // not visible in this rotation
    const wLen = physicalWallLength(wall, W, D)
    const halfT = (widthM / 2) / wLen
    const screenCenter = mapping.toScreen(position)
    const t0 = Math.max(0.02, screenCenter - halfT)
    const t1 = Math.min(0.98, screenCenter + halfT)
    const wallStart = v.back
    const wallEnd = mapping.screenWall === 'left' ? v.left : v.right
    const bl = lerp(wallStart, wallEnd, t0)
    const br = lerp(wallStart, wallEnd, t1)

    const isSelected = id === selectedFixtureId

    if (type === 'door') {
      const dH = wallH * 0.82
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
      const wSill = wallH * 0.30, wTop = wallH * 0.78
      const wg = new Graphics()
      wg.poly([bl.x, bl.y - wSill, br.x, br.y - wSill, br.x, br.y - wTop, bl.x, bl.y - wTop])
      wg.fill({ color: 0xC8E8F4, alpha: 0.65 })
      wg.eventMode = 'static'; wg.cursor = 'pointer'
      wg.on('pointerdown', (e: { stopPropagation: () => void }) => { e.stopPropagation(); onFixtureClick?.(id) })
      container.addChild(wg)
      const wf = new Graphics()
      wf.poly([bl.x, bl.y - wSill, br.x, br.y - wSill, br.x, br.y - wTop, bl.x, bl.y - wTop])
      wf.fill({ color: 0x000000, alpha: 0 })
      wf.stroke({ color: isSelected ? 0x2BA8A0 : winColor, width: isSelected ? 3 : 2.5 })
      wf.eventMode = 'none'
      container.addChild(wf)
    }
  }

  for (const door of doors) renderFixture(door.id, door.wall, door.position, door.width_m, 'door')
  for (const win of windows) renderFixture(win.id, win.wall, win.position, win.width_m, 'window')

  // Light
  const glow = new Graphics(); glow.circle(cx, cy - wallH, 22); glow.fill({ color: lightColor, alpha: 0.18 })
  container.addChild(glow)
  const fix = new Graphics(); fix.circle(cx, cy - wallH, 5); fix.fill({ color: lightColor })
  fix.stroke({ color: blendColor(lightColor, 0x000000, 0.30), width: 1 }); container.addChild(fix)

  return { front: v.front, effW, effD, verts: v, wallH }
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
  W: number, D: number,
  selectedId: string | null,
  onSelect: (id: string) => void,
  onDragStart: (id: string) => void,
) {
  container.removeChildren()

  // Depth sort: back items first
  const sorted = [...items].sort((a, b) => {
    const at = transformForRotation(a.x, a.y, W, D, rot)
    const bt = transformForRotation(b.x, b.y, W, D, rot)
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

    const t = transformForRotation(item.x, item.y, W, D, rot)
    const pos = roomToScreen(t.u, t.v, front)
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
  const ghostRef = useRef<Sprite | null>(null)
  const frontRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const dimsRef = useRef<{ W: number; D: number }>({ W: 3, D: 3 })
  const floorVertsRef = useRef<FloorVerts | null>(null)
  const wallHRef = useRef(0)

  const dragRef = useRef<{ active: boolean; itemId: string | null }>({
    active: false, itemId: null,
  })
  const fixtureDragRef = useRef<{
    active: boolean; fixtureId: string; type: 'door' | 'window'; originalGeo: RoomGeometry
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

    const { front, verts, wallH: wH } = drawRoomShell(
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
    frontRef.current = front
    floorVertsRef.current = verts
    wallHRef.current = wH
    dimsRef.current = { W: roomRef.current.width_cm / 100, D: roomRef.current.height_cm / 100 }

    await drawFurnitureLayer(
      fl, state.placedFurniture, state.roomRotation,
      front, dimsRef.current.W, dimsRef.current.D,
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

      const rl = new Container(); const fl = new Container()
      app.stage.addChild(rl); app.stage.addChild(fl)
      roomLayerRef.current = rl; furnitureLayerRef.current = fl

      app.stage.eventMode = 'static'
      app.stage.hitArea = app.screen

      // Stage click: place furniture, place fixture, or deselect
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
          const { u, v } = screenToRoomRotated(
            p.x, p.y, frontRef.current, dimsRef.current.W, dimsRef.current.D, s.roomRotation,
          )
          s.placeItem(
            roomRef.current.id,
            Math.max(0.1, Math.min(dimsRef.current.W - 0.1, u)),
            Math.max(0.1, Math.min(dimsRef.current.D - 0.1, v)),
          )
          return
        }

        // Fixture placement mode (door/window)
        if (s.fixturePlacementType && floorVertsRef.current) {
          const fv = floorVertsRef.current
          const wH = wallHRef.current
          const px = p.x, py = p.y

          // Check left wall quad
          const leftQuad = [
            fv.back, fv.left,
            { x: fv.left.x, y: fv.left.y - wH },
            { x: fv.back.x, y: fv.back.y - wH },
          ]
          // Check right wall quad
          const rightQuad = [
            fv.back, fv.right,
            { x: fv.right.x, y: fv.right.y - wH },
            { x: fv.back.x, y: fv.back.y - wH },
          ]

          let screenWall: 'left' | 'right' | null = null
          if (pointInConvexQuad(px, py, leftQuad)) screenWall = 'left'
          else if (pointInConvexQuad(px, py, rightQuad)) screenWall = 'right'

          if (screenWall) {
            const wallEnd = screenWall === 'left' ? fv.left : fv.right
            const screenPos = projectOnSegment(px, py, fv.back.x, fv.back.y, wallEnd.x, wallEnd.y)
            const inverse = SCREEN_TO_PHYSICAL[s.roomRotation][screenWall]
            const physPos = inverse.toPhysical(screenPos)
            const wLen = physicalWallLength(inverse.wall, dimsRef.current.W, dimsRef.current.D)
            const defaultWidth = s.fixturePlacementType === 'door' ? 0.8 : 1.0
            const halfT = (defaultWidth / 2) / wLen
            const clampedPos = Math.max(halfT + 0.02, Math.min(1 - halfT - 0.02, physPos))

            const newFixture = {
              id: crypto.randomUUID(),
              wall: inverse.wall,
              position: clampedPos,
              width_m: defaultWidth,
            }
            const geo = roomRef.current.geometry as RoomGeometry
            const newGeo = s.fixturePlacementType === 'door'
              ? { ...geo, doors: [...(geo.doors ?? []), newFixture] }
              : { ...geo, windows: [...(geo.windows ?? []), newFixture] }
            useProjectStore.getState().updateRoom(roomRef.current.id, { geometry: newGeo })
            s.setFixturePlacementMode(null)
          }
          return
        }

        if (!dragRef.current.active) {
          s.setSelectedItem(null)
          s.setSelectedFixture(null)
        }
      })

      // Drag + ghost
      app.stage.on('pointermove', (e) => {
        const s = useCanvasStore.getState()
        const p = e.global

        // Fixture drag: follow cursor along walls (Sims-style)
        const fDrag = fixtureDragRef.current
        if (fDrag?.active && floorVertsRef.current) {
          const fv = floorVertsRef.current
          const wH = wallHRef.current
          const leftQuad = [
            fv.back, fv.left,
            { x: fv.left.x, y: fv.left.y - wH },
            { x: fv.back.x, y: fv.back.y - wH },
          ]
          const rightQuad = [
            fv.back, fv.right,
            { x: fv.right.x, y: fv.right.y - wH },
            { x: fv.back.x, y: fv.back.y - wH },
          ]
          let screenWall: 'left' | 'right' | null = null
          if (pointInConvexQuad(p.x, p.y, leftQuad)) screenWall = 'left'
          else if (pointInConvexQuad(p.x, p.y, rightQuad)) screenWall = 'right'

          if (screenWall) {
            const wallEnd = screenWall === 'left' ? fv.left : fv.right
            const screenPos = projectOnSegment(p.x, p.y, fv.back.x, fv.back.y, wallEnd.x, wallEnd.y)
            const inverse = SCREEN_TO_PHYSICAL[s.roomRotation][screenWall]
            const physPos = inverse.toPhysical(screenPos)
            const geo = roomRef.current.geometry as RoomGeometry
            const fixture = fDrag.type === 'door'
              ? (geo.doors ?? []).find(d => d.id === fDrag.fixtureId)
              : (geo.windows ?? []).find(w => w.id === fDrag.fixtureId)
            if (fixture) {
              const wLen = physicalWallLength(inverse.wall, dimsRef.current.W, dimsRef.current.D)
              const halfT = (fixture.width_m / 2) / wLen
              const clamped = Math.max(halfT + 0.02, Math.min(1 - halfT - 0.02, physPos))
              const updated = { ...fixture, wall: inverse.wall, position: clamped }
              const newGeo = { ...geo }
              if (fDrag.type === 'door') {
                newGeo.doors = (geo.doors ?? []).map(d => d.id === fDrag.fixtureId ? updated : d)
              } else {
                newGeo.windows = (geo.windows ?? []).map(w => w.id === fDrag.fixtureId ? updated : w)
              }
              roomRef.current = { ...roomRef.current, geometry: newGeo }
              redraw()
            }
          }
        }

        if (dragRef.current.active && dragRef.current.itemId) {
          const { u, v } = screenToRoomRotated(
            p.x, p.y, frontRef.current, dimsRef.current.W, dimsRef.current.D, s.roomRotation,
          )
          s.moveItem(dragRef.current.itemId,
            Math.max(0.1, Math.min(dimsRef.current.W - 0.1, u)),
            Math.max(0.1, Math.min(dimsRef.current.D - 0.1, v)),
          )
        }

        if (s.placementMode && ghostRef.current) {
          const { u, v } = screenToRoomRotated(
            p.x, p.y, frontRef.current, dimsRef.current.W, dimsRef.current.D, s.roomRotation,
          )
          const t = transformForRotation(
            Math.max(0, Math.min(dimsRef.current.W, u)),
            Math.max(0, Math.min(dimsRef.current.D, v)),
            dimsRef.current.W, dimsRef.current.D, s.roomRotation,
          )
          const pos = roomToScreen(t.u, t.v, frontRef.current)
          ghostRef.current.position.set(pos.sx, pos.sy)
        }
      })

      app.stage.on('pointerup', () => {
        if (dragRef.current.active) {
          dragRef.current = { active: false, itemId: null }
          useCanvasStore.getState().setDragging(false)
        }
      })

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (fixtureDragRef.current?.active) {
            // Revert fixture to original position
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
          if (s.selectedItemId) s.removeItem(s.selectedItemId)
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
