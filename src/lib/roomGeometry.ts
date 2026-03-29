/**
 * Polygon room geometry utilities.
 * All coordinates are in room-local metres (u = width axis, v = depth axis).
 * Vertices are stored counter-clockwise when viewed from above.
 */

import type { Room, RoomVertex, RoomGeometry, RoomDoor, RoomWindow, Direction, PhysicalWall } from '@/types'

// ── Vertex retrieval ─────────────────────────────────────────────────────────

/** Get polygon vertices from room, falling back to rectangle if absent. */
export function getVertices(room: Room): RoomVertex[] {
  const geo = room.geometry as RoomGeometry
  if (geo.vertices && geo.vertices.length >= 3) return geo.vertices
  const W = room.width_cm / 100
  const D = room.height_cm / 100
  return [
    { u: 0, v: 0 },
    { u: W, v: 0 },
    { u: W, v: D },
    { u: 0, v: D },
  ]
}

// ── Bounding box ─────────────────────────────────────────────────────────────

export function computeBoundingBox(vertices: RoomVertex[]): { width_cm: number; height_cm: number } {
  const us = vertices.map(v => v.u)
  const vs = vertices.map(v => v.v)
  return {
    width_cm: Math.round((Math.max(...us) - Math.min(...us)) * 100),
    height_cm: Math.round((Math.max(...vs) - Math.min(...vs)) * 100),
  }
}

// ── Point-in-polygon (ray-casting) ───────────────────────────────────────────

export function pointInPolygon(u: number, v: number, vertices: RoomVertex[]): boolean {
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const ui = vertices[i].u, vi = vertices[i].v
    const uj = vertices[j].u, vj = vertices[j].v
    if ((vi > v) !== (vj > v) && u < (uj - ui) * (v - vi) / (vj - vi) + ui) {
      inside = !inside
    }
  }
  return inside
}

// ── Nearest point on polygon boundary ────────────────────────────────────────

function nearestPointOnSegment(
  pu: number, pv: number,
  au: number, av: number, bu: number, bv: number,
): { u: number; v: number; dist2: number } {
  const du = bu - au, dv = bv - av
  const len2 = du * du + dv * dv
  if (len2 === 0) return { u: au, v: av, dist2: (pu - au) ** 2 + (pv - av) ** 2 }
  const t = Math.max(0, Math.min(1, ((pu - au) * du + (pv - av) * dv) / len2))
  const cu = au + t * du, cv = av + t * dv
  return { u: cu, v: cv, dist2: (pu - cu) ** 2 + (pv - cv) ** 2 }
}

export function nearestPointOnPolygon(u: number, v: number, vertices: RoomVertex[]): RoomVertex {
  let bestU = vertices[0].u, bestV = vertices[0].v, bestDist2 = Infinity
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length]
    const p = nearestPointOnSegment(u, v, a.u, a.v, b.u, b.v)
    if (p.dist2 < bestDist2) {
      bestU = p.u; bestV = p.v; bestDist2 = p.dist2
    }
  }
  return { u: bestU, v: bestV }
}

// ── Polygon centroid ─────────────────────────────────────────────────────────

export function polygonCentroid(vertices: RoomVertex[]): RoomVertex {
  let su = 0, sv = 0
  for (const v of vertices) { su += v.u; sv += v.v }
  return { u: su / vertices.length, v: sv / vertices.length }
}

// ── Wall segment length ──────────────────────────────────────────────────────

export function wallSegmentLength(a: RoomVertex, b: RoomVertex): number {
  return Math.sqrt((b.u - a.u) ** 2 + (b.v - a.v) ** 2)
}

// ── Room rotation ────────────────────────────────────────────────────────────

/** Rotate a single vertex by 90° increments around bounding box. */
function rotateVertex(v: RoomVertex, bboxW: number, bboxD: number, rot: Direction): RoomVertex {
  switch (rot) {
    case 'front_left':  return { u: v.u, v: v.v }
    case 'front_right': return { u: bboxD - v.v, v: v.u }
    case 'back_right':  return { u: bboxW - v.u, v: bboxD - v.v }
    case 'back_left':   return { u: v.v, v: bboxW - v.u }
  }
}

/** Rotate all vertices and normalize so min coords are at 0. */
export function rotateVertices(
  vertices: RoomVertex[], bboxW: number, bboxD: number, rot: Direction,
): RoomVertex[] {
  const rotated = vertices.map(v => rotateVertex(v, bboxW, bboxD, rot))
  const minU = Math.min(...rotated.map(v => v.u))
  const minV = Math.min(...rotated.map(v => v.v))
  return rotated.map(v => ({ u: v.u - minU, v: v.v - minV }))
}

/** Rotate a single (u,v) point (e.g. furniture position) using same transform. */
export function rotatePoint(
  u: number, v: number, bboxW: number, bboxD: number, rot: Direction,
): { u: number; v: number } {
  const rv = rotateVertex({ u, v }, bboxW, bboxD, rot)
  // Must apply same normalization offset as rotateVertices
  // Compute the offset from the bounding box
  const corners: RoomVertex[] = [
    { u: 0, v: 0 }, { u: bboxW, v: 0 }, { u: bboxW, v: bboxD }, { u: 0, v: bboxD },
  ]
  const rotCorners = corners.map(c => rotateVertex(c, bboxW, bboxD, rot))
  const minU = Math.min(...rotCorners.map(c => c.u))
  const minV = Math.min(...rotCorners.map(c => c.v))
  return { u: rv.u - minU, v: rv.v - minV }
}

/** Inverse rotation: convert rotated (u,v) back to original room coords. */
export function unrotatePoint(
  u: number, v: number, bboxW: number, bboxD: number, rot: Direction,
): { u: number; v: number } {
  // First add back the normalization offset
  const corners: RoomVertex[] = [
    { u: 0, v: 0 }, { u: bboxW, v: 0 }, { u: bboxW, v: bboxD }, { u: 0, v: bboxD },
  ]
  const rotCorners = corners.map(c => rotateVertex(c, bboxW, bboxD, rot))
  const minU = Math.min(...rotCorners.map(c => c.u))
  const minV = Math.min(...rotCorners.map(c => c.v))
  const ru = u + minU, rv = v + minV
  // Then inverse the rotation
  switch (rot) {
    case 'front_left':  return { u: ru, v: rv }
    case 'front_right': return { u: rv, v: bboxD - ru }
    case 'back_right':  return { u: bboxW - ru, v: bboxD - rv }
    case 'back_left':   return { u: bboxW - rv, v: ru }
  }
}

// ── Wall visibility ──────────────────────────────────────────────────────────

const CAMERA_DIRS: Record<Direction, { u: number; v: number }> = {
  front_left:  { u: 1, v: 1 },
  front_right: { u: -1, v: 1 },
  back_right:  { u: -1, v: -1 },
  back_left:   { u: 1, v: -1 },
}

/** Check if wall segment A→B faces the camera (visible). Vertices must be CCW. */
export function isWallVisible(a: RoomVertex, b: RoomVertex, rot: Direction): boolean {
  // Outward normal for CCW winding (points to right of A→B direction)
  const du = b.u - a.u, dv = b.v - a.v
  const nu = dv, nv = -du
  const cam = CAMERA_DIRS[rot]
  return nu * cam.u + nv * cam.v > 0
}

/** Classify wall as "left-facing" (darker shade) or "right-facing" (lighter shade). */
export function isWallLeftFacing(a: RoomVertex, b: RoomVertex): boolean {
  // Walls going in the negative-u direction are "left-facing" (darker)
  const du = b.u - a.u
  return du <= 0
}

// ── Legacy fixture migration ─────────────────────────────────────────────────

const PHYSICAL_TO_INDEX: Record<PhysicalWall, number> = {
  south: 0,
  east: 1,
  north: 2,
  west: 3,
}

/** Convert legacy PhysicalWall to wall_index for rectangle rooms. */
export function migrateFixtureWallIndex(fixture: RoomDoor | RoomWindow): number {
  if (fixture.wall_index != null) return fixture.wall_index
  if (fixture.wall) return PHYSICAL_TO_INDEX[fixture.wall] ?? 0
  return 0
}

// ── Front reference point ────────────────────────────────────────────────────

const T = 64

/** Compute the isometric "front" reference point from rotated bounding box. */
export function computeFront(effW: number, effD: number, cx: number, cy: number) {
  const fx = cx - (effW - effD) * T / 2
  const fy = cy + (effW + effD) * T / 4
  return { x: fx, y: fy }
}

/** Project room (u,v) to screen (sx,sy). */
export function roomToScreen(u: number, v: number, front: { x: number; y: number }) {
  return { sx: front.x + u * T - v * T, sy: front.y - u * T / 2 - v * T / 2 }
}

/** Project screen (sx,sy) back to room (u,v). */
export function screenToRoom(sx: number, sy: number, front: { x: number; y: number }) {
  const dx = sx - front.x, dy = sy - front.y
  return { u: (dx - 2 * dy) / (2 * T), v: (-dx - 2 * dy) / (2 * T) }
}
