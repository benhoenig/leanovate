/**
 * Client-side room perspective preview renderer using Three.js.
 *
 * Two render modes:
 *   - "fast" — Enhanced rasterization with shadows, SSAO, bloom, env map (~2s)
 *   - "hd"   — GPU path tracing via three-gpu-pathtracer (~10-20s progressive)
 *
 * Follows the same offscreen-canvas pattern as renderSprites.ts.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { rawStorageDownload } from './supabase'
import { getVertices, polygonCentroid, signedArea } from './roomGeometry'
import type { Room, FinishMaterial, PlacedFurniture, FurnitureVariant, FurnitureItem, RoomDoor, RoomWindow } from '@/types'

const PREVIEW_WIDTH = 1920
const PREVIEW_HEIGHT = 1080

export type RenderMode = 'fast' | 'hd'

export interface RenderParams {
  room: Room
  finishMaterials: FinishMaterial[]
  placedFurniture: PlacedFurniture[]
  /** Keyed by furniture_item_id */
  variants: Record<string, FurnitureVariant[]>
  /** Keyed by furniture_item_id */
  items: Record<string, FurnitureItem>
  /** Which wall to position the camera at (index into vertices). Defaults to 0. */
  cameraWallIdx?: number
  /** Render mode. Defaults to 'fast'. */
  mode?: RenderMode
  /** Progress callback for HD mode (called every few samples). */
  onProgress?: (samples: number, total: number, imageUrl: string) => void
  /** Abort signal for cancellation. */
  abortSignal?: AbortSignal
}

export interface RenderResult {
  blob: Blob | null
  error: string | null
  warnings: string[]
}

// ── Shared types ──────────────────────────────────────────────────────────────

interface SceneBuildResult {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  canvas: HTMLCanvasElement
  warnings: string[]
  sunLight: THREE.DirectionalLight
  pointLight: THREE.PointLight
  vertices: { u: number; v: number }[]
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Render a room perspective preview. Dispatches to fast or HD renderer.
 */
export async function renderRoomPreview(params: RenderParams): Promise<RenderResult> {
  const mode = params.mode ?? 'fast'
  try {
    if (mode === 'hd') {
      return await renderHDPreview(params)
    }
    return await renderFastPreview(params)
  } catch (err) {
    return { blob: null, error: String(err), warnings: [] }
  }
}

// ── Shared scene builder ──────────────────────────────────────────────────────

async function buildRoomScene(params: RenderParams): Promise<SceneBuildResult> {
  const { room, finishMaterials, placedFurniture, variants, items } = params
  const warnings: string[] = []

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
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xF5F3EF)

  // ── Room geometry ──────────────────────────────────────────────────────────
  const vertices = getVertices(room)
  const ceilingH = (room.ceiling_height_cm ?? 260) / 100 // metres
  const centroid = polygonCentroid(vertices)

  // Get finish colors
  const wallColor = getFinishHex(room.finishes?.wall?.material_id, 'wall', finishMaterials)
  const floorColor = getFinishHex(room.finishes?.floor?.material_id, 'floor', finishMaterials)

  // ── Floor ──────────────────────────────────────────────────────────────────
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
  floorMesh.receiveShadow = true
  scene.add(floorMesh)

  // ── Ceiling ────────────────────────────────────────────────────────────────
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
  scene.add(ceilingMesh)

  // ── Walls (with door/window cutouts) ───────────────────────────────────────
  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(wallColor),
    roughness: 0.6,
    metalness: 0,
    side: THREE.DoubleSide,
  })

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

    const wallDoors = allDoors.filter((d) => d.wall_index === i)
    const wallWindows = allWindows.filter((w) => w.wall_index === i)

    if (wallDoors.length === 0 && wallWindows.length === 0) {
      const wallGeo = new THREE.PlaneGeometry(wallLen, ceilingH)
      const wall = new THREE.Mesh(wallGeo, wallMat)
      wall.position.set((a.u + b.u) / 2, ceilingH / 2, (a.v + b.v) / 2)
      wall.rotation.y = -angle
      wall.receiveShadow = true
      wall.castShadow = true
      scene.add(wall)
    } else {
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

        const doorPanelGeo = new THREE.PlaneGeometry(x1 - x0, doorH)
        const doorPanel = new THREE.Mesh(doorPanelGeo, doorMat)
        const doorLocalX = (x0 + x1) / 2 - wallLen / 2
        const doorLocalY = doorH / 2
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
        doorPanel.castShadow = true
        scene.add(doorPanel)
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

        const frameThickness = 0.04
        const frameGeo = new THREE.PlaneGeometry(x1 - x0 + frameThickness * 2, winH + frameThickness * 2)
        const frame = new THREE.Mesh(frameGeo, windowFrameMat)
        frame.position.copy(glass.position)
        frame.position.y = glassLocalY
        frame.rotation.y = -angle
        const { nu, nv } = (() => {
          const len = Math.sqrt((b.u - a.u) ** 2 + (b.v - a.v) ** 2)
          return { nu: -(b.v - a.v) / len, nv: (b.u - a.u) / len }
        })()
        frame.position.x -= nu * 0.005
        frame.position.z -= nv * 0.005
        scene.add(frame)
      }

      const wallGeo = new THREE.ShapeGeometry(wallShape)
      const wall = new THREE.Mesh(wallGeo, wallMat)
      wall.position.set(a.u, 0, a.v)
      wall.rotation.y = -angle
      wall.receiveShadow = true
      wall.castShadow = true
      scene.add(wall)
    }
  }

  // ── Lighting ───────────────────────────────────────────────────────────────
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambientLight)

  const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.0)
  sunLight.position.set(centroid.u + 3, ceilingH + 2, centroid.v + 3)
  sunLight.castShadow = true
  scene.add(sunLight)

  const fillLight = new THREE.DirectionalLight(0xe0f0ff, 0.3)
  fillLight.position.set(centroid.u - 2, ceilingH, centroid.v - 2)
  scene.add(fillLight)

  const pointLight = new THREE.PointLight(0xffeedd, 0.4, 20)
  pointLight.position.set(centroid.u, ceilingH - 0.1, centroid.v)
  scene.add(pointLight)

  // ── Load and place furniture .glb models ──────────────────────────────────
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
      const { blob: glbBlob, error: dlErr } = await rawStorageDownload('glb-models', variant.glb_path)

      if (dlErr || !glbBlob) {
        warnings.push(`Failed to load model for ${items[pf.furniture_item_id]?.name ?? 'item'}`)
        continue
      }

      const glbBuffer = await glbBlob.arrayBuffer()

      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        loader.parse(glbBuffer, '', (result) => resolve(result), (err) => reject(err))
      })

      const model = gltf.scene

      const item = items[pf.furniture_item_id]
      const box = new THREE.Box3().setFromObject(model)
      const modelSize = box.getSize(new THREE.Vector3())
      const modelCenter = box.getCenter(new THREE.Vector3())

      const targetW = (variant.width_cm ?? item?.width_cm ?? 50) / 100
      const targetD = (variant.depth_cm ?? item?.depth_cm ?? 50) / 100
      const targetH = (variant.height_cm ?? item?.height_cm ?? 50) / 100

      const maxModelDim = Math.max(modelSize.x, modelSize.y, modelSize.z)
      const maxTargetDim = Math.max(targetW, targetD, targetH)
      const scale = (maxTargetDim / maxModelDim) * (pf.scale_factor ?? 1)

      model.scale.setScalar(scale)
      model.position.sub(modelCenter.multiplyScalar(scale))
      model.position.x += pf.x_cm / 100
      model.position.y += (modelSize.y * scale) / 2 + pf.y_cm / 100
      model.position.z += pf.z_cm / 100
      model.rotation.y = (pf.rotation_deg * Math.PI) / 180

      // Enable shadows on all child meshes
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          ;(child as THREE.Mesh).castShadow = true
          ;(child as THREE.Mesh).receiveShadow = true
        }
      })

      scene.add(model)
    } catch (err) {
      warnings.push(`Error loading model: ${String(err)}`)
    }
  }

  // ── Camera ────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    70,
    PREVIEW_WIDTH / PREVIEW_HEIGHT,
    0.1,
    100
  )

  const EYE_HEIGHT = 1.6
  const WALL_OFFSET = 0.4

  // The `(-dv, du) / len` rotation gives the *inward* normal only when
  // the polygon is wound CCW in UV space. Shape edits and legacy data
  // can flip the winding; in that case the same formula gives the
  // OUTWARD normal and the camera ends up outside the room, with the
  // selected wall blocking the view (walls are DoubleSide, so they
  // still render from behind). Detect winding here and flip the sign.
  const windingSign = signedArea(vertices) >= 0 ? 1 : -1

  const wallInwardNormal = (du: number, dv: number) => {
    const len = Math.sqrt(du * du + dv * dv)
    if (len < 0.001) return { nu: 0, nv: 0 }
    return { nu: (-dv / len) * windingSign, nv: (du / len) * windingSign }
  }

  const cameraWallIdx = (params.cameraWallIdx ?? 0) % vertices.length
  const camA = vertices[cameraWallIdx % vertices.length]
  const camB = vertices[(cameraWallIdx + 1) % vertices.length]
  const camMidU = (camA.u + camB.u) / 2
  const camMidV = (camA.v + camB.v) / 2
  const camWallDu = camB.u - camA.u
  const camWallDv = camB.v - camA.v
  const { nu: camNu, nv: camNv } = wallInwardNormal(camWallDu, camWallDv)

  const camPosU = camMidU + camNu * WALL_OFFSET
  const camPosV = camMidV + camNv * WALL_OFFSET

  const lookDist = 10
  const lookU = camPosU + camNu * lookDist
  const lookV = camPosV + camNv * lookDist

  camera.position.set(camPosU, EYE_HEIGHT, camPosV)
  camera.lookAt(lookU, EYE_HEIGHT * 0.92, lookV)

  return { renderer, scene, camera, canvas, warnings, sunLight, pointLight, vertices }
}

// ── Fast Preview renderer ──────────────────────────────────────────────────────

async function renderFastPreview(params: RenderParams): Promise<RenderResult> {
  const { renderer, scene, camera, canvas, warnings, sunLight, pointLight, vertices } =
    await buildRoomScene(params)

  try {
    // ── Shadows ──────────────────────────────────────────────────────────────
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap

    // Fit shadow camera to room bounds
    const us = vertices.map((v) => v.u)
    const vs = vertices.map((v) => v.v)
    const minU = Math.min(...us) - 1
    const maxU = Math.max(...us) + 1
    const minV = Math.min(...vs) - 1
    const maxV = Math.max(...vs) + 1

    sunLight.shadow.mapSize.width = 2048
    sunLight.shadow.mapSize.height = 2048
    sunLight.shadow.camera.near = 0.1
    sunLight.shadow.camera.far = 30
    sunLight.shadow.camera.left = minU
    sunLight.shadow.camera.right = maxU
    sunLight.shadow.camera.top = maxV
    sunLight.shadow.camera.bottom = minV
    sunLight.shadow.bias = -0.001
    sunLight.shadow.normalBias = 0.02

    pointLight.castShadow = true
    pointLight.shadow.mapSize.width = 1024
    pointLight.shadow.mapSize.height = 1024

    // ── Environment map for subtle reflections ────────────────────────────────
    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTexture
    pmremGenerator.dispose()

    // ── Post-processing pipeline ─────────────────────────────────────────────
    // Tone mapping handled by post-processing, not renderer
    renderer.toneMapping = THREE.NoToneMapping

    const { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode } =
      await import('postprocessing')
    const { N8AOPostPass } = await import('n8ao')

    const composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
    })

    // RenderPass: renders the scene
    const renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)

    // N8AOPostPass: screen-space ambient occlusion
    const aoPass = new N8AOPostPass(scene, camera, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    aoPass.configuration.aoRadius = 0.5
    aoPass.configuration.distanceFalloff = 1.0
    aoPass.configuration.intensity = 2.0
    aoPass.configuration.aoSamples = 16
    aoPass.configuration.denoiseSamples = 8
    aoPass.configuration.denoiseRadius = 12
    aoPass.configuration.halfRes = false
    aoPass.configuration.color = new THREE.Color(0x000000)
    composer.addPass(aoPass)

    // Bloom + tone mapping
    const bloomEffect = new BloomEffect({
      luminanceThreshold: 0.8,
      luminanceSmoothing: 0.075,
      intensity: 0.3,
      mipmapBlur: true,
    })
    const toneMappingEffect = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    })
    const effectPass = new EffectPass(camera, bloomEffect, toneMappingEffect)
    composer.addPass(effectPass)

    // Render
    composer.render()

    // Mirror + export
    const blob = await mirrorAndExport(canvas)

    // Cleanup
    composer.dispose()
    envTexture.dispose()
    disposeScene(scene)
    renderer.dispose()
    renderer.forceContextLoss()

    return { blob, error: null, warnings }
  } catch (err) {
    renderer.dispose()
    renderer.forceContextLoss()
    return { blob: null, error: String(err), warnings }
  }
}

// ── HD Preview renderer (GPU Path Tracing) ─────────────────────────────────────

async function renderHDPreview(params: RenderParams): Promise<RenderResult> {
  const { onProgress, abortSignal } = params
  const { renderer, scene, camera, canvas, warnings } = await buildRoomScene(params)

  // Reduced resolution for path tracing — each sample traces every pixel.
  // 960×540 balances quality with performance.
  const HD_WIDTH = 960
  const HD_HEIGHT = 540
  canvas.width = HD_WIDTH
  canvas.height = HD_HEIGHT
  renderer.setSize(HD_WIDTH, HD_HEIGHT)
  ;(camera as THREE.PerspectiveCamera).aspect = HD_WIDTH / HD_HEIGHT
  ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()

  try {
    // ── Environment map for path tracer ──────────────────────────────────────
    // The path tracer's EquirectHdrInfoUniform.updateFrom() needs a DataTexture
    // with raw pixel data (image.data). PMREMGenerator produces a render-target
    // texture (no image.data), which crashes the path tracer. Instead, create a
    // simple equirectangular DataTexture that provides uniform ambient IBL.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2

    // The environment map replaces AmbientLight for path tracing (path tracer
    // ignores AmbientLight). Bright uniform environment = even ambient fill.
    const envSize = 16
    const envPixels = new Float32Array(envSize * envSize * 4)
    for (let i = 0; i < envSize * envSize; i++) {
      envPixels[i * 4 + 0] = 3.0 // bright warm white — replaces ambient light
      envPixels[i * 4 + 1] = 2.9
      envPixels[i * 4 + 2] = 2.7
      envPixels[i * 4 + 3] = 1.0
    }
    const envTexture = new THREE.DataTexture(envPixels, envSize, envSize, THREE.RGBAFormat, THREE.FloatType)
    envTexture.needsUpdate = true
    scene.environment = envTexture

    // ── Path tracer setup ────────────────────────────────────────────────────
    const { WebGLPathTracer } = await import('three-gpu-pathtracer')

    const pathTracer = new WebGLPathTracer(renderer)
    pathTracer.bounces = 5          // interior rooms need multiple bounces for GI
    pathTracer.tiles.set(4, 4)      // 16 tiles = smaller GPU work per renderSample
    pathTracer.renderDelay = 0
    pathTracer.fadeDuration = 0
    pathTracer.minSamples = 1
    pathTracer.renderToCanvas = true
    pathTracer.filterGlossyFactor = 0.5
    pathTracer.dynamicLowRes = false

    // ── Add interior lighting for path tracing ──────────────────────────────
    // Path tracer ignores AmbientLight and environment light can't penetrate
    // walls. Add physical lights INSIDE the room for proper illumination.

    // Large ceiling area light — simulates recessed ceiling lighting
    const ceilingH = (params.room.ceiling_height_cm ?? 260) / 100
    const centroid = polygonCentroid(getVertices(params.room))
    const areaLight = new THREE.RectAreaLight(0xfff5e8, 8, 2.5, 2.5)
    areaLight.position.set(centroid.u, ceilingH - 0.05, centroid.v)
    areaLight.lookAt(centroid.u, 0, centroid.v) // point down
    scene.add(areaLight)

    // Boost the existing point light for path tracing (rasterizer uses 0.4)
    scene.traverse((child) => {
      if ((child as THREE.PointLight).isPointLight) {
        (child as THREE.PointLight).intensity = 5
        ;(child as THREE.PointLight).distance = 0 // infinite range
      }
      // Boost directional lights too
      if ((child as THREE.DirectionalLight).isDirectionalLight) {
        (child as THREE.DirectionalLight).intensity *= 3
      }
    })

    // The path tracer's StaticGeometryGenerator merges all mesh geometries into
    // one. This requires every geometry to have the SAME set of attributes.
    // GLB models may lack `normal`, room geometry lacks `tangent`/`color`, etc.
    // Ensure all 5 required attributes exist on every mesh before merging.
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const geo = (child as THREE.Mesh).geometry
        const count = geo.attributes.position?.count ?? 0
        if (!geo.attributes.normal) {
          geo.computeVertexNormals()
        }
        if (!geo.attributes.uv) {
          geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
        }
        if (!geo.attributes.tangent) {
          geo.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(count * 4), 4))
        }
        if (!geo.attributes.color) {
          const arr = new Float32Array(count * 3)
          arr.fill(1) // default white
          geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
        }
      }
    })

    // Yield to let UI show "Preparing HD..." before the synchronous BVH build
    await new Promise((r) => setTimeout(r, 50))

    // Build BVH and prepare scene for path tracing (blocks main thread 1-3s)
    pathTracer.setScene(scene, camera)

    if (abortSignal?.aborted) {
      pathTracer.dispose()
      envTexture.dispose()
      disposeScene(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      return { blob: null, error: 'Cancelled', warnings }
    }

    // ── Progressive rendering loop ───────────────────────────────────────────
    // Yield to browser every sample so the UI stays responsive. Report progress
    // with preview images every REPORT_INTERVAL samples.
    const TARGET_SAMPLES = 128
    const REPORT_INTERVAL = 8
    const MAX_TIME_MS = 30000 // 30s hard cap
    const startTime = Date.now()

    const yieldFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

    while (pathTracer.samples < TARGET_SAMPLES) {
      if (abortSignal?.aborted) break
      if (Date.now() - startTime > MAX_TIME_MS) break

      pathTracer.renderSample()

      // Yield to browser every sample to keep UI responsive
      await yieldFrame()

      if (pathTracer.samples % REPORT_INTERVAL === 0 && onProgress) {
        const progressUrl = mirrorToDataUrl(canvas)
        onProgress(pathTracer.samples, TARGET_SAMPLES, progressUrl)
      }
    }

    // Final export
    const blob = await mirrorAndExport(canvas)

    // Cleanup
    pathTracer.dispose()
    envTexture.dispose()
    disposeScene(scene)
    renderer.dispose()
    renderer.forceContextLoss()

    return { blob, error: null, warnings }
  } catch (err) {
    renderer.dispose()
    renderer.forceContextLoss()

    const errMsg = String(err)
    if (errMsg.includes('shader') || errMsg.includes('compile') || errMsg.includes('WebGL')) {
      return {
        blob: null,
        error: 'HD rendering is not supported on this device. Try Fast Preview instead.',
        warnings,
      }
    }
    return { blob: null, error: errMsg, warnings }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function getFinishHex(
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

/** Mirror canvas horizontally and export as PNG blob. */
async function mirrorAndExport(canvas: HTMLCanvasElement): Promise<Blob> {
  const w = canvas.width
  const h = canvas.height
  const mirrorCanvas = document.createElement('canvas')
  mirrorCanvas.width = w
  mirrorCanvas.height = h
  const ctx = mirrorCanvas.getContext('2d')!
  ctx.translate(w, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(canvas, 0, 0)

  return new Promise<Blob>((resolve, reject) => {
    mirrorCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
      'image/png'
    )
  })
}

/** Mirror canvas and return as JPEG data URL (fast, for progressive preview). */
function mirrorToDataUrl(canvas: HTMLCanvasElement): string {
  const w = canvas.width
  const h = canvas.height
  const mirrorCanvas = document.createElement('canvas')
  mirrorCanvas.width = w
  mirrorCanvas.height = h
  const ctx = mirrorCanvas.getContext('2d')!
  ctx.translate(w, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(canvas, 0, 0)
  return mirrorCanvas.toDataURL('image/jpeg', 0.7)
}

/** Dispose all geometries, materials, and textures in a scene. */
function disposeScene(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh
      mesh.geometry.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial) {
          m.map?.dispose()
          m.normalMap?.dispose()
          m.roughnessMap?.dispose()
          m.metalnessMap?.dispose()
          m.emissiveMap?.dispose()
          m.envMap?.dispose()
        }
        m.dispose()
      }
    }
  })
}
