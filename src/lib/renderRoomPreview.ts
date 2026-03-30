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
import type { Room, FinishMaterial, PlacedFurniture, FurnitureVariant, FurnitureItem, Direction, RoomDoor, RoomWindow } from '@/types'

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
  /** Which wall to position the camera at (index into vertices). Defaults to 0. */
  cameraWallIdx?: number
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

    // ── Walls (with door/window cutouts) ──────────────────────────────────────
    const wallMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(wallColor),
      roughness: 0.6,
      metalness: 0,
      side: THREE.DoubleSide,
    })

    // Get finish colors for doors and windows
    const doorColor = getFinishHex(room.finishes?.door?.material_id, 'door', finishMaterials)
    const windowColor = getFinishHex(room.finishes?.window?.material_id, 'window', finishMaterials)

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

    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i]
      const b = vertices[(i + 1) % vertices.length]

      const wallLen = Math.sqrt((b.u - a.u) ** 2 + (b.v - a.v) ** 2)
      if (wallLen < 0.01) continue

      const angle = Math.atan2(b.v - a.v, b.u - a.u)

      // Collect doors and windows on this wall
      const wallDoors = allDoors.filter((d) => d.wall_index === i)
      const wallWindows = allWindows.filter((w) => w.wall_index === i)

      if (wallDoors.length === 0 && wallWindows.length === 0) {
        // Simple solid wall — no cutouts needed
        const wallGeo = new THREE.PlaneGeometry(wallLen, ceilingH)
        const wall = new THREE.Mesh(wallGeo, wallMat)
        wall.position.set((a.u + b.u) / 2, ceilingH / 2, (a.v + b.v) / 2)
        wall.rotation.y = -angle
        wall.receiveShadow = true
        scene.add(wall)
      } else {
        // Wall with cutouts — use Shape with holes
        // Shape is in wall-local 2D: x = along wall (0 to wallLen), y = height (0 to ceilingH)
        const wallShape = new THREE.Shape()
        wallShape.moveTo(0, 0)
        wallShape.lineTo(wallLen, 0)
        wallShape.lineTo(wallLen, ceilingH)
        wallShape.lineTo(0, ceilingH)
        wallShape.closePath()

        // Cut door holes
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

          // Add a door panel (slightly recessed) — thin box behind the opening
          const doorPanelGeo = new THREE.PlaneGeometry(x1 - x0, doorH)
          const doorPanel = new THREE.Mesh(doorPanelGeo, doorMat)
          // Position along wall in local coords, then transform to world
          const doorLocalX = (x0 + x1) / 2 - wallLen / 2
          const doorLocalY = doorH / 2
          // Transform to world: rotate by wall angle, translate to wall midpoint
          const cosA = Math.cos(-angle)
          const sinA = Math.sin(-angle)
          const midU = (a.u + b.u) / 2
          const midV = (a.v + b.v) / 2
          doorPanel.position.set(
            midU + doorLocalX * cosA,
            doorLocalY,
            midV - doorLocalX * sinA
          )
          doorPanel.rotation.y = -angle
          scene.add(doorPanel)
        }

        // Cut window holes
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

          // Add glass pane in the window opening
          const glassGeo = new THREE.PlaneGeometry(x1 - x0, winH)
          const glass = new THREE.Mesh(glassGeo, windowGlassMat)
          const glassLocalX = (x0 + x1) / 2 - wallLen / 2
          const glassLocalY = winSill + winH / 2
          const cosA = Math.cos(-angle)
          const sinA = Math.sin(-angle)
          const midU = (a.u + b.u) / 2
          const midV = (a.v + b.v) / 2
          glass.position.set(
            midU + glassLocalX * cosA,
            glassLocalY,
            midV - glassLocalX * sinA
          )
          glass.rotation.y = -angle
          scene.add(glass)

          // Window frame (thin border around the opening)
          const frameThickness = 0.04
          const frameGeo = new THREE.PlaneGeometry(x1 - x0 + frameThickness * 2, winH + frameThickness * 2)
          const frame = new THREE.Mesh(frameGeo, windowFrameMat)
          frame.position.copy(glass.position)
          frame.position.y = glassLocalY
          frame.rotation.y = -angle
          // Slight offset so frame is behind glass
          const { nu, nv } = (() => {
            const len = Math.sqrt((b.u - a.u) ** 2 + (b.v - a.v) ** 2)
            return { nu: -(b.v - a.v) / len, nv: (b.u - a.u) / len }
          })()
          frame.position.x -= nu * 0.005
          frame.position.z -= nv * 0.005
          scene.add(frame)
        }

        // Create the wall mesh with holes
        const wallGeo = new THREE.ShapeGeometry(wallShape)
        const wall = new THREE.Mesh(wallGeo, wallMat)
        // ShapeGeometry is in XY plane. We need to:
        // 1. Offset so center of wall is at origin (shape goes 0..wallLen, 0..ceilingH)
        // 2. Rotate to align with wall direction
        // 3. Translate to wall world position
        wall.position.set(a.u, 0, a.v)
        wall.rotation.y = -angle
        wall.receiveShadow = true
        scene.add(wall)
      }
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
    // Professional interior photography: camera at midpoint of one wall,
    // looking straight across to the opposite wall → symmetric one-point perspective.
    const camera = new THREE.PerspectiveCamera(
      70,
      PREVIEW_WIDTH / PREVIEW_HEIGHT,
      0.1,
      100
    )

    const EYE_HEIGHT = 1.6 // 160cm standing height
    const WALL_OFFSET = 0.4 // Distance from wall into room

    // Compute inward normal for a wall segment (CCW winding)
    const wallInwardNormal = (du: number, dv: number) => {
      const len = Math.sqrt(du * du + dv * dv)
      if (len < 0.001) return { nu: 0, nv: 0 }
      return { nu: -dv / len, nv: du / len }
    }

    // Camera wall: caller specifies which wall to stand at (default wall 0)
    const cameraWallIdx = (params.cameraWallIdx ?? 0) % vertices.length

    // Camera position: midpoint of camera wall, offset inward
    const camA = vertices[cameraWallIdx % vertices.length]
    const camB = vertices[(cameraWallIdx + 1) % vertices.length]
    const camMidU = (camA.u + camB.u) / 2
    const camMidV = (camA.v + camB.v) / 2
    const camWallDu = camB.u - camA.u
    const camWallDv = camB.v - camA.v
    const { nu: camNu, nv: camNv } = wallInwardNormal(camWallDu, camWallDv)

    const camPosU = camMidU + camNu * WALL_OFFSET
    const camPosV = camMidV + camNv * WALL_OFFSET

    // Look target: project straight across the room along the inward normal.
    // Use a large distance so we look perpendicular to the camera wall.
    const lookDist = 10
    const lookU = camPosU + camNu * lookDist
    const lookV = camPosV + camNv * lookDist

    camera.position.set(camPosU, EYE_HEIGHT, camPosV)
    camera.lookAt(lookU, EYE_HEIGHT * 0.92, lookV)

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
