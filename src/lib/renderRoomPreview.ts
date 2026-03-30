/**
 * Client-side room perspective preview renderer using Three.js.
 *
 * Renders an eye-level interior vignette (perspective camera at ~160cm height)
 * showing the room shell (walls, floor, ceiling) with applied finishes and all
 * placed furniture (.glb models) at their canvas positions.
 *
 * Follows the same offscreen-canvas pattern as renderSprites.ts.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { supabase } from './supabase'
import { getVertices, polygonCentroid } from './roomGeometry'
import type { Room, FinishMaterial, PlacedFurniture, FurnitureVariant, FurnitureItem, Direction } from '@/types'

const PREVIEW_WIDTH = 1920
const PREVIEW_HEIGHT = 1080

interface RenderParams {
  room: Room
  finishMaterials: FinishMaterial[]
  placedFurniture: PlacedFurniture[]
  /** Keyed by furniture_item_id */
  variants: Record<string, FurnitureVariant[]>
  /** Keyed by furniture_item_id */
  items: Record<string, FurnitureItem>
}

interface RenderResult {
  blob: Blob | null
  error: string | null
  warnings: string[]
}

/** Direction → Y-axis rotation angle (radians) */
const DIRECTION_ANGLES: Record<Direction, number> = {
  front_left: Math.PI * 1.25,   // 225°
  front_right: Math.PI * 1.75,  // 315°
  back_right: Math.PI * 0.25,   // 45°
  back_left: Math.PI * 0.75,    // 135°
}

/**
 * Render a room perspective preview.
 */
export async function renderRoomPreview(params: RenderParams): Promise<RenderResult> {
  const { room, finishMaterials, placedFurniture, variants, items } = params
  const warnings: string[] = []

  try {
    // Set up offscreen canvas
    const canvas = document.createElement('canvas')
    canvas.width = PREVIEW_WIDTH
    canvas.height = PREVIEW_HEIGHT

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    })
    renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT)
    renderer.setPixelRatio(1)
    renderer.setClearColor(0xF5F3EF, 1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xF5F3EF)

    // ── Room geometry ────────────────────────────────────────────────────────
    const vertices = getVertices(room)
    const ceilingH = (room.ceiling_height_cm ?? 260) / 100 // metres
    const centroid = polygonCentroid(vertices)

    // Get finish colors
    const wallColor = getFinishHex(room.finishes?.wall?.material_id, 'wall', finishMaterials)
    const floorColor = getFinishHex(room.finishes?.floor?.material_id, 'floor', finishMaterials)

    // ── Floor ────────────────────────────────────────────────────────────────
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
    // +π/2 maps shape (u,v) → world (u, 0, v) keeping V→+Z consistent
    floorMesh.rotation.x = Math.PI / 2
    floorMesh.receiveShadow = true
    scene.add(floorMesh)

    // ── Ceiling ──────────────────────────────────────────────────────────────
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
    scene.add(ceilingMesh)

    // ── Walls ────────────────────────────────────────────────────────────────
    const wallMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(wallColor),
      roughness: 0.6,
      metalness: 0,
      side: THREE.DoubleSide,
    })

    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i]
      const b = vertices[(i + 1) % vertices.length]

      const wallLen = Math.sqrt((b.u - a.u) ** 2 + (b.v - a.v) ** 2)
      if (wallLen < 0.01) continue

      const wallGeo = new THREE.PlaneGeometry(wallLen, ceilingH)
      const wall = new THREE.Mesh(wallGeo, wallMat)

      // Position at midpoint, half ceiling height
      const midU = (a.u + b.u) / 2
      const midV = (a.v + b.v) / 2
      wall.position.set(midU, ceilingH / 2, midV)

      // Rotate to align plane width with wall direction
      const angle = Math.atan2(b.v - a.v, b.u - a.u)
      wall.rotation.y = -angle

      wall.receiveShadow = true
      scene.add(wall)
    }

    // ── Lighting ─────────────────────────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambientLight)

    const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.0)
    sunLight.position.set(
      centroid.u + 3,
      ceilingH + 2,
      centroid.v + 3
    )
    sunLight.castShadow = true
    scene.add(sunLight)

    const fillLight = new THREE.DirectionalLight(0xe0f0ff, 0.3)
    fillLight.position.set(centroid.u - 2, ceilingH, centroid.v - 2)
    scene.add(fillLight)

    // Warm accent light from above (simulating ceiling fixture)
    const pointLight = new THREE.PointLight(0xffeedd, 0.4, 20)
    pointLight.position.set(centroid.u, ceilingH - 0.1, centroid.v)
    scene.add(pointLight)

    // ── Load and place furniture .glb models ─────────────────────────────────
    const loader = new GLTFLoader()

    for (const pf of placedFurniture) {
      const itemVariants = variants[pf.furniture_item_id] ?? []
      const variant = itemVariants.find((v) => v.id === pf.selected_variant_id)

      if (!variant?.glb_path) {
        const item = items[pf.furniture_item_id]
        warnings.push(`${item?.name ?? 'Item'} (${variant?.color_name ?? 'unknown'}) — no 3D model`)
        continue
      }

      try {
        const { data: glbBlob, error: dlErr } = await supabase.storage
          .from('glb-models')
          .download(variant.glb_path)

        if (dlErr || !glbBlob) {
          warnings.push(`Failed to load model for ${items[pf.furniture_item_id]?.name ?? 'item'}`)
          continue
        }

        const glbBuffer = await glbBlob.arrayBuffer()

        const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
          loader.parse(glbBuffer, '', (result) => resolve(result), (err) => reject(err))
        })

        const model = gltf.scene

        // Normalize model to fit within its declared dimensions
        const item = items[pf.furniture_item_id]
        const box = new THREE.Box3().setFromObject(model)
        const modelSize = box.getSize(new THREE.Vector3())
        const modelCenter = box.getCenter(new THREE.Vector3())

        // Use item dimensions or fallback to 50cm
        const targetW = (variant.width_cm ?? item?.width_cm ?? 50) / 100
        const targetD = (variant.depth_cm ?? item?.depth_cm ?? 50) / 100
        const targetH = (variant.height_cm ?? item?.height_cm ?? 50) / 100

        const maxModelDim = Math.max(modelSize.x, modelSize.y, modelSize.z)
        const maxTargetDim = Math.max(targetW, targetD, targetH)
        const scale = maxTargetDim / maxModelDim

        model.scale.setScalar(scale)

        // Center model at origin first
        model.position.sub(modelCenter.multiplyScalar(scale))

        // Position in room: (u → x, 0 → y floor, v → z)
        model.position.x += pf.x
        model.position.y += (modelSize.y * scale) / 2 // sit on floor
        model.position.z += pf.y

        // Rotate based on direction
        model.rotation.y = DIRECTION_ANGLES[pf.direction] ?? 0

        model.castShadow = true
        scene.add(model)
      } catch (err) {
        warnings.push(`Error loading model: ${String(err)}`)
      }
    }

    // ── Camera ───────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(
      75, // Wide FOV for small room interiors
      PREVIEW_WIDTH / PREVIEW_HEIGHT,
      0.1,
      100
    )

    const EYE_HEIGHT = 1.6 // 160cm standing height
    const WALL_OFFSET = 0.35 // Stand close to wall (like real interior photos)

    // Position camera: try to find a door position, otherwise use a corner
    const doors = room.geometry?.doors ?? []
    let camPos: { u: number; v: number }

    // Compute inward offset from a wall point
    const offsetInward = (wu: number, wv: number, wallDu: number, wallDv: number, dist: number) => {
      // Inward normal for CCW winding: (-dv, du) normalized
      const normalU = -wallDv
      const normalV = wallDu
      const normalLen = Math.sqrt(normalU ** 2 + normalV ** 2)
      if (normalLen < 0.001) return { u: wu, v: wv }
      return {
        u: wu + (normalU / normalLen) * dist,
        v: wv + (normalV / normalLen) * dist,
      }
    }

    if (doors.length > 0) {
      // Stand at the first door, just inside the room
      const door = doors[0]
      const wallIdx = door.wall_index ?? 0
      const wa = vertices[wallIdx % vertices.length]
      const wb = vertices[(wallIdx + 1) % vertices.length]
      const doorU = wa.u + (wb.u - wa.u) * door.position
      const doorV = wa.v + (wb.v - wa.v) * door.position

      camPos = offsetInward(doorU, doorV, wb.u - wa.u, wb.v - wa.v, WALL_OFFSET)
    } else {
      // Fallback: stand at first vertex corner, offset inward along both adjacent walls
      const wa = vertices[0]
      const wb = vertices[1]
      const wc = vertices[vertices.length - 1]

      // Offset along wall 0→1
      const off1 = offsetInward(wa.u, wa.v, wb.u - wa.u, wb.v - wa.v, WALL_OFFSET)
      // Also offset along wall (last)→0
      const off2 = offsetInward(wa.u, wa.v, wa.u - wc.u, wa.v - wc.v, WALL_OFFSET)

      camPos = {
        u: wa.u + (off1.u - wa.u) + (off2.u - wa.u),
        v: wa.v + (off1.v - wa.v) + (off2.v - wa.v),
      }
    }

    camera.position.set(camPos.u, EYE_HEIGHT, camPos.v)
    // Look at centroid at nearly eye-level (slight downward gaze to see furniture)
    camera.lookAt(centroid.u, EYE_HEIGHT * 0.85, centroid.v)

    // ── Render ───────────────────────────────────────────────────────────────
    renderer.render(scene, camera)

    // Export as PNG blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
        'image/png'
      )
    })

    // Clean up
    renderer.dispose()
    renderer.forceContextLoss()

    return { blob, error: null, warnings }
  } catch (err) {
    return { blob: null, error: String(err), warnings }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFinishHex(
  materialId: string | null | undefined,
  type: string,
  finishMaterials: FinishMaterial[]
): string {
  if (!materialId) {
    // Defaults per type
    return type === 'floor' ? '#C4A882' : '#FFFFFF'
  }
  const mat = finishMaterials.find((m) => m.id === materialId)
  if (!mat) return type === 'floor' ? '#C4A882' : '#FFFFFF'

  // thumbnail_path is either a hex color (#RRGGBB) or a storage URL
  if (mat.thumbnail_path.startsWith('#')) return mat.thumbnail_path
  return type === 'floor' ? '#C4A882' : '#FFFFFF'
}
