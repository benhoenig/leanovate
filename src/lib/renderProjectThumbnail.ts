/**
 * Renders an isometric snapshot of a project's primary room for the
 * dashboard project card. Fire-and-forget after save; also manually
 * refreshable from the dashboard card's ⋯ menu.
 *
 * Why isometric (and not the design-mode preset or eye-level preview):
 * recognition matters more than mood on the dashboard — designers need
 * to tell projects apart at a glance. A consistent isometric angle
 * makes layout the distinguishing signal.
 *
 * Scene construction mirrors `renderRoomPreview.ts` (same room shell
 * geometry, finish colors, .glb loading) but with a simpler lighting
 * rig and an OrthographicCamera at 45° yaw / 35.264° elevation. No
 * post-processing — cards are small, the extra render time isn't worth
 * it.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  supabase,
  rawStorageDownload,
  rawStorageUpload,
  rawUpdate,
  getPublicStorageUrl,
} from './supabase'
import { getVertices, polygonCentroid, signedArea } from './roomGeometry'
import type {
  Room,
  FinishMaterial,
  PlacedFurniture,
  FurnitureVariant,
  FurnitureItem,
  RoomDoor,
  RoomWindow,
} from '@/types'

// 16:10 — reads well at dashboard card sizes (260px wide min).
const THUMB_WIDTH = 640
const THUMB_HEIGHT = 400

export interface RenderProjectThumbnailParams {
  room: Room
  finishMaterials: FinishMaterial[]
  placedFurniture: PlacedFurniture[]
  /** Keyed by furniture_item_id. */
  variants: Record<string, FurnitureVariant[]>
  /** Keyed by furniture_item_id. */
  items: Record<string, FurnitureItem>
}

export interface RenderResult {
  blob: Blob | null
  error: string | null
  warnings: string[]
}

// ─── Public entry points ──────────────────────────────────────────────────────

/**
 * Render the thumbnail to a PNG blob. Pure — no DB/storage side effects.
 */
export async function renderProjectThumbnail(
  params: RenderProjectThumbnailParams,
): Promise<RenderResult> {
  try {
    return await renderIsometric(params)
  } catch (err) {
    return { blob: null, error: String(err), warnings: [] }
  }
}

/**
 * Render, upload to `thumbnails` bucket, and write the path back to
 * `projects.thumbnail_path`. Returns the storage path on success.
 *
 * Safe to call from the EditorPage Save flow (uses raw fetch for the
 * write, which bypasses Supabase client concurrency) and from the
 * DashboardPage manual refresh (CatalogPanel not mounted there anyway).
 */
export async function saveProjectThumbnail(
  projectId: string,
  params: RenderProjectThumbnailParams,
): Promise<{ path: string | null; error: string | null; warnings: string[] }> {
  const { blob, error: renderErr, warnings } = await renderProjectThumbnail(params)
  if (renderErr || !blob) {
    return { path: null, error: renderErr ?? 'render returned no blob', warnings }
  }

  const path = `projects/${projectId}.png`
  const { error: upErr } = await rawStorageUpload('thumbnails', path, blob, {
    contentType: 'image/png',
    upsert: true,
  })
  if (upErr) return { path: null, error: upErr, warnings }

  const { error: dbErr } = await rawUpdate('projects', projectId, { thumbnail_path: path })
  if (dbErr) return { path: null, error: dbErr, warnings }

  return { path, error: null, warnings }
}

/**
 * Public URL for a project thumbnail (or null if no path). Cache-busted
 * with updated_at so a freshly-regenerated image replaces the browser's
 * cached copy immediately.
 */
export function getProjectThumbnailUrl(
  thumbnailPath: string | null,
  cacheBustKey?: string | null,
): string | null {
  if (!thumbnailPath) return null
  const base = getPublicStorageUrl('thumbnails', thumbnailPath)
  return cacheBustKey ? `${base}?v=${encodeURIComponent(cacheBustKey)}` : base
}

/**
 * Manual-refresh path — loads the project's primary room, its furniture,
 * and all referenced variants/items/finish materials fresh from the DB,
 * then renders + uploads.
 *
 * Intended to be called from places where no relevant state is loaded
 * locally (the dashboard). Uses the supabase client for reads, which is
 * safe there because CatalogPanel isn't mounted and nothing else is
 * polling the client concurrently.
 *
 * Returns `{ path: null, noRooms: true }` if the project has no rooms —
 * callers should surface a helpful message ("Add a room first") rather
 * than treating this as a render failure.
 */
export async function refreshProjectThumbnailFromDb(
  projectId: string,
): Promise<{ path: string | null; error: string | null; noRooms: boolean }> {
  const { data: rooms, error: roomsErr } = await supabase
    .from('rooms')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .limit(1)
  if (roomsErr) return { path: null, error: roomsErr.message, noRooms: false }
  if (!rooms || rooms.length === 0) return { path: null, error: null, noRooms: true }

  const primary = rooms[0] as Room

  const { data: placed, error: placedErr } = await supabase
    .from('placed_furniture')
    .select('*')
    .eq('room_id', primary.id)
  if (placedErr) return { path: null, error: placedErr.message, noRooms: false }
  const placedFurniture = (placed ?? []) as PlacedFurniture[]

  const itemIds = Array.from(new Set(placedFurniture.map((p) => p.furniture_item_id)))
  const variantIds = Array.from(new Set(placedFurniture.map((p) => p.selected_variant_id)))

  const items: Record<string, FurnitureItem> = {}
  const variants: Record<string, FurnitureVariant[]> = {}

  if (itemIds.length > 0) {
    const { data: itemRows } = await supabase
      .from('furniture_items')
      .select('*')
      .in('id', itemIds)
    for (const it of (itemRows ?? []) as FurnitureItem[]) items[it.id] = it
  }

  if (variantIds.length > 0) {
    const { data: variantRows } = await supabase
      .from('furniture_variants')
      .select('*')
      .in('id', variantIds)
    for (const v of (variantRows ?? []) as FurnitureVariant[]) {
      const arr = variants[v.furniture_item_id] ?? []
      arr.push(v)
      variants[v.furniture_item_id] = arr
    }
  }

  const { data: finishRows } = await supabase.from('finish_materials').select('*')
  const finishMaterials = (finishRows ?? []) as FinishMaterial[]

  const { path, error } = await saveProjectThumbnail(projectId, {
    room: primary,
    finishMaterials,
    placedFurniture,
    variants,
    items,
  })
  return { path, error, noRooms: false }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

async function renderIsometric(
  params: RenderProjectThumbnailParams,
): Promise<RenderResult> {
  const { room, finishMaterials, placedFurniture, variants, items } = params
  const warnings: string[] = []

  const canvas = document.createElement('canvas')
  canvas.width = THUMB_WIDTH
  canvas.height = THUMB_HEIGHT

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.setSize(THUMB_WIDTH, THUMB_HEIGHT, false)
  renderer.setPixelRatio(1)
  renderer.setClearColor(0xf5f3ef, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf5f3ef)

  try {
    const vertices = getVertices(room)
    const ceilingH = (room.ceiling_height_cm ?? 260) / 100
    const centroid = polygonCentroid(vertices)

    const wallColor = getFinishHex(room.finishes?.wall?.material_id, 'wall', finishMaterials)
    const floorColor = getFinishHex(room.finishes?.floor?.material_id, 'floor', finishMaterials)
    // Doors/windows are fixtures (not finishes) — hardcoded fallback panel
    // colors for when the placed variant has no `.glb` yet.
    const doorColor = '#C4B8A8'
    const windowColor = '#DDEEFF'

    // ── Floor ───────────────────────────────────────────────────────────────
    const floorShape = new THREE.Shape()
    floorShape.moveTo(vertices[0].u, vertices[0].v)
    for (let i = 1; i < vertices.length; i++) {
      floorShape.lineTo(vertices[i].u, vertices[i].v)
    }
    floorShape.closePath()

    const floorGeo = new THREE.ShapeGeometry(floorShape)
    const floorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(floorColor),
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
    })
    const floorMesh = new THREE.Mesh(floorGeo, floorMat)
    floorMesh.rotation.x = Math.PI / 2
    scene.add(floorMesh)

    // ── Walls (dollhouse — cull near walls so the camera looking down
    //    from outside sees the interior. No ceiling either, so the room
    //    reads as a floor plan with volume.) ────────────────────────────
    //
    // Picking the right `side` depends on which way the polygon is wound:
    //
    //   • CCW polygon  → wall normals point INWARD. Near walls are
    //                    back-facing to the outside camera, far walls
    //                    are front-facing. `FrontSide` culls near.
    //
    //   • CW polygon   → wall normals point OUTWARD. Flipped: near
    //                    walls are front-facing, far walls back-facing.
    //                    `BackSide` culls near.
    //
    // Mixed winding is real today (default rectangles are CCW, shape-
    // edited rooms can end up CW), so we detect and adapt rather than
    // assuming one convention.
    const isCCW = signedArea(vertices) > 0
    const wallSide = isCCW ? THREE.FrontSide : THREE.BackSide
    const wallMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(wallColor),
      roughness: 0.6,
      metalness: 0,
      side: wallSide,
    })
    const doorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(doorColor),
      roughness: 0.4,
      metalness: 0.05,
      side: THREE.DoubleSide,
    })
    const windowGlassMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(windowColor),
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    })

    const allDoors: RoomDoor[] = room.geometry?.doors ?? []
    const allWindows: RoomWindow[] = room.geometry?.windows ?? []

    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i]
      const b = vertices[(i + 1) % vertices.length]
      const wallLen = Math.hypot(b.u - a.u, b.v - a.v)
      if (wallLen < 0.01) continue
      const angle = Math.atan2(b.v - a.v, b.u - a.u)

      const wallDoors = allDoors.filter((d) => d.wall_index === i)
      const wallWindows = allWindows.filter((w) => w.wall_index === i)

      if (wallDoors.length === 0 && wallWindows.length === 0) {
        const wallGeo = new THREE.PlaneGeometry(wallLen, ceilingH)
        const wall = new THREE.Mesh(wallGeo, wallMat)
        wall.position.set((a.u + b.u) / 2, ceilingH / 2, (a.v + b.v) / 2)
        wall.rotation.y = -angle
        scene.add(wall)
      } else {
        const wallShape = new THREE.Shape()
        wallShape.moveTo(0, 0)
        wallShape.lineTo(wallLen, 0)
        wallShape.lineTo(wallLen, ceilingH)
        wallShape.lineTo(0, ceilingH)
        wallShape.closePath()

        for (const door of wallDoors) {
          const cx = door.position * wallLen
          const w = door.width_m ?? 0.8
          const h = door.height_m ?? ceilingH * 0.82
          const x0 = Math.max(0, cx - w / 2)
          const x1 = Math.min(wallLen, cx + w / 2)

          const hole = new THREE.Path()
          hole.moveTo(x0, 0)
          hole.lineTo(x1, 0)
          hole.lineTo(x1, h)
          hole.lineTo(x0, h)
          hole.closePath()
          wallShape.holes.push(hole)

          const panel = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, h), doorMat)
          const localX = (x0 + x1) / 2 - wallLen / 2
          const cosA = Math.cos(-angle)
          const sinA = Math.sin(-angle)
          const midU = (a.u + b.u) / 2
          const midV = (a.v + b.v) / 2
          panel.position.set(midU + localX * cosA, h / 2, midV - localX * sinA)
          panel.rotation.y = -angle
          scene.add(panel)
        }

        for (const win of wallWindows) {
          const cx = win.position * wallLen
          const w = win.width_m ?? 1.0
          const sill = win.sill_m ?? ceilingH * 0.3
          const h = win.height_m ?? ceilingH * 0.48
          const x0 = Math.max(0, cx - w / 2)
          const x1 = Math.min(wallLen, cx + w / 2)

          const hole = new THREE.Path()
          hole.moveTo(x0, sill)
          hole.lineTo(x1, sill)
          hole.lineTo(x1, sill + h)
          hole.lineTo(x0, sill + h)
          hole.closePath()
          wallShape.holes.push(hole)

          const glass = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, h), windowGlassMat)
          const localX = (x0 + x1) / 2 - wallLen / 2
          const localY = sill + h / 2
          const cosA = Math.cos(-angle)
          const sinA = Math.sin(-angle)
          const midU = (a.u + b.u) / 2
          const midV = (a.v + b.v) / 2
          glass.position.set(midU + localX * cosA, localY, midV - localX * sinA)
          glass.rotation.y = -angle
          scene.add(glass)
        }

        const wall = new THREE.Mesh(new THREE.ShapeGeometry(wallShape), wallMat)
        wall.position.set(a.u, 0, a.v)
        wall.rotation.y = -angle
        scene.add(wall)
      }
    }

    // ── Lighting — bright & even for a product-catalog feel ─────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    const key = new THREE.DirectionalLight(0xffffff, 1.0)
    key.position.set(centroid.u + 5, ceilingH + 5, centroid.v + 5)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.4)
    fill.position.set(centroid.u - 5, ceilingH + 3, centroid.v - 5)
    scene.add(fill)

    // ── Furniture ──────────────────────────────────────────────────────────
    const loader = new GLTFLoader()
    for (const pf of placedFurniture) {
      const itemVariants = variants[pf.furniture_item_id] ?? []
      const variant = itemVariants.find((v) => v.id === pf.selected_variant_id)
      const item = items[pf.furniture_item_id]

      // Flat items, missing .glb, or pending-render — drop a small
      // placeholder box so the layout still reads. Not worth loading
      // textures for a 640×400 thumbnail.
      if (!variant?.glb_path) {
        addPlaceholder(scene, pf, variant, item)
        continue
      }

      try {
        const { blob: glbBlob, error: dlErr } = await rawStorageDownload('glb-models', variant.glb_path)
        if (dlErr || !glbBlob) {
          warnings.push(`Missing model for ${item?.name ?? 'item'}`)
          addPlaceholder(scene, pf, variant, item)
          continue
        }
        const buffer = await glbBlob.arrayBuffer()
        const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
          loader.parse(buffer, '', (r) => resolve(r), (e) => reject(e))
        })

        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const modelSize = box.getSize(new THREE.Vector3())
        const modelCenter = box.getCenter(new THREE.Vector3())

        const targetW = (variant.width_cm ?? item?.width_cm ?? 50) / 100
        const targetD = (variant.depth_cm ?? item?.depth_cm ?? 50) / 100
        const targetH = (variant.height_cm ?? item?.height_cm ?? 50) / 100
        const maxModelDim = Math.max(modelSize.x, modelSize.y, modelSize.z, 0.0001)
        const maxTargetDim = Math.max(targetW, targetD, targetH)
        const scale = (maxTargetDim / maxModelDim) * (pf.scale_factor ?? 1)

        model.scale.setScalar(scale)
        model.position.sub(modelCenter.multiplyScalar(scale))
        model.position.x += pf.x_cm / 100
        model.position.y += (modelSize.y * scale) / 2 + pf.y_cm / 100
        model.position.z += pf.z_cm / 100
        model.rotation.y = (pf.rotation_deg * Math.PI) / 180
        scene.add(model)
      } catch (err) {
        warnings.push(`Error loading ${item?.name ?? 'item'}: ${String(err)}`)
        addPlaceholder(scene, pf, variant, item)
      }
    }

    // ── Isometric camera, framed to fit the whole room + furniture headroom ─
    const camera = buildIsometricCamera(vertices, ceilingH, THUMB_WIDTH / THUMB_HEIGHT)
    renderer.render(scene, camera)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png')
    })
    if (!blob) {
      return { blob: null, error: 'canvas.toBlob returned null', warnings }
    }
    return { blob, error: null, warnings }
  } finally {
    disposeScene(scene)
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildIsometricCamera(
  vertices: { u: number; v: number }[],
  ceilingH: number,
  aspect: number,
): THREE.OrthographicCamera {
  const elev = Math.atan(Math.SQRT1_2) // ≈ 35.264°
  const yaw = Math.PI / 4 // 45°

  const minU = Math.min(...vertices.map((p) => p.u))
  const maxU = Math.max(...vertices.map((p) => p.u))
  const minV = Math.min(...vertices.map((p) => p.v))
  const maxV = Math.max(...vertices.map((p) => p.v))
  const cu = (minU + maxU) / 2
  const cv = (minV + maxV) / 2

  const dist = 30
  const camPos = new THREE.Vector3(
    cu + Math.cos(elev) * Math.sin(yaw) * dist,
    Math.sin(elev) * dist,
    cv + Math.cos(elev) * Math.cos(yaw) * dist,
  )
  const target = new THREE.Vector3(cu, ceilingH / 2, cv)

  // Compute tight frustum by projecting the room+ceiling AABB into
  // camera space. `tempCam.lookAt()` gives us the inverse world matrix
  // without needing to replicate its rotation math.
  const tempCam = new THREE.PerspectiveCamera()
  tempCam.position.copy(camPos)
  tempCam.lookAt(target)
  tempCam.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(tempCam.matrixWorld).invert()

  const corners: THREE.Vector3[] = []
  for (const y of [0, ceilingH]) {
    corners.push(new THREE.Vector3(minU, y, minV))
    corners.push(new THREE.Vector3(maxU, y, minV))
    corners.push(new THREE.Vector3(minU, y, maxV))
    corners.push(new THREE.Vector3(maxU, y, maxV))
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const c of corners) {
    const p = c.clone().applyMatrix4(inv)
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  // 12% padding so walls/furniture don't kiss the frame.
  const PAD = 1.12
  const halfX = ((maxX - minX) / 2) * PAD
  const halfY = ((maxY - minY) / 2) * PAD

  // Fit both axes into the canvas aspect: whichever axis is "tighter"
  // wins; the looser one gets extra margin.
  let frustumHalfX: number
  let frustumHalfY: number
  if (halfX / halfY > aspect) {
    frustumHalfX = halfX
    frustumHalfY = halfX / aspect
  } else {
    frustumHalfY = halfY
    frustumHalfX = halfY * aspect
  }

  const cam = new THREE.OrthographicCamera(
    -frustumHalfX,
    frustumHalfX,
    frustumHalfY,
    -frustumHalfY,
    0.1,
    100,
  )
  cam.position.copy(camPos)
  cam.lookAt(target)
  cam.updateProjectionMatrix()
  return cam
}

function addPlaceholder(
  scene: THREE.Scene,
  pf: PlacedFurniture,
  variant: FurnitureVariant | undefined,
  item: FurnitureItem | undefined,
): void {
  const w = (variant?.width_cm ?? item?.width_cm ?? 50) / 100
  const d = (variant?.depth_cm ?? item?.depth_cm ?? 50) / 100
  const h = Math.max(0.05, (variant?.height_cm ?? item?.height_cm ?? 20) / 100)
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: 0x2ba8a0,
      transparent: true,
      opacity: 0.5,
      roughness: 0.8,
    }),
  )
  mesh.position.set(pf.x_cm / 100, h / 2 + pf.y_cm / 100, pf.z_cm / 100)
  mesh.rotation.y = (pf.rotation_deg * Math.PI) / 180
  mesh.scale.setScalar(pf.scale_factor ?? 1)
  scene.add(mesh)
}

function getFinishHex(
  materialId: string | null | undefined,
  type: 'wall' | 'floor' | 'lighting',
  finishMaterials: FinishMaterial[],
): string {
  const defaultHex = type === 'floor' ? '#C4A882' : '#FFFFFF'
  if (!materialId) return defaultHex
  const mat = finishMaterials.find((m) => m.id === materialId)
  if (!mat) return defaultHex
  if (mat.thumbnail_path.startsWith('#')) return mat.thumbnail_path
  return defaultHex
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.map?.dispose()
        m.normalMap?.dispose()
        m.roughnessMap?.dispose()
        m.metalnessMap?.dispose()
      }
      m?.dispose()
    }
  })
}
