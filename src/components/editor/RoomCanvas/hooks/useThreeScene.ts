import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import { disposeSceneObjects } from '@/lib/roomScene'
import { getVertices, polygonCentroid, pointInPolygon, nearestPointOnPolygon } from '@/lib/roomGeometry'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useUIStore } from '@/stores/useUIStore'
import { useProjectStore } from '@/stores/useProjectStore'
import type { Room } from '@/types'
import type { SceneContext } from '../types'

/**
 * Mounts the persistent Three.js scene: renderer, camera, OrbitControls,
 * PointerLockControls (roam mode), shell / furniture / handle / grid layers,
 * and the animation loop that handles:
 *   - OrbitControls damping (design mode)
 *   - WASD + polygon-clamp movement (roam mode)
 *   - Ceiling reveal when design camera dips below ceiling height
 *   - Wall-length labels overlay during Edit Shape mode
 *   - Rendering every frame
 *
 * Returns a stable `SceneContext` held across the component lifetime.
 * Mount/unmount lifecycle + cleanup live entirely inside this hook.
 *
 * NOTE: The mount effect intentionally has an empty dep array — the scene
 * is created once and persists. `room` is observed via closure for the
 * roam-mode polygon clamp; since rooms can't be swapped while roam is
 * active in practice, reading from the project store each frame would be
 * an unnecessary micro-regression.
 */
export function useThreeScene(room: Room): SceneContext {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const roamControlsRef = useRef<PointerLockControls | null>(null)
  const animationIdRef = useRef<number>(0)
  const roamKeysRef = useRef({ w: false, a: false, s: false, d: false, shift: false })

  const shellGroupRef = useRef<THREE.Group | null>(null)
  const lightingGroupRef = useRef<THREE.Group | null>(null)
  const ceilingMeshRef = useRef<THREE.Mesh | null>(null)
  const furnitureLayerRef = useRef<THREE.Group | null>(null)
  const handleLayerRef = useRef<THREE.Group | null>(null)
  const gridGroupRef = useRef<THREE.Group | null>(null)
  const furnitureGroupsRef = useRef<Map<string, THREE.Group>>(new Map())
  const furnitureSignaturesRef = useRef<Map<string, string>>(new Map())
  const framedRoomIdRef = useRef<string | null>(null)
  const dimLabelsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0xF5F3EF, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // Design view pitch: from near-top-down (~9°) to just above horizontal (~80°).
    // Wider range than the legacy isometric fixed 4-corner views.
    controls.minPolarAngle = Math.PI * 0.05
    controls.maxPolarAngle = Math.PI * 0.48
    controls.minDistance = 2
    controls.maxDistance = 25
    controls.enablePan = true
    controls.screenSpacePanning = false
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    controlsRef.current = controls

    // First-person controls for roam mode. Mouse look via pointer-lock.
    // Disabled initially — activated only when useUIStore.cameraMode === 'roam'.
    const roamControls = new PointerLockControls(camera, renderer.domElement)
    roamControlsRef.current = roamControls

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xF5F3EF)

    // World grid — Y=-0.001, ±20m range. 1m majors + 50cm minors.
    const gridGroup = new THREE.Group()
    gridGroup.name = 'world-grid'
    gridGroup.visible = useUIStore.getState().canvasGrid
    {
      const size = 40
      const majors = new THREE.GridHelper(size, size, 0x888888, 0x888888)
      const minors = new THREE.GridHelper(size, size * 2, 0xCCCCCC, 0xCCCCCC)
      for (const g of [majors, minors]) {
        const m = g.material as THREE.Material | THREE.Material[]
        if (Array.isArray(m)) { for (const x of m) { x.transparent = true; (x as THREE.LineBasicMaterial).opacity = g === majors ? 0.35 : 0.18 } }
        else { m.transparent = true; (m as THREE.LineBasicMaterial).opacity = g === majors ? 0.35 : 0.18 }
        g.position.y = g === majors ? -0.0005 : -0.001
      }
      gridGroup.add(minors, majors)
    }
    scene.add(gridGroup)
    gridGroupRef.current = gridGroup

    const shellGroup = new THREE.Group()
    shellGroup.name = 'shell-layer'
    scene.add(shellGroup)
    shellGroupRef.current = shellGroup

    // Persistent lighting group — survives shell rebuilds so slider-driven
    // setting changes don't trigger a geometry rebuild.
    const lightingGroup = new THREE.Group()
    lightingGroup.name = 'lighting-layer'
    scene.add(lightingGroup)
    lightingGroupRef.current = lightingGroup

    const furnitureLayer = new THREE.Group()
    furnitureLayer.name = 'furniture-layer'
    scene.add(furnitureLayer)
    furnitureLayerRef.current = furnitureLayer

    const handleLayer = new THREE.Group()
    handleLayer.name = 'handle-layer'
    scene.add(handleLayer)
    handleLayerRef.current = handleLayer

    sceneRef.current = scene

    // Keep grid visibility in sync with UI store
    const unsubGrid = useUIStore.subscribe((state, prev) => {
      if (state.canvasGrid === prev.canvasGrid) return
      if (gridGroupRef.current) gridGroupRef.current.visible = state.canvasGrid
    })

    // Roam movement constants
    const ROAM_BASE_SPEED = 2.5    // m/s
    const ROAM_SHIFT_MULT = 2.0    // shift = fast
    const EYE_HEIGHT = 1.6         // metres from floor
    let lastFrameTime = performance.now()

    const animate = () => {
      const now = performance.now()
      const dt = Math.min(0.1, (now - lastFrameTime) / 1000)
      lastFrameTime = now

      const mode = useUIStore.getState().cameraMode
      if (mode === 'design') {
        controls.update()
      } else if (mode === 'roam' && roamControls.isLocked) {
        const k = roamKeysRef.current
        const speed = ROAM_BASE_SPEED * (k.shift ? ROAM_SHIFT_MULT : 1)
        let fwd = 0, right = 0
        if (k.w) fwd += 1
        if (k.s) fwd -= 1
        if (k.d) right += 1
        if (k.a) right -= 1
        if (fwd !== 0 || right !== 0) {
          const len = Math.sqrt(fwd * fwd + right * right)
          fwd /= len; right /= len
          const delta = speed * dt
          roamControls.moveForward(fwd * delta)
          roamControls.moveRight(right * delta)
          camera.position.y = EYE_HEIGHT
          const verts = getVertices(room)
          if (!pointInPolygon(camera.position.x, camera.position.z, verts)) {
            const np = nearestPointOnPolygon(camera.position.x, camera.position.z, verts)
            const toCentroid = polygonCentroid(verts)
            const dirU = toCentroid.u - np.u, dirV = toCentroid.v - np.v
            const dlen = Math.sqrt(dirU * dirU + dirV * dirV) || 1
            camera.position.x = np.u + (dirU / dlen) * 0.02
            camera.position.z = np.v + (dirV / dlen) * 0.02
          }
        }
      }

      // Design-mode ceiling reveal: dollhouse hides the ceiling by default
      // so the designer can orbit around the outside and see in. But when
      // the orbit camera tilts low enough that its eye dips below the
      // ceiling height, show the ceiling so the space reads as enclosed.
      if (mode === 'design' && ceilingMeshRef.current) {
        const ceilingH = ceilingMeshRef.current.position.y
        ceilingMeshRef.current.visible = camera.position.y < ceilingH
      }

      if (sceneRef.current && cameraRef.current && rendererRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current)
      }

      updateDimLabels()

      animationIdRef.current = requestAnimationFrame(animate)
    }
    animate()

    /**
     * Update per-wall cm length labels overlay. Only visible while
     * shape-edit mode is on (and we're in design mode — hide in roam).
     * Reads the live room geometry from the project store so labels
     * stay in sync with wall push/pull during drags.
     */
    function updateDimLabels() {
      const layer = dimLabelsRef.current
      if (!layer) return
      const show =
        useCanvasStore.getState().shapeEditMode &&
        useUIStore.getState().cameraMode === 'design'
      if (!show) {
        if (layer.childElementCount > 0) layer.replaceChildren()
        return
      }

      const cam = cameraRef.current
      const cont = containerRef.current
      const room0 = useProjectStore.getState().rooms.find((r) => r.id === room.id)
      if (!cam || !cont || !room0) return

      const verts = getVertices(room0)
      const N = verts.length

      while (layer.childElementCount < N) {
        const div = document.createElement('div')
        div.className = 'wall-dim-label'
        layer.appendChild(div)
      }
      while (layer.childElementCount > N) {
        layer.removeChild(layer.lastChild!)
      }

      const w = cont.clientWidth
      const h = cont.clientHeight
      const ceilingH = (room0.ceiling_height_cm ?? 260) / 100
      const tmp = new THREE.Vector3()
      for (let i = 0; i < N; i++) {
        const a = verts[i]
        const b = verts[(i + 1) % N]
        const du = b.u - a.u, dv = b.v - a.v
        const lengthCm = Math.round(Math.hypot(du, dv) * 100)
        // Anchor at the wall's top-edge midpoint so the label doesn't cover
        // the midpoint handle on the floor (which adds a new vertex).
        tmp.set((a.u + b.u) / 2, ceilingH, (a.v + b.v) / 2)
        tmp.project(cam)
        const el = layer.children[i] as HTMLDivElement
        if (tmp.z < -1 || tmp.z > 1) {
          el.style.display = 'none'
          continue
        }
        const sx = (tmp.x * 0.5 + 0.5) * w
        const sy = (-tmp.y * 0.5 + 0.5) * h
        el.style.display = 'block'
        el.style.transform = `translate(-50%, calc(-50% - 14px)) translate(${sx}px, ${sy}px)`
        el.textContent = `${lengthCm} cm`
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!rendererRef.current || !cameraRef.current || !container) return
      const w = container.clientWidth
      const h = container.clientHeight
      rendererRef.current.setSize(w, h)
      cameraRef.current.aspect = w / h
      cameraRef.current.updateProjectionMatrix()
    })
    resizeObserver.observe(container)

    return () => {
      cancelAnimationFrame(animationIdRef.current)
      resizeObserver.disconnect()
      controls.dispose()
      unsubGrid()
      if (sceneRef.current) disposeSceneObjects(sceneRef.current)
      renderer.dispose()
      renderer.forceContextLoss()
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      shellGroupRef.current = null
      lightingGroupRef.current = null
      furnitureLayerRef.current = null
      handleLayerRef.current = null
      gridGroupRef.current = null
      furnitureGroupsRef.current.clear()
      furnitureSignaturesRef.current.clear()
      framedRoomIdRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    containerRef,
    rendererRef,
    sceneRef,
    cameraRef,
    controlsRef,
    roamControlsRef,
    shellGroupRef,
    lightingGroupRef,
    furnitureLayerRef,
    handleLayerRef,
    gridGroupRef,
    ceilingMeshRef,
    furnitureGroupsRef,
    furnitureSignaturesRef,
    framedRoomIdRef,
    dimLabelsRef,
    roamKeysRef,
  }
}
