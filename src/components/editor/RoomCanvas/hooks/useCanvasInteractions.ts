import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { getVertices, pointInPolygon, nearestPointOnPolygon, nearestWallSnap } from '@/lib/roomGeometry'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore } from '@/stores/useUIStore'
import type { Room, RoomGeometry } from '@/types'
import type { SceneContext } from '../types'
import {
  raycastFloor,
  raycastFurniture,
  raycastFixture,
  raycastWall,
  raycastHandle,
} from '../lib/raycasters'
import { getGridStepCm, snapCm, getFixtureDims } from '../lib/gridSnap'
import {
  updateVertexLocal,
  commitShapeEdit,
  applyWallPush,
  insertVertexAtMidpoint,
  deleteSelectedVertex,
  commitFixturePlacement,
} from '../lib/geometryCommands'

/**
 * Single dispatcher for all pointer / wheel / keyboard interactions on the
 * canvas container. Preserves the exact priority order from the pre-refactor
 * monolith:
 *
 *   pointerdown:
 *     1. Shape edit mode: vertex drag → midpoint insert → wall push/pull → deselect vertex
 *     2. Fixture placement: click on wall commits, exits mode
 *     3. Furniture placement: click commits
 *     4. Fixture pickup/move: second click commits, first click picks up
 *     5. Furniture raycast: select + start drag
 *     6. Empty click: deselect
 *
 *   pointermove:
 *     1. Hover cursor updates in shape-edit mode
 *     2. Vertex drag
 *     3. Fixture follow-cursor (after pickup)
 *     4. Wall push/pull drag
 *     5. Placement ghost follow
 *     6. Fixture placement ghost follow (snap to nearest wall)
 *     7. Furniture drag
 *
 *   pointerup: commit any active drag + push undo command
 *
 *   wheel: rotate selected furniture by 15° (1° with Ctrl), debounced
 *
 *   keydown: roam WASD, Escape (cancel placement / deselect / restore pickup),
 *            Delete/Backspace (remove vertex / furniture)
 *   keyup: clear roam WASD state
 *
 * Interaction-local refs (drag state, rotate state, fixture move) stay
 * inside this hook — they don't need to be shared upstream.
 */
export function useCanvasInteractions(
  ctx: SceneContext,
  room: Room,
  ghostRefs: {
    ghostGroupRef: React.RefObject<THREE.Group | null>
    fixtureGhostRef: React.RefObject<THREE.Mesh | null>
  },
): void {
  const dragStateRef = useRef<{
    placedId: string
    prevX: number
    prevZ: number
    offsetX: number
    offsetZ: number
  } | null>(null)

  const rotateStateRef = useRef<{ placedId: string; prevDeg: number } | null>(null)

  const fixtureMoveRef = useRef<{
    fixtureId: string
    fixtureType: 'door' | 'window'
    prevGeometry: RoomGeometry
    prevWidthCm: number
    prevHeightCm: number
  } | null>(null)

  const vertexDragRef = useRef<{
    vertexIndex: number
    prevGeometry: RoomGeometry
    prevWidthCm: number
    prevHeightCm: number
  } | null>(null)

  const wallDragRef = useRef<{
    wallIndex: number
    vA: number
    vB: number
    origA: { u: number; v: number }
    origB: { u: number; v: number }
    normalU: number
    normalV: number
    startProj: number
    prevGeometry: RoomGeometry
    prevWidthCm: number
    prevHeightCm: number
  } | null>(null)

  useEffect(() => {
    const container = ctx.containerRef.current
    if (!container) return

    // ── Raycast helpers scoped to this effect (all need current refs) ────────
    const rcFloor = (x: number, y: number) => {
      const cam = ctx.cameraRef.current
      if (!cam) return null
      return raycastFloor(container, cam, x, y)
    }
    const rcFurniture = (x: number, y: number) => {
      const cam = ctx.cameraRef.current
      const layer = ctx.furnitureLayerRef.current
      if (!cam || !layer) return null
      return raycastFurniture(container, cam, layer, x, y)
    }
    const rcFixture = (x: number, y: number) => {
      const cam = ctx.cameraRef.current
      const shell = ctx.shellGroupRef.current
      if (!cam || !shell) return null
      return raycastFixture(container, cam, shell, x, y)
    }
    const rcWall = (x: number, y: number) => {
      const cam = ctx.cameraRef.current
      const shell = ctx.shellGroupRef.current
      if (!cam || !shell) return null
      return raycastWall(container, cam, shell, x, y)
    }
    const rcHandle = (x: number, y: number) => {
      const cam = ctx.cameraRef.current
      const layer = ctx.handleLayerRef.current
      if (!cam || !layer) return null
      return raycastHandle(container, cam, layer, x, y)
    }

    let wheelCommitTimer = 0

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return // left click only

      const s = useCanvasStore.getState()

      // Shape edit mode: handle vertex drag / midpoint insert / wall push-pull.
      if (s.shapeEditMode) {
        const hit = rcHandle(e.clientX, e.clientY)
        if (hit?.kind === 'vertex') {
          s.setSelectedVertex(hit.vertexIndex)
          vertexDragRef.current = {
            vertexIndex: hit.vertexIndex,
            prevGeometry: JSON.parse(JSON.stringify(room.geometry)),
            prevWidthCm: room.width_cm,
            prevHeightCm: room.height_cm,
          }
          if (ctx.controlsRef.current) ctx.controlsRef.current.enabled = false
          container.setPointerCapture(e.pointerId)
          return
        }
        if (hit?.kind === 'midpoint') {
          insertVertexAtMidpoint(room, hit.wallIndex)
          return
        }

        // No handle hit → maybe a wall?
        const wallIdx = rcWall(e.clientX, e.clientY)
        if (wallIdx != null) {
          const cursor = rcFloor(e.clientX, e.clientY)
          if (!cursor) return
          const vertices = getVertices(room)
          const a = vertices[wallIdx]
          const b = vertices[(wallIdx + 1) % vertices.length]
          const du = b.u - a.u, dv = b.v - a.v
          const len = Math.sqrt(du * du + dv * dv)
          if (len < 0.01) return
          // Outward normal for CCW polygon: rotate wall dir 90° CW
          const normalU = dv / len
          const normalV = -du / len
          const midU = (a.u + b.u) / 2
          const midV = (a.v + b.v) / 2
          const startProj = (cursor.x - midU) * normalU + (cursor.z - midV) * normalV

          wallDragRef.current = {
            wallIndex: wallIdx,
            vA: wallIdx,
            vB: (wallIdx + 1) % vertices.length,
            origA: { u: a.u, v: a.v },
            origB: { u: b.u, v: b.v },
            normalU, normalV,
            startProj,
            prevGeometry: JSON.parse(JSON.stringify(room.geometry)),
            prevWidthCm: room.width_cm,
            prevHeightCm: room.height_cm,
          }
          s.setSelectedVertex(null)
          if (ctx.controlsRef.current) ctx.controlsRef.current.enabled = false
          container.setPointerCapture(e.pointerId)
          return
        }

        // Empty click while editing → deselect vertex
        s.setSelectedVertex(null)
        return
      }

      // Fixture placement (door / window): click on wall commits the fixture.
      if (s.fixturePlacementType) {
        const hit = rcFloor(e.clientX, e.clientY)
        if (!hit) return
        const vertices = getVertices(room)
        const snap = nearestWallSnap(hit.x, hit.z, vertices)
        if (snap.length < 0.01) return
        commitFixturePlacement(
          room.id,
          s.fixturePlacementType,
          snap.wallIndex,
          snap.position,
          s.fixturePlacementItemId,
          s.fixturePlacementVariantId,
        )
        // Single-placement: exit placement mode after committing
        useCanvasStore.getState().setFixturePlacementMode(null)
        return
      }

      // Placement mode: click commits the ghost.
      if (s.placementMode && s.placementItemId && s.placementVariantId) {
        const hit = rcFloor(e.clientX, e.clientY)
        if (!hit) return
        const step = getGridStepCm(s.placementItemId)
        const snap = !e.ctrlKey && !e.metaKey
        const xCm = snapCm(hit.x * 100, step, !snap)
        const zCm = snapCm(hit.z * 100, step, !snap)
        const vertices = getVertices(room)
        const um = xCm / 100, vm = zCm / 100
        let finalU = um, finalV = vm
        if (!pointInPolygon(um, vm, vertices)) {
          const np = nearestPointOnPolygon(um, vm, vertices)
          finalU = np.u
          finalV = np.v
        }
        void useCanvasStore.getState().placeItem(room.id, finalU * 100, finalV * 100)
        return
      }

      // Fixture move: first click on a door/window picks it up. Next click
      // commits. Escape restores the pre-pickup geometry.
      const fm = fixtureMoveRef.current
      if (fm) {
        // Second click — commit wherever the fixture currently is.
        commitShapeEdit(room.id, fm.prevGeometry, fm.prevWidthCm, fm.prevHeightCm)
        fixtureMoveRef.current = null
        return
      }
      const fixHit = rcFixture(e.clientX, e.clientY)
      if (fixHit) {
        const room0 = useProjectStore.getState().rooms.find((r) => r.id === room.id)
        if (room0) {
          useCanvasStore.getState().setSelectedFixture(fixHit.fixtureId)
          fixtureMoveRef.current = {
            fixtureId: fixHit.fixtureId,
            fixtureType: fixHit.fixtureType,
            prevGeometry: JSON.parse(JSON.stringify(room0.geometry)),
            prevWidthCm: room0.width_cm,
            prevHeightCm: room0.height_cm,
          }
        }
        return
      }

      // Check if we hit a furniture item
      const hitId = rcFurniture(e.clientX, e.clientY)
      if (hitId) {
        useCanvasStore.getState().setSelectedItem(hitId)

        const placed = useCanvasStore.getState().placedFurniture.find((p) => p.id === hitId)
        if (!placed) return
        const floorHit = rcFloor(e.clientX, e.clientY)
        if (!floorHit) return
        dragStateRef.current = {
          placedId: hitId,
          prevX: placed.x_cm,
          prevZ: placed.z_cm,
          offsetX: placed.x_cm / 100 - floorHit.x,
          offsetZ: placed.z_cm / 100 - floorHit.z,
        }
        if (ctx.controlsRef.current) ctx.controlsRef.current.enabled = false
        container.setPointerCapture(e.pointerId)
      } else {
        // Clicked empty space → deselect
        useCanvasStore.getState().setSelectedItem(null)
        useCanvasStore.getState().setSelectedFixture(null)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      // Hover cursor — grab/copy/move in shape edit
      if (e.buttons === 0 && !vertexDragRef.current && !wallDragRef.current) {
        const inShapeEdit = useCanvasStore.getState().shapeEditMode
        if (inShapeEdit) {
          const handleHover = rcHandle(e.clientX, e.clientY)
          if (handleHover?.kind === 'vertex') {
            container.style.cursor = 'grab'
          } else if (handleHover?.kind === 'midpoint') {
            container.style.cursor = 'copy'
          } else if (rcWall(e.clientX, e.clientY) != null) {
            container.style.cursor = 'move'
          } else {
            container.style.cursor = ''
          }
        } else {
          container.style.cursor = ''
        }
      }

      // Vertex drag (shape edit mode)
      const vd = vertexDragRef.current
      if (vd) {
        const hit = rcFloor(e.clientX, e.clientY)
        if (!hit) return
        const bypass = e.ctrlKey || e.metaKey
        const stepM = 0.10 // 10cm grid
        const snapU = bypass ? hit.x : Math.round(hit.x / stepM) * stepM
        const snapV = bypass ? hit.z : Math.round(hit.z / stepM) * stepM
        updateVertexLocal(room.id, vd.vertexIndex, snapU, snapV)
        return
      }

      // Fixture move (door / window follows cursor until next click commits).
      // Skip when any button is held — that's an orbit drag, not a follow.
      const fm = fixtureMoveRef.current
      if (fm && e.buttons === 0) {
        const hit = rcFloor(e.clientX, e.clientY)
        if (!hit) return
        const projStore = useProjectStore
        const room0 = projStore.getState().rooms.find((r) => r.id === room.id)
        if (!room0) return
        const verts = getVertices(room0)
        const snap = nearestWallSnap(hit.x, hit.z, verts)
        if (snap.length < 0.01) return

        const geo = room0.geometry as RoomGeometry
        const existing = fm.fixtureType === 'door'
          ? (geo.doors ?? []).find((d) => d.id === fm.fixtureId)
          : (geo.windows ?? []).find((w) => w.id === fm.fixtureId)
        if (!existing) return
        const fixtureW = existing.width_m ?? (fm.fixtureType === 'door' ? 0.8 : 1.0)

        const halfW = Math.min(fixtureW / 2, snap.length * 0.45)
        const clamped = Math.max(
          halfW / snap.length,
          Math.min(1 - halfW / snap.length, snap.position),
        )

        const nextGeo: RoomGeometry = fm.fixtureType === 'door'
          ? {
              ...geo,
              doors: (geo.doors ?? []).map((d) =>
                d.id === fm.fixtureId ? { ...d, wall_index: snap.wallIndex, position: clamped } : d,
              ),
            }
          : {
              ...geo,
              windows: (geo.windows ?? []).map((w) =>
                w.id === fm.fixtureId ? { ...w, wall_index: snap.wallIndex, position: clamped } : w,
              ),
            }
        projStore.setState((state) => ({
          rooms: state.rooms.map((r) => (r.id === room.id ? { ...r, geometry: nextGeo } : r)),
          isDirty: true,
        }))
        return
      }

      // Wall push/pull drag (shape edit mode)
      const wd = wallDragRef.current
      if (wd) {
        const hit = rcFloor(e.clientX, e.clientY)
        if (!hit) return
        const midU = (wd.origA.u + wd.origB.u) / 2
        const midV = (wd.origA.v + wd.origB.v) / 2
        const currentProj = (hit.x - midU) * wd.normalU + (hit.z - midV) * wd.normalV
        const rawDelta = currentProj - wd.startProj
        const bypass = e.ctrlKey || e.metaKey
        const stepM = 0.10
        const delta = bypass ? rawDelta : Math.round(rawDelta / stepM) * stepM

        applyWallPush(room.id, wd, delta)
        return
      }

      // Placement ghost follow
      const s = useCanvasStore.getState()
      if (s.placementMode && ghostRefs.ghostGroupRef.current) {
        const hit = rcFloor(e.clientX, e.clientY)
        if (hit && s.placementItemId) {
          const step = getGridStepCm(s.placementItemId)
          const snap = !e.ctrlKey && !e.metaKey
          const xCm = snapCm(hit.x * 100, step, !snap)
          const zCm = snapCm(hit.z * 100, step, !snap)
          ghostRefs.ghostGroupRef.current.position.set(xCm / 100, 0, zCm / 100)
        }
      }

      // Fixture ghost follow — snap to nearest wall, rotate to match wall angle
      if (s.fixturePlacementType && ghostRefs.fixtureGhostRef.current) {
        const hit = rcFloor(e.clientX, e.clientY)
        if (hit) {
          const vertices = getVertices(room)
          const snap = nearestWallSnap(hit.x, hit.z, vertices)
          const { widthM, heightM } = getFixtureDims(
            s.fixturePlacementItemId,
            s.fixturePlacementVariantId,
            s.fixturePlacementType,
          )
          const halfW = widthM / 2
          const clampedPos = Math.max(
            halfW / snap.length,
            Math.min(1 - halfW / snap.length, snap.position),
          )
          const a = vertices[snap.wallIndex]
          const b = vertices[(snap.wallIndex + 1) % vertices.length]
          const cu = a.u + clampedPos * (b.u - a.u)
          const cv = a.v + clampedPos * (b.v - a.v)
          const ghost = ghostRefs.fixtureGhostRef.current
          ghost.visible = true
          // Window sill height — door sits on floor
          const ceilingH = (room.ceiling_height_cm ?? 260) / 100
          const y = s.fixturePlacementType === 'door'
            ? heightM / 2
            : ceilingH * 0.30 + heightM / 2
          ghost.position.set(cu, y, cv)
          ghost.rotation.y = -snap.angle
        }
      }

      // Drag update (furniture)
      const drag = dragStateRef.current
      if (drag) {
        const hit = rcFloor(e.clientX, e.clientY)
        if (!hit) return
        const step = getGridStepCm(
          useCanvasStore.getState().placedFurniture.find((p) => p.id === drag.placedId)?.furniture_item_id ?? '',
        )
        const bypass = e.ctrlKey || e.metaKey
        const targetU = hit.x + drag.offsetX
        const targetV = hit.z + drag.offsetZ
        const xCm = snapCm(targetU * 100, step, bypass)
        const zCm = snapCm(targetV * 100, step, bypass)
        const vertices = getVertices(room)
        let finalU = xCm / 100, finalV = zCm / 100
        if (!pointInPolygon(finalU, finalV, vertices)) {
          const np = nearestPointOnPolygon(finalU, finalV, vertices)
          finalU = np.u
          finalV = np.v
        }
        useCanvasStore.getState().moveItem(drag.placedId, finalU * 100, finalV * 100)
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragStateRef.current
      if (drag) {
        dragStateRef.current = null
        if (ctx.controlsRef.current) ctx.controlsRef.current.enabled = true
        container.releasePointerCapture(e.pointerId)
        useCanvasStore.getState().commitMove(drag.placedId, drag.prevX, drag.prevZ)
      }
      // Commit vertex drag: persist to DB + push undo command
      const vd = vertexDragRef.current
      if (vd) {
        vertexDragRef.current = null
        if (ctx.controlsRef.current) ctx.controlsRef.current.enabled = true
        container.releasePointerCapture(e.pointerId)
        commitShapeEdit(room.id, vd.prevGeometry, vd.prevWidthCm, vd.prevHeightCm)
      }

      // Commit wall drag
      const wd = wallDragRef.current
      if (wd) {
        wallDragRef.current = null
        if (ctx.controlsRef.current) ctx.controlsRef.current.enabled = true
        container.releasePointerCapture(e.pointerId)
        commitShapeEdit(room.id, wd.prevGeometry, wd.prevWidthCm, wd.prevHeightCm)
      }
    }

    const onWheel = (e: WheelEvent) => {
      const s = useCanvasStore.getState()
      const selId = s.selectedItemId
      if (!selId) return // let OrbitControls handle zoom
      const placed = s.placedFurniture.find((p) => p.id === selId)
      if (!placed) return
      // Scroll rotates the selected item instead of zooming
      e.preventDefault()
      e.stopPropagation()
      const step = e.ctrlKey || e.metaKey ? 1 : 15
      const dir = e.deltaY > 0 ? 1 : -1

      if (!rotateStateRef.current || rotateStateRef.current.placedId !== selId) {
        if (rotateStateRef.current) {
          useCanvasStore.getState().commitRotation(rotateStateRef.current.placedId, rotateStateRef.current.prevDeg)
        }
        rotateStateRef.current = { placedId: selId, prevDeg: placed.rotation_deg }
      }
      useCanvasStore.getState().setItemRotation(selId, placed.rotation_deg + dir * step)

      // Debounce: commit after the user stops scrolling for 300ms
      clearTimeout(wheelCommitTimer)
      wheelCommitTimer = window.setTimeout(() => {
        const rs = rotateStateRef.current
        if (rs) {
          useCanvasStore.getState().commitRotation(rs.placedId, rs.prevDeg)
          rotateStateRef.current = null
        }
      }, 300)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Roam mode WASD capture (runs first; if in roam, skip design-mode hotkeys)
      if (useUIStore.getState().cameraMode === 'roam') {
        if (e.key === 'w' || e.key === 'W') ctx.roamKeysRef.current.w = true
        else if (e.key === 's' || e.key === 'S') ctx.roamKeysRef.current.s = true
        else if (e.key === 'a' || e.key === 'A') ctx.roamKeysRef.current.a = true
        else if (e.key === 'd' || e.key === 'D') ctx.roamKeysRef.current.d = true
        else if (e.key === 'Shift') ctx.roamKeysRef.current.shift = true
        else if (e.key === 'Escape') useUIStore.getState().setCameraMode('design')
        return
      }

      const s = useCanvasStore.getState()
      if (e.key === 'Escape') {
        // Cancel an in-progress fixture pickup first — restore pre-pickup
        // geometry without persisting.
        const fm = fixtureMoveRef.current
        if (fm) {
          useProjectStore.setState((state) => ({
            rooms: state.rooms.map((r) =>
              r.id === room.id
                ? { ...r, geometry: fm.prevGeometry, width_cm: fm.prevWidthCm, height_cm: fm.prevHeightCm }
                : r,
            ),
          }))
          fixtureMoveRef.current = null
          return
        }
        if (s.placementMode) s.cancelPlacement()
        else if (s.fixturePlacementType) s.setFixturePlacementMode(null)
        else if (s.shapeEditMode && s.selectedVertexIndex != null) s.setSelectedVertex(null)
        else if (s.selectedItemId) s.setSelectedItem(null)
        else if (s.selectedFixtureId) s.setSelectedFixture(null)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.shapeEditMode && s.selectedVertexIndex != null) {
          e.preventDefault()
          deleteSelectedVertex(room.id, s.selectedVertexIndex)
          return
        }
        if (s.selectedItemId) {
          e.preventDefault()
          void s.removeItem(s.selectedItemId)
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W') ctx.roamKeysRef.current.w = false
      else if (e.key === 's' || e.key === 'S') ctx.roamKeysRef.current.s = false
      else if (e.key === 'a' || e.key === 'A') ctx.roamKeysRef.current.a = false
      else if (e.key === 'd' || e.key === 'D') ctx.roamKeysRef.current.d = false
      else if (e.key === 'Shift') ctx.roamKeysRef.current.shift = false
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerUp)
    container.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerUp)
      container.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      clearTimeout(wheelCommitTimer)
    }
  }, [ctx, room, ghostRefs])
}
