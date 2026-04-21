import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { getVertices } from '@/lib/roomGeometry'
import type { Room, RoomGeometry, RoomDoor, RoomWindow } from '@/types'
import { getFixtureDims } from './gridSnap'

/**
 * Pure room-geometry mutations extracted from the RoomCanvas component's
 * pointer handlers. They operate through useProjectStore + useCanvasStore
 * directly (reading the freshest state via `.getState()`) and push undo
 * commands onto the canvas store.
 *
 * None of these functions hold React refs — they take whatever arguments
 * they need and return either void or the freshly-computed state.
 */

/**
 * Live vertex update during drag. Uses `useProjectStore.setState` so we only
 * touch local state (no DB write on every pointermove). Callers are
 * responsible for eventually committing via `commitShapeEdit`.
 */
export function updateVertexLocal(
  roomId: string,
  vertexIndex: number,
  newU: number,
  newV: number,
): void {
  const projStore = useProjectStore
  const room0 = projStore.getState().rooms.find((r) => r.id === roomId)
  if (!room0) return
  const curVerts = getVertices(room0)
  if (vertexIndex < 0 || vertexIndex >= curVerts.length) return
  const newVerts = curVerts.map((v, i) => (i === vertexIndex ? { u: newU, v: newV } : v))

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const v of newVerts) {
    if (v.u < minU) minU = v.u; if (v.u > maxU) maxU = v.u
    if (v.v < minV) minV = v.v; if (v.v > maxV) maxV = v.v
  }
  const newGeo: RoomGeometry = { ...room0.geometry, vertices: newVerts }
  projStore.setState((state) => ({
    rooms: state.rooms.map((r) => r.id === roomId
      ? { ...r, geometry: newGeo, width_cm: Math.round((maxU - minU) * 100), height_cm: Math.round((maxV - minV) * 100) }
      : r,
    ),
    isDirty: true,
  }))
}

/**
 * Commit whatever the current local geometry is to the DB + push an undo
 * command with the given pre-drag snapshot. Used by both vertex drag and
 * wall push/pull — they differ only in what happens during pointermove.
 */
export function commitShapeEdit(
  roomId: string,
  prevGeo: RoomGeometry,
  prevW: number,
  prevH: number,
): void {
  const projStore = useProjectStore
  const room0 = projStore.getState().rooms.find((r) => r.id === roomId)
  if (!room0) return
  void projStore.getState().updateRoom(roomId, {
    geometry: room0.geometry,
    width_cm: room0.width_cm,
    height_cm: room0.height_cm,
  })
  useCanvasStore.getState().pushGeometryCommand(
    roomId,
    prevGeo,
    JSON.parse(JSON.stringify(room0.geometry)),
    prevW,
    prevH,
    room0.width_cm,
    room0.height_cm,
  )
}

/**
 * Wall push/pull: rebuild polygon from the pre-drag snapshot.
 *
 * For each endpoint of the pushed wall, look at its *other* neighbor wall:
 *  - If parallel to the push normal, the endpoint moves (the adjacent wall
 *    just stretches — moving it prevents a collinear-spike artifact).
 *  - Otherwise, the endpoint stays and a new vertex is inserted at the
 *    pushed position, creating a clean 90° corner (bump-out / notch-in).
 *
 * This is what keeps push/pull orthogonal — adjacent walls never slant,
 * and midpoint-added vertices stay put unless explicitly dragged.
 */
export function applyWallPush(
  roomId: string,
  wd: {
    vA: number
    vB: number
    origA: { u: number; v: number }
    origB: { u: number; v: number }
    normalU: number
    normalV: number
    prevGeometry: RoomGeometry
  },
  delta: number,
): void {
  const room0 = useProjectStore.getState().rooms.find((r) => r.id === roomId)
  if (!room0) return
  const prevVerts = wd.prevGeometry.vertices ?? getVertices(room0)
  if (!prevVerts || prevVerts.length < 3) return
  const N = prevVerts.length
  const iA = wd.vA
  const iB = wd.vB
  const iPrev = (iA - 1 + N) % N
  const iNext = (iB + 1) % N
  const nU = wd.normalU
  const nV = wd.normalV
  const newA = { u: wd.origA.u + nU * delta, v: wd.origA.v + nV * delta }
  const newB = { u: wd.origB.u + nU * delta, v: wd.origB.v + nV * delta }

  // Direction of A's other neighbor wall: iPrev → A. Parallel to push
  // normal iff |dot(dir, n)| is close to 1. Threshold 0.5 cleanly separates
  // orthogonal from axis-aligned without being fussy about near-right
  // angles from earlier vertex drags.
  const dPrevU = wd.origA.u - prevVerts[iPrev].u
  const dPrevV = wd.origA.v - prevVerts[iPrev].v
  const prevLen = Math.hypot(dPrevU, dPrevV)
  const prevParallel = prevLen > 1e-4 &&
    Math.abs((dPrevU * nU + dPrevV * nV) / prevLen) > 0.5

  const dNextU = prevVerts[iNext].u - wd.origB.u
  const dNextV = prevVerts[iNext].v - wd.origB.v
  const nextLen = Math.hypot(dNextU, dNextV)
  const nextParallel = nextLen > 1e-4 &&
    Math.abs((dNextU * nU + dNextV * nV) / nextLen) > 0.5

  const out: { u: number; v: number }[] = []
  for (let i = 0; i < N; i++) {
    if (i === iA) {
      if (prevParallel) {
        out.push(newA)
      } else {
        out.push(prevVerts[i])
        out.push(newA)
      }
    } else if (i === iB) {
      if (nextParallel) {
        out.push(newB)
      } else {
        out.push(newB)
        out.push(prevVerts[i])
      }
    } else {
      out.push(prevVerts[i])
    }
  }

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const v of out) {
    if (v.u < minU) minU = v.u; if (v.u > maxU) maxU = v.u
    if (v.v < minV) minV = v.v; if (v.v > maxV) maxV = v.v
  }
  const newGeo: RoomGeometry = { ...wd.prevGeometry, vertices: out }
  useProjectStore.setState((state) => ({
    rooms: state.rooms.map((r) => r.id === roomId
      ? { ...r, geometry: newGeo, width_cm: Math.round((maxU - minU) * 100), height_cm: Math.round((maxV - minV) * 100) }
      : r,
    ),
    isDirty: true,
  }))
}

/** Insert a new vertex at the midpoint of wall `wallIndex`. */
export function insertVertexAtMidpoint(room: Room, wallIndex: number): void {
  const projStore = useProjectStore
  const room0 = projStore.getState().rooms.find((x) => x.id === room.id)
  if (!room0) return
  const curVerts = getVertices(room0)
  const a = curVerts[wallIndex]
  const b = curVerts[(wallIndex + 1) % curVerts.length]
  const mid = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 }
  const newVerts = [...curVerts]
  newVerts.splice(wallIndex + 1, 0, mid)
  const prevGeo = JSON.parse(JSON.stringify(room0.geometry)) as RoomGeometry
  const nextGeo: RoomGeometry = { ...room0.geometry, vertices: newVerts }
  void projStore.getState().updateRoom(room.id, { geometry: nextGeo })
  useCanvasStore.getState().pushGeometryCommand(
    room.id, prevGeo, JSON.parse(JSON.stringify(nextGeo)),
    room0.width_cm, room0.height_cm, room0.width_cm, room0.height_cm,
  )
  useCanvasStore.getState().setSelectedVertex(wallIndex + 1)
}

/** Delete a vertex (minimum 3 remaining). */
export function deleteSelectedVertex(roomId: string, vertexIndex: number): void {
  const projStore = useProjectStore
  const room0 = projStore.getState().rooms.find((r) => r.id === roomId)
  if (!room0) return
  const curVerts = getVertices(room0)
  if (curVerts.length <= 3) return
  const newVerts = curVerts.filter((_, i) => i !== vertexIndex)
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const v of newVerts) {
    if (v.u < minU) minU = v.u; if (v.u > maxU) maxU = v.u
    if (v.v < minV) minV = v.v; if (v.v > maxV) maxV = v.v
  }
  const prevGeo = JSON.parse(JSON.stringify(room0.geometry)) as RoomGeometry
  const nextGeo: RoomGeometry = { ...room0.geometry, vertices: newVerts }
  const nextW = Math.round((maxU - minU) * 100)
  const nextH = Math.round((maxV - minV) * 100)
  void projStore.getState().updateRoom(roomId, { geometry: nextGeo, width_cm: nextW, height_cm: nextH })
  useCanvasStore.getState().pushGeometryCommand(
    roomId, prevGeo, JSON.parse(JSON.stringify(nextGeo)),
    room0.width_cm, room0.height_cm, nextW, nextH,
  )
  useCanvasStore.getState().setSelectedVertex(null)
}

/**
 * Writes a new door or window into `room.geometry.{doors|windows}[]` and
 * pushes a geometry undo command. Width/height come from the selected
 * variant's dimensions (falls back to sensible defaults for unnamed vars).
 */
export function commitFixturePlacement(
  roomId: string,
  type: 'door' | 'window',
  wallIndex: number,
  position: number,
  itemId: string | null,
  variantId: string | null,
): void {
  const projStore = useProjectStore
  const room0 = projStore.getState().rooms.find((r) => r.id === roomId)
  if (!room0) return
  const prevGeo = JSON.parse(JSON.stringify(room0.geometry)) as RoomGeometry
  const { widthM, heightM } = getFixtureDims(itemId, variantId, type)

  // Clamp position so fixture fits on the wall
  const verts = getVertices(room0)
  const a = verts[wallIndex], b = verts[(wallIndex + 1) % verts.length]
  const wallLen = Math.sqrt((b.u - a.u) ** 2 + (b.v - a.v) ** 2)
  const halfW = Math.min(widthM / 2, wallLen * 0.45)
  const clampedPos = Math.max(
    halfW / wallLen,
    Math.min(1 - halfW / wallLen, position),
  )

  const newId = crypto.randomUUID()
  let nextGeo: RoomGeometry
  if (type === 'door') {
    const newDoor: RoomDoor = {
      id: newId,
      wall_index: wallIndex,
      position: clampedPos,
      width_m: Math.max(0.3, Math.min(3, widthM)),
      height_m: Math.max(0.3, heightM),
      variant_id: variantId,
    }
    nextGeo = { ...room0.geometry, doors: [...(room0.geometry.doors ?? []), newDoor] }
  } else {
    const ceilingH = (room0.ceiling_height_cm ?? 260) / 100
    const newWindow: RoomWindow = {
      id: newId,
      wall_index: wallIndex,
      position: clampedPos,
      width_m: Math.max(0.3, Math.min(3, widthM)),
      height_m: Math.max(0.3, heightM),
      sill_m: Math.round(ceilingH * 0.30 * 10) / 10,
      curtain_style: 'none',
      variant_id: variantId,
    }
    nextGeo = { ...room0.geometry, windows: [...(room0.geometry.windows ?? []), newWindow] }
  }

  void projStore.getState().updateRoom(roomId, { geometry: nextGeo })
  useCanvasStore.getState().pushGeometryCommand(
    roomId,
    prevGeo,
    JSON.parse(JSON.stringify(nextGeo)),
    room0.width_cm, room0.height_cm,
    room0.width_cm, room0.height_cm,
  )
  useCanvasStore.getState().setSelectedFixture(newId)
}
