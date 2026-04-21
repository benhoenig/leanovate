/**
 * Three.js room shell + lighting helpers.
 *
 * Shared between:
 *   - RoomCanvas.tsx (live editor canvas)
 *   - renderRoomPreview.ts (perspective preview)
 *
 * All coordinates are in metres (positions on the X/Z plane, Y is up).
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getVertices, polygonCentroid } from './roomGeometry'
import { rawStorageDownload } from './supabase'
import type { Room, FinishMaterial, RoomDoor, RoomWindow, FurnitureVariant, FurnitureItem, PlacedFurniture } from '@/types'

// ── Finish color resolution ──────────────────────────────────────────────────

/**
 * Resolves a finish material to its hex color.
 * Falls back to sensible defaults when the material is missing or its thumbnail
 * isn't a hex string (preset materials store hex in `thumbnail_path`).
 */
export function getFinishHex(
  materialId: string | null | undefined,
  type: string,
  finishMaterials: FinishMaterial[]
): string {
  if (!materialId) {
    return type === 'floor' ? '#C4A882' : '#FFFFFF'
  }
  const mat = finishMaterials.find((m) => m.id === materialId)
  if (!mat) return type === 'floor' ? '#C4A882' : '#FFFFFF'
  if (mat.thumbnail_path.startsWith('#')) return mat.thumbnail_path
  return type === 'floor' ? '#C4A882' : '#FFFFFF'
}

// ── Surface textures (walls + floors) ────────────────────────────────────────

export interface FinishAppearance {
  /** Fallback solid color — used while the texture loads, or when no texture. */
  color: string
  /** Tileable texture image URL. Undefined means flat color only. */
  textureUrl?: string
  /** Real-world size of one texture repeat, in cm. Defaults to 200cm. */
  tileSizeCm?: number
}

export function getFinishAppearance(
  materialId: string | null | undefined,
  type: 'wall' | 'floor',
  finishMaterials: FinishMaterial[]
): FinishAppearance {
  const defaultColor = type === 'floor' ? '#C4A882' : '#FFFFFF'
  if (!materialId) return { color: defaultColor }
  const mat = finishMaterials.find((m) => m.id === materialId)
  if (!mat) return { color: defaultColor }
  const color = mat.thumbnail_path.startsWith('#') ? mat.thumbnail_path : defaultColor
  return {
    color,
    textureUrl: mat.texture_url ?? undefined,
    tileSizeCm: mat.tile_size_cm ?? undefined,
  }
}

// Textures are shared across meshes — a room with 4 walls on the same finish
// shares one GPU texture. UV tiling is baked into the mesh UVs (see
// setWorldSpaceUVs) so the shared texture stays at repeat=(1,1) regardless
// of surface size.
const textureCache = new Map<string, THREE.Texture>()
const textureLoader = new THREE.TextureLoader()

export function getSharedTexture(url: string): THREE.Texture {
  const cached = textureCache.get(url)
  if (cached) return cached
  const tex = textureLoader.load(url)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  textureCache.set(url, tex)
  return tex
}

/**
 * Rewrites a geometry's UVs so `(u, v) = (local_x / tileSizeM, local_y / tileSizeM)`.
 * Bakes the physical repeat rate into the mesh so the shared texture stays
 * at repeat=(1,1) regardless of surface size. Works for both ShapeGeometry
 * and PlaneGeometry in their local XY plane.
 */
export function setWorldSpaceUVs(geo: THREE.BufferGeometry, tileSizeM: number): void {
  const pos = geo.attributes.position
  if (!pos) return
  const count = pos.count
  const arr = pos.array as ArrayLike<number>
  const uv = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    uv[i * 2] = arr[i * 3] / tileSizeM
    uv[i * 2 + 1] = arr[i * 3 + 1] / tileSizeM
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

export function applyFinishTexture(
  material: THREE.MeshStandardMaterial,
  appearance: FinishAppearance
): void {
  if (!appearance.textureUrl) return
  material.map = getSharedTexture(appearance.textureUrl)
  material.color.set(0xffffff)
  material.needsUpdate = true
}

const DEFAULT_TILE_SIZE_CM = 200

// ── Room shell ────────────────────────────────────────────────────────────────

/**
 * Adds the room shell (floor + ceiling + walls with door/window cutouts) to a
 * scene. Returns refs to the meshes for later disposal or interaction (e.g.
 * floor mesh is the raycast target for click-to-place in 8c).
 */
export interface RoomShellRefs {
  floorMesh: THREE.Mesh
  ceilingMesh: THREE.Mesh
  walls: THREE.Mesh[]
}

export interface RoomShellOptions {
  /**
   * `'full'` — walls + ceiling are solid double-sided (default, used by the
   *   perspective preview when the camera is inside the room).
   * `'dollhouse'` — ceiling hidden, walls render only their interior face so
   *   the user can orbit around the outside of the room and still see in.
   *   Used by the live editor canvas.
   */
  mode?: 'full' | 'dollhouse'
  /**
   * Optional lookup that returns a fixture variant by id. When provided AND
   * the variant has a completed `glb_path`, the shell loads the .glb and
   * renders it inside the cutout instead of the generic door panel / window
   * glass+frame fallback. Used by RoomCanvas so admins can curate styled
   * door/window catalog and designers pick from it per fixture.
   */
  resolveVariant?: (variantId: string) => FurnitureVariant | undefined
}

export function buildRoomShell(
  scene: THREE.Object3D,
  room: Room,
  finishMaterials: FinishMaterial[],
  options: RoomShellOptions = {}
): RoomShellRefs {
  const mode = options.mode ?? 'full'
  // Dollhouse mode: walls render only their outward face, so the walls
  // between camera and room interior are culled (invisible), leaving the
  // far walls as a backdrop so you can always see into the room.
  const wallSide = mode === 'dollhouse' ? THREE.FrontSide : THREE.DoubleSide
  const vertices = getVertices(room)
  const ceilingH = (room.ceiling_height_cm ?? 260) / 100

  const wallApp = getFinishAppearance(room.finishes?.wall?.material_id, 'wall', finishMaterials)
  const floorApp = getFinishAppearance(room.finishes?.floor?.material_id, 'floor', finishMaterials)
  // Doors/windows are placed fixtures (not finishes). Hardcoded fallback
  // colors for the "no variant picked / not yet loaded" path.
  const doorFallbackColor = 0xC4B8A8
  const windowFallbackColor = 0xDDEEFF

  // ── Floor + ceiling ───────────────────────────────────────────────────────
  const floorShape = new THREE.Shape()
  floorShape.moveTo(vertices[0].u, vertices[0].v)
  for (let i = 1; i < vertices.length; i++) {
    floorShape.lineTo(vertices[i].u, vertices[i].v)
  }
  floorShape.closePath()

  const floorGeo = new THREE.ShapeGeometry(floorShape)
  if (floorApp.textureUrl) {
    setWorldSpaceUVs(floorGeo, (floorApp.tileSizeCm ?? DEFAULT_TILE_SIZE_CM) / 100)
  }
  const floorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(floorApp.color),
    roughness: 0.7,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
  applyFinishTexture(floorMat, floorApp)
  const floorMesh = new THREE.Mesh(floorGeo, floorMat)
  floorMesh.rotation.x = Math.PI / 2
  floorMesh.receiveShadow = true
  // Tag for raycast targeting in interaction layer (Phase 8c)
  floorMesh.userData.kind = 'floor'
  scene.add(floorMesh)

  const ceilingGeo = new THREE.ShapeGeometry(floorShape)
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0xFAFAFA,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat)
  ceilingMesh.rotation.x = Math.PI / 2
  ceilingMesh.position.y = ceilingH
  ceilingMesh.receiveShadow = true
  ceilingMesh.visible = mode !== 'dollhouse'
  scene.add(ceilingMesh)

  // ── Walls ─────────────────────────────────────────────────────────────────
  // Walls share one material; each wall's geometry carries its own
  // world-space UVs so the texture tiles at the correct physical scale per
  // wall length.
  const wallTileM = (wallApp.tileSizeCm ?? DEFAULT_TILE_SIZE_CM) / 100
  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(wallApp.color),
    roughness: 0.6,
    metalness: 0,
    side: wallSide,
  })
  applyFinishTexture(wallMat, wallApp)
  const doorMat = new THREE.MeshStandardMaterial({
    color: doorFallbackColor,
    roughness: 0.4,
    metalness: 0.05,
    side: wallSide,
  })
  const windowGlassMat = new THREE.MeshStandardMaterial({
    color: windowFallbackColor,
    roughness: 0.1,
    metalness: 0.2,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  })
  const windowFrameMat = new THREE.MeshStandardMaterial({
    color: 0xDDDDDD,
    roughness: 0.4,
    metalness: 0.3,
    side: THREE.DoubleSide,
  })

  const allDoors: RoomDoor[] = room.geometry?.doors ?? []
  const allWindows: RoomWindow[] = room.geometry?.windows ?? []
  const walls: THREE.Mesh[] = []

  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    const wallLen = Math.sqrt((b.u - a.u) ** 2 + (b.v - a.v) ** 2)
    if (wallLen < 0.01) continue

    const angle = Math.atan2(b.v - a.v, b.u - a.u)
    const wallDoors = allDoors.filter((d) => d.wall_index === i)
    const wallWindows = allWindows.filter((w) => w.wall_index === i)

    if (wallDoors.length === 0 && wallWindows.length === 0) {
      const wallGeo = new THREE.PlaneGeometry(wallLen, ceilingH)
      if (wallApp.textureUrl) setWorldSpaceUVs(wallGeo, wallTileM)
      const wall = new THREE.Mesh(wallGeo, wallMat)
      wall.position.set((a.u + b.u) / 2, ceilingH / 2, (a.v + b.v) / 2)
      wall.rotation.y = -angle
      wall.receiveShadow = true
      wall.castShadow = true
      wall.userData.kind = 'wall'
      wall.userData.wallIndex = i
      scene.add(wall)
      walls.push(wall)
      continue
    }

    // Wall with cutouts
    const wallShape = new THREE.Shape()
    wallShape.moveTo(0, 0)
    wallShape.lineTo(wallLen, 0)
    wallShape.lineTo(wallLen, ceilingH)
    wallShape.lineTo(0, ceilingH)
    wallShape.closePath()

    for (const door of wallDoors) {
      const doorCenterX = door.position * wallLen
      const doorW = door.width_m ?? 0.8
      const doorH = door.height_m ?? ceilingH * 0.82
      const x0 = Math.max(0, doorCenterX - doorW / 2)
      const x1 = Math.min(wallLen, doorCenterX + doorW / 2)

      const hole = new THREE.Path()
      hole.moveTo(x0, 0)
      hole.lineTo(x1, 0)
      hole.lineTo(x1, doorH)
      hole.lineTo(x0, doorH)
      hole.closePath()
      wallShape.holes.push(hole)

      const doorLocalX = (x0 + x1) / 2 - wallLen / 2
      const doorLocalY = doorH / 2
      const cosA = Math.cos(-angle)
      const sinA = Math.sin(-angle)
      const midU = (a.u + b.u) / 2
      const midV = (a.v + b.v) / 2
      const doorX = midU + doorLocalX * cosA
      const doorZ = midV - doorLocalX * sinA

      const variant = door.variant_id && options.resolveVariant
        ? options.resolveVariant(door.variant_id)
        : undefined

      if (variant?.glb_path && variant.render_status === 'completed') {
        // Render the variant .glb inside the cutout
        const slot = new THREE.Group()
        slot.name = `door-slot:${door.id}`
        slot.position.set(doorX, 0, doorZ)
        slot.rotation.y = -angle
        slot.userData.fixtureId = door.id
        slot.userData.fixtureType = 'door'
        scene.add(slot)
        void loadGlb(variant.glb_path).then((source) => {
          fillWithGlb(slot, source, x1 - x0, 0.06, doorH, 1)
        }).catch((err) => {
          console.warn(`[roomScene] door .glb failed for ${door.id}:`, err)
          const fallbackGeo = new THREE.PlaneGeometry(x1 - x0, doorH)
          const fallback = new THREE.Mesh(fallbackGeo, doorMat)
          fallback.position.y = doorLocalY
          fallback.castShadow = true
          slot.add(fallback)
        })
      } else {
        // Fallback: generic panel. Log why so we can tell apart the
        // "no variant picked" vs "variant not loaded" vs "variant has no
        // .glb" cases without guessing.
        const reason = !door.variant_id
          ? 'no variant_id on door record'
          : !variant
            ? `variant ${door.variant_id} not loaded in catalog store`
            : !variant.glb_path
              ? `variant ${door.variant_id} has no glb_path (render_status=${variant.render_status})`
              : `variant ${door.variant_id} render_status=${variant.render_status} (not completed)`
        console.info(`[roomScene] door ${door.id} rendering fallback: ${reason}`)

        // Slot sits in the cutout; populated below — synchronously with a
        // solid panel, or asynchronously with the uploaded photo as a texture
        // once it finishes loading.
        const slot = new THREE.Group()
        slot.name = `door-fallback-slot:${door.id}`
        slot.position.set(doorX, doorLocalY, doorZ)
        slot.rotation.y = -angle
        slot.userData.fixtureId = door.id
        slot.userData.fixtureType = 'door'
        scene.add(slot)

        const panelGeo = new THREE.PlaneGeometry(x1 - x0, doorH)
        const placeholderUrl = variant?.original_image_urls?.[0]

        if (placeholderUrl) {
          // Render a neutral grey panel immediately so the cutout isn't
          // empty, then swap in the textured version once the image loads.
          const initialMat = new THREE.MeshStandardMaterial({
            color: 0xC4B8A8,
            side: THREE.DoubleSide,
            roughness: 0.8,
          })
          const initialPanel = new THREE.Mesh(panelGeo, initialMat)
          initialPanel.castShadow = true
          slot.add(initialPanel)

          new THREE.TextureLoader().load(
            placeholderUrl,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace
              const texturedMat = new THREE.MeshStandardMaterial({
                map: tex,
                side: THREE.DoubleSide,
                roughness: 0.8,
              })
              initialPanel.material = texturedMat
              initialMat.dispose()
            },
            undefined,
            (err) => {
              console.warn(`[roomScene] door placeholder texture failed for ${door.id}:`, err)
            },
          )
        } else {
          const doorPanel = new THREE.Mesh(panelGeo, doorMat)
          doorPanel.castShadow = true
          slot.add(doorPanel)
        }
      }
    }

    for (const win of wallWindows) {
      const winCenterX = win.position * wallLen
      const winW = win.width_m ?? 1.0
      const winSill = win.sill_m ?? ceilingH * 0.30
      const winH = win.height_m ?? ceilingH * 0.48
      const x0 = Math.max(0, winCenterX - winW / 2)
      const x1 = Math.min(wallLen, winCenterX + winW / 2)

      const hole = new THREE.Path()
      hole.moveTo(x0, winSill)
      hole.lineTo(x1, winSill)
      hole.lineTo(x1, winSill + winH)
      hole.lineTo(x0, winSill + winH)
      hole.closePath()
      wallShape.holes.push(hole)

      const cosA = Math.cos(-angle)
      const sinA = Math.sin(-angle)
      const midU = (a.u + b.u) / 2
      const midV = (a.v + b.v) / 2
      const glassLocalX = (x0 + x1) / 2 - wallLen / 2
      const glassLocalY = winSill + winH / 2
      const winX = midU + glassLocalX * cosA
      const winZ = midV - glassLocalX * sinA

      const winVariant = win.variant_id && options.resolveVariant
        ? options.resolveVariant(win.variant_id)
        : undefined

      if (winVariant?.glb_path && winVariant.render_status === 'completed') {
        // Render the variant .glb inside the cutout at sill+height/2
        const slot = new THREE.Group()
        slot.name = `window-slot:${win.id}`
        slot.position.set(winX, glassLocalY, winZ)
        slot.rotation.y = -angle
        slot.userData.fixtureId = win.id
        slot.userData.fixtureType = 'window'
        scene.add(slot)
        void loadGlb(winVariant.glb_path).then((source) => {
          // fillWithGlb centers its content at y=size/2; windows want centered on
          // the slot origin (glassLocalY). Use a sub-group so fill is centered.
          const centered = new THREE.Group()
          slot.add(centered)
          fillWithGlb(centered, source, x1 - x0, 0.06, winH, 1)
          centered.position.y = -winH / 2
        }).catch((err) => {
          console.warn(`[roomScene] window .glb failed for ${win.id}:`, err)
          renderFallbackWindow()
        })
      } else {
        renderFallbackWindow()
      }

      function renderFallbackWindow() {
        const slot = new THREE.Group()
        slot.name = `window-fallback-slot:${win.id}`
        slot.userData.fixtureId = win.id
        slot.userData.fixtureType = 'window'

        const glassGeo = new THREE.PlaneGeometry(x1 - x0, winH)
        const glass = new THREE.Mesh(glassGeo, windowGlassMat)
        glass.position.set(winX, glassLocalY, winZ)
        glass.rotation.y = -angle
        slot.add(glass)

        const frameThickness = 0.04
        const frameGeo = new THREE.PlaneGeometry(x1 - x0 + frameThickness * 2, winH + frameThickness * 2)
        const frame = new THREE.Mesh(frameGeo, windowFrameMat)
        frame.position.copy(glass.position)
        frame.position.y = glassLocalY
        frame.rotation.y = -angle

        // Nudge frame slightly outward so it doesn't z-fight the glass
        const segLen = Math.sqrt((b.u - a.u) ** 2 + (b.v - a.v) ** 2)
        const nu = -(b.v - a.v) / segLen
        const nv = (b.u - a.u) / segLen
        frame.position.x -= nu * 0.005
        frame.position.z -= nv * 0.005
        slot.add(frame)
        scene.add(slot)
      }
    }

    const wallGeo = new THREE.ShapeGeometry(wallShape)
    if (wallApp.textureUrl) setWorldSpaceUVs(wallGeo, wallTileM)
    const wall = new THREE.Mesh(wallGeo, wallMat)
    wall.position.set(a.u, 0, a.v)
    wall.rotation.y = -angle
    wall.receiveShadow = true
    wall.castShadow = true
    wall.userData.kind = 'wall'
    wall.userData.wallIndex = i
    scene.add(wall)
    walls.push(wall)
  }

  return { floorMesh, ceilingMesh, walls }
}

// ── Lighting ─────────────────────────────────────────────────────────────────

export interface LightingRefs {
  ambient: THREE.AmbientLight
  sun: THREE.DirectionalLight
  fill: THREE.DirectionalLight
  point: THREE.PointLight
}

/**
 * Adds a standard 4-light setup tuned for the room's centroid + ceiling height.
 * Same lighting profile as renderRoomPreview's "fast" mode for visual parity
 * between the live canvas and the saved preview.
 */
export function addStandardLighting(scene: THREE.Object3D, room: Room): LightingRefs {
  const vertices = getVertices(room)
  const centroid = polygonCentroid(vertices)
  const ceilingH = (room.ceiling_height_cm ?? 260) / 100

  const ambient = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(0xfff5e0, 1.0)
  sun.position.set(centroid.u + 3, ceilingH + 2, centroid.v + 3)
  sun.castShadow = true
  scene.add(sun)

  const fill = new THREE.DirectionalLight(0xe0f0ff, 0.3)
  fill.position.set(centroid.u - 2, ceilingH, centroid.v - 2)
  scene.add(fill)

  const point = new THREE.PointLight(0xffeedd, 0.4, 20)
  point.position.set(centroid.u, ceilingH - 0.1, centroid.v)
  scene.add(point)

  return { ambient, sun, fill, point }
}

// ── Furniture (.glb) loading + caching ───────────────────────────────────────

const glbCache = new Map<string, Promise<THREE.Group>>()
const gltfLoader = new GLTFLoader()

/** Loads a .glb from Supabase Storage, returning a clonable source Group. */
export function loadGlb(glbPath: string): Promise<THREE.Group> {
  const cached = glbCache.get(glbPath)
  if (cached) return cached

  const promise = (async () => {
    const { blob, error } = await rawStorageDownload('glb-models', glbPath)
    if (error || !blob) throw new Error(`Failed to download .glb: ${error ?? 'no blob'}`)
    const buffer = await blob.arrayBuffer()
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      gltfLoader.parse(buffer, '', (r) => resolve(r), (err) => reject(err))
    })
    // Brighten dark TRELLIS materials (same fix as renderSprites/ModelApprovalModal)
    gltf.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material
        const arr = Array.isArray(mat) ? mat : [mat]
        for (const m of arr) {
          if (m instanceof THREE.MeshStandardMaterial) {
            m.metalness = Math.min(m.metalness, 0.3)
            m.roughness = Math.max(m.roughness, 0.4)
            m.needsUpdate = true
          }
        }
      }
    })
    return gltf.scene
  })()

  glbCache.set(glbPath, promise)
  return promise
}

// ── Furniture mesh factory ───────────────────────────────────────────────────

/** Fills a placeholder group with a semi-transparent box sized to dims. */
function fillPlaceholder(group: THREE.Group, widthM: number, depthM: number, heightM: number) {
  const geo = new THREE.BoxGeometry(widthM, heightM, depthM)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2BA8A0,
    transparent: true,
    opacity: 0.35,
    roughness: 0.6,
  })
  const box = new THREE.Mesh(geo, mat)
  box.position.y = heightM / 2
  box.castShadow = true
  group.add(box)
}

/** Fills a group with a flat textured plane on the floor — for is_flat items. */
async function fillFlatPlane(
  group: THREE.Group,
  widthM: number,
  depthM: number,
  imageUrl: string
): Promise<void> {
  const texture = await new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(imageUrl, resolve, undefined, reject)
  })
  texture.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.PlaneGeometry(widthM, depthM)
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    roughness: 0.9,
  })
  const plane = new THREE.Mesh(geo, mat)
  plane.rotation.x = -Math.PI / 2
  plane.position.y = 0.002 // slightly above floor to avoid z-fighting
  plane.receiveShadow = true
  group.add(plane)
}

/** Fills a group with a clone of a preloaded .glb, scaled to target dims. */
function fillWithGlb(
  group: THREE.Group,
  source: THREE.Group,
  widthM: number,
  depthM: number,
  heightM: number,
  scaleFactor: number,
) {
  const cloned = source.clone(true)

  // IMPORTANT: Object3D.clone() shares materials by default. We need each
  // furniture instance to own its materials so per-instance mutations (e.g.
  // the ghost preview toggling transparent/opacity) don't leak into other
  // placements of the same .glb.
  cloned.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material
    if (Array.isArray(mat)) {
      mesh.material = mat.map((m) => m.clone())
    } else if (mat) {
      mesh.material = mat.clone()
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
  })

  const box = new THREE.Box3().setFromObject(cloned)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxModelDim = Math.max(size.x, size.y, size.z)
  const maxTargetDim = Math.max(widthM, depthM, heightM)
  const scale = (maxTargetDim / maxModelDim) * scaleFactor

  cloned.scale.setScalar(scale)
  cloned.position.sub(center.multiplyScalar(scale))
  cloned.position.y += (size.y * scale) / 2

  group.add(cloned)
}

export interface FurnitureMeshParams {
  placed: PlacedFurniture
  variant: FurnitureVariant
  item: FurnitureItem
  isFlat: boolean
}

/**
 * Builds a furniture group and positions it in room coordinates.
 * Position / rotation from the placed record, dimensions from the variant
 * (with item fallback). Returns the group immediately — .glb/texture loading
 * happens asynchronously and fills the group via `onReady`.
 */
export function createFurnitureGroup(params: FurnitureMeshParams): {
  group: THREE.Group
  loader: () => Promise<void>
} {
  const { placed, variant, item, isFlat } = params

  const widthM = (variant.width_cm ?? item.width_cm ?? 50) / 100
  const depthM = (variant.depth_cm ?? item.depth_cm ?? 50) / 100
  const heightM = (variant.height_cm ?? item.height_cm ?? 50) / 100
  const scaleFactor = placed.scale_factor ?? 1

  const group = new THREE.Group()
  group.name = `placed:${placed.id}`
  group.userData.placedId = placed.id
  group.userData.kind = 'furniture'

  // Position: room-local cm → metres. y=0 is the floor.
  group.position.set(placed.x_cm / 100, placed.y_cm / 100, placed.z_cm / 100)
  group.rotation.y = (placed.rotation_deg * Math.PI) / 180

  const loader = async () => {
    try {
      if (isFlat) {
        // Flat items use the first uploaded image as a floor plane texture.
        const url = variant.original_image_urls[0]
        if (!url) {
          fillPlaceholder(group, widthM * scaleFactor, depthM * scaleFactor, 0.02)
          return
        }
        await fillFlatPlane(group, widthM * scaleFactor, depthM * scaleFactor, url)
      } else if (variant.glb_path) {
        const source = await loadGlb(variant.glb_path)
        fillWithGlb(group, source, widthM, depthM, heightM, scaleFactor)
      } else {
        fillPlaceholder(group, widthM * scaleFactor, depthM * scaleFactor, heightM * scaleFactor)
      }
    } catch (err) {
      console.warn(`[createFurnitureGroup] load failed for ${placed.id}:`, err)
      fillPlaceholder(group, widthM * scaleFactor, depthM * scaleFactor, heightM * scaleFactor)
    }
  }

  return { group, loader }
}

// ── Disposal ─────────────────────────────────────────────────────────────────

/**
 * Recursively disposes geometries + materials in a scene. Call before unmount.
 * Lights, cameras, and the renderer are disposed separately by the caller.
 */
export function disposeSceneObjects(scene: THREE.Scene) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const m = mesh.material
      if (Array.isArray(m)) {
        for (const sub of m) sub.dispose()
      } else if (m) {
        m.dispose()
      }
    }
  })
}
