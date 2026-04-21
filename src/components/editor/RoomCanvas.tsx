/**
 * 3D room canvas — Three.js scene.
 *
 * Phase 8b: Room shell (floor, walls with cutouts, ceiling, finishes) + orbit camera.
 * Phase 8c: Furniture rendering (.glb + flat planes + placeholders), click-to-place,
 *           selection, drag-to-move with grid snap, scroll-wheel rotate, delete.
 *
 * Interaction model:
 *   - Empty canvas click: deselect
 *   - Furniture click: select (highlight)
 *   - Placement mode: ghost follows cursor, click commits
 *   - Drag selected: moves via floor raycast, snaps to effective block size
 *     (Ctrl bypasses snap)
 *   - Scroll-wheel on selected: rotates by 15° (Ctrl = continuous). No selection
 *     → wheel zooms camera (OrbitControls default).
 *   - Delete/Backspace: removes selected. Esc: cancels placement or deselects.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import {
  addStandardLighting,
  buildRoomShell,
  createFurnitureGroup,
  disposeSceneObjects,
} from '@/lib/roomScene'
import { getVertices, polygonCentroid, pointInPolygon, nearestPointOnPolygon, nearestWallSnap } from '@/lib/roomGeometry'
import { blockStepCm } from '@/lib/blockGrid'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore } from '@/stores/useUIStore'
import type { Room, FinishMaterial, PlacedFurniture } from '@/types'

interface Props {
  room: Room
  finishMaterials: FinishMaterial[]
}

/** Effective grid step (cm) for a given item — respects block_size_override. */
function getGridStepCm(itemId: string): number {
  const catalog = useCatalogStore.getState()
  const item = catalog.items.find((i) => i.id === itemId)
  if (!item) return blockStepCm('big')
  const effective = item.block_size_override ?? catalog.categories.find((c) => c.id === item.category_id)?.default_block_size ?? 'big'
  return blockStepCm(effective)
}

/** Snap a cm value to the nearest multiple of step (or pass-through if ctrl). */
function snapCm(valCm: number, stepCm: number, bypass: boolean): number {
  if (bypass) return valCm
  return Math.round(valCm / stepCm) * stepCm
}

/**
 * Resolve physical dimensions (width + height in metres) for a fixture
 * during placement. Falls back to sensible defaults when no variant is
 * picked (generic fallback fixture).
 */
function getFixtureDims(
  itemId: string | null,
  variantId: string | null,
  type: 'door' | 'window' | null,
): { widthM: number; heightM: number } {
  const defaults = type === 'door'
    ? { widthM: 0.8, heightM: 2.1 }
    : { widthM: 1.2, heightM: 1.2 }
  if (!itemId) return defaults
  const catalog = useCatalogStore.getState()
  const item = catalog.items.find((i) => i.id === itemId)
  if (!item) return defaults
  const variants = catalog.variants[itemId] ?? []
  const variant = variantId ? variants.find((v) => v.id === variantId) : undefined
  const widthCm = variant?.width_cm ?? item.width_cm ?? null
  const heightCm = variant?.height_cm ?? item.height_cm ?? null
  return {
    widthM: widthCm != null ? widthCm / 100 : defaults.widthM,
    heightM: heightCm != null ? heightCm / 100 : defaults.heightM,
  }
}

export default function RoomCanvas({ room, finishMaterials }: Props) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const roamControlsRef = useRef<PointerLockControls | null>(null)
  const animationIdRef = useRef<number>(0)
  /** Per-frame keyboard state for WASD roam movement. */
  const roamKeysRef = useRef({ w: false, a: false, s: false, d: false, shift: false })

  // Scene refs we update mid-flight
  /** Shell group — rebuilt when geometry/finishes change. Parent for floor+walls+ceiling+lights. */
  const shellGroupRef = useRef<THREE.Group | null>(null)
  const floorMeshRef = useRef<THREE.Mesh | null>(null)
  /**
   * Ceiling mesh ref so the animate loop can reveal it whenever the orbit
   * camera tilts low enough that its eye dips below ceiling height — makes
   * the room read as enclosed in corner/low-angle views. Hidden by default
   * in design mode (dollhouse). Roam mode keeps it always visible via the
   * shell's `mode: 'full'` build.
   */
  const ceilingMeshRef = useRef<THREE.Mesh | null>(null)
  /** Persistent across shell rebuilds. */
  const furnitureLayerRef = useRef<THREE.Group | null>(null)
  /** Persistent across shell rebuilds. Holds vertex + midpoint drag handles. */
  const handleLayerRef = useRef<THREE.Group | null>(null)
  /** Persistent world-grid reference (two line layers: 1m major + 50cm minor). */
  const gridGroupRef = useRef<THREE.Group | null>(null)
  /** Map<placedId, group> — for in-place transform updates. */
  const furnitureGroupsRef = useRef<Map<string, THREE.Group>>(new Map())
  /** Map<placedId, signature> — rebuild the group when the signature changes. */
  const furnitureSignaturesRef = useRef<Map<string, string>>(new Map())
  const selectionRingRef = useRef<THREE.Mesh | null>(null)
  const ghostGroupRef = useRef<THREE.Group | null>(null)
  /** Translucent indicator shown while placing a door/window — snaps to the nearest wall. */
  const fixtureGhostRef = useRef<THREE.Mesh | null>(null)
  /** Container for per-wall cm length labels shown in Edit Shape mode. */
  const dimLabelsRef = useRef<HTMLDivElement>(null)
  /**
   * Fixture move state: set when the user has "picked up" a door/window by
   * clicking it. The fixture then follows the cursor until the next click
   * commits, or Escape cancels (restoring prevGeometry).
   */
  const fixtureMoveRef = useRef<{
    fixtureId: string
    fixtureType: 'door' | 'window'
    prevGeometry: import('@/types').RoomGeometry
    prevWidthCm: number
    prevHeightCm: number
  } | null>(null)
  /** Room ID the camera was last framed for — avoid re-framing on every geometry tweak. */
  const framedRoomIdRef = useRef<string | null>(null)
  /** Vertex-drag state for edit shape mode. */
  const vertexDragRef = useRef<{
    vertexIndex: number
    prevGeometry: import('@/types').RoomGeometry
    prevWidthCm: number
    prevHeightCm: number
  } | null>(null)

  /** Wall push/pull drag state for edit shape mode. */
  const wallDragRef = useRef<{
    wallIndex: number
    /** Indices of the two vertices that bound this wall. */
    vA: number
    vB: number
    /** Original positions at drag start. */
    origA: { u: number; v: number }
    origB: { u: number; v: number }
    /** Unit outward normal of the wall (used as the drag axis). */
    normalU: number
    normalV: number
    /** Cursor's projection onto the normal axis at drag start. */
    startProj: number
    prevGeometry: import('@/types').RoomGeometry
    prevWidthCm: number
    prevHeightCm: number
  } | null>(null)

  // Drag state (persistent across pointermove frames)
  const dragStateRef = useRef<{
    placedId: string
    prevX: number
    prevZ: number
    offsetX: number
    offsetZ: number
  } | null>(null)

  // Rotate-in-progress tracker for undo grouping
  const rotateStateRef = useRef<{ placedId: string; prevDeg: number } | null>(null)

  // ── Helper: screen → Y=0 plane raycast ──────────────────────────────────────
  // Uses the infinite floor plane instead of the polygon mesh so cursor drags
  // outside the current room footprint still produce valid hits. Callers that
  // need to clamp to the room polygon (furniture place/drag) do so themselves.
  const raycastFloor = useCallback((clientX: number, clientY: number): { x: number; z: number } | null => {
    const container = containerRef.current
    const camera = cameraRef.current
    if (!container || !camera) return null

    const rect = container.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) // Y=0
    const hit = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return null
    return { x: hit.x, z: hit.z }
  }, [])

  /**
   * Raycast against door / window meshes. Returns the hit fixture's id + type,
   * or null. Walks up the parent tree looking for `userData.fixtureId`, which
   * `buildRoomShell` stamps onto each fixture's slot group.
   */
  const raycastFixture = useCallback((clientX: number, clientY: number):
    | { fixtureId: string; fixtureType: 'door' | 'window' }
    | null => {
    const container = containerRef.current
    const camera = cameraRef.current
    const shell = shellGroupRef.current
    if (!container || !camera || !shell) return null

    const rect = container.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const hits = raycaster.intersectObjects(shell.children, true)
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        const fid = o.userData?.fixtureId
        const ftype = o.userData?.fixtureType
        if (fid && (ftype === 'door' || ftype === 'window')) {
          return { fixtureId: fid as string, fixtureType: ftype }
        }
        o = o.parent
      }
    }
    return null
  }, [])

  const raycastFurniture = useCallback((clientX: number, clientY: number): string | null => {
    const container = containerRef.current
    const camera = cameraRef.current
    const layer = furnitureLayerRef.current
    if (!container || !camera || !layer) return null

    const rect = container.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const hits = raycaster.intersectObjects(layer.children, true)
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        const pid = o.userData?.placedId
        if (pid && typeof pid === 'string') return pid
        o = o.parent
      }
    }
    return null
  }, [])

  // ── Mount: renderer, camera, controls, render loop ──────────────────────────
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
    // Use right-click drag for panning, left-click for orbit. Middle is zoom.
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

    // Create persistent scene with persistent layers.
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xF5F3EF)

    // World grid — sits at Y=-0.001 behind the shell. Toggled via useUIStore.
    // 1m majors + 50cm minors, ±20m range (covers aggressive vertex drags).
    const gridGroup = new THREE.Group()
    gridGroup.name = 'world-grid'
    gridGroup.visible = useUIStore.getState().canvasGrid
    {
      const size = 40
      const majors = new THREE.GridHelper(size, size, 0x888888, 0x888888)  // 1m
      const minors = new THREE.GridHelper(size, size * 2, 0xCCCCCC, 0xCCCCCC) // 50cm
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
      const dt = Math.min(0.1, (now - lastFrameTime) / 1000) // clamp to 100ms to avoid jumps
      lastFrameTime = now

      const mode = useUIStore.getState().cameraMode
      if (mode === 'design') {
        controls.update()
      } else if (mode === 'roam' && roamControls.isLocked) {
        // WASD movement in camera-local horizontal plane
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
          // Keep eye at 160cm regardless of vertical look
          camera.position.y = EYE_HEIGHT
          // Clamp to room polygon so user can't walk through walls
          const verts = getVertices(room)
          if (!pointInPolygon(camera.position.x, camera.position.z, verts)) {
            const np = nearestPointOnPolygon(camera.position.x, camera.position.z, verts)
            // Nudge slightly inside to avoid getting stuck on wall edge
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
      // ceiling height, we're effectively looking at a corner view from
      // inside the room — show the ceiling so the space reads as enclosed.
      // Roam mode never hits this branch (shell builds ceiling visible).
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

      // Reconcile child count with wall count
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
      const tmp = new THREE.Vector3()
      for (let i = 0; i < N; i++) {
        const a = verts[i]
        const b = verts[(i + 1) % N]
        const du = b.u - a.u, dv = b.v - a.v
        const lengthCm = Math.round(Math.hypot(du, dv) * 100)
        // Lift the label slightly above the floor so it reads clearly
        tmp.set((a.u + b.u) / 2, 0.05, (a.v + b.v) / 2)
        tmp.project(cam)
        const el = layer.children[i] as HTMLDivElement
        // Behind the camera: hide
        if (tmp.z < -1 || tmp.z > 1) {
          el.style.display = 'none'
          continue
        }
        const sx = (tmp.x * 0.5 + 0.5) * w
        const sy = (-tmp.y * 0.5 + 0.5) * h
        el.style.display = 'block'
        el.style.transform = `translate(-50%, -50%) translate(${sx}px, ${sy}px)`
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
      floorMeshRef.current = null
      shellGroupRef.current = null
      furnitureLayerRef.current = null
      handleLayerRef.current = null
      gridGroupRef.current = null
      furnitureGroupsRef.current.clear()
      furnitureSignaturesRef.current.clear()
      framedRoomIdRef.current = null
    }
  }, [])

  // ── Rebuild shell (floor / walls / ceiling / lights) ──────────────────────
  // Depends on: room geometry, finishes, camera mode, AND any change to a
  // variant referenced by a fixture (so the shell re-renders .glb inside the
  // cutout when TRELLIS finishes or the designer swaps styles).
  const shellModeCameraMode = useUIStore((s) => s.cameraMode)
  // Build a stable key from all fixture variant_ids + their render/glb state.
  // When that key changes, rebuild the shell to pull in the latest .glb.
  const fixtureVariantSignature = useCatalogStore((s) => {
    const doors = room.geometry?.doors ?? []
    const windows = room.geometry?.windows ?? []
    const ids = [
      ...doors.map((d) => d.variant_id).filter(Boolean),
      ...windows.map((w) => w.variant_id).filter(Boolean),
    ] as string[]
    if (ids.length === 0) return 'none'
    const parts: string[] = []
    for (const list of Object.values(s.variants)) {
      for (const v of list) {
        if (ids.includes(v.id)) {
          parts.push(`${v.id}:${v.render_status}:${v.glb_path ?? ''}`)
        }
      }
    }
    return parts.sort().join('|')
  })
  useEffect(() => {
    const shellGroup = shellGroupRef.current
    if (!shellGroup || !cameraRef.current || !controlsRef.current) return

    for (const child of [...shellGroup.children]) {
      shellGroup.remove(child)
      disposeSceneObjects(child as unknown as THREE.Scene)
    }

    // Roam mode: walls + ceiling solid (you're inside the room, presenting).
    // Design mode: dollhouse — camera is outside, walls facing camera cull.
    const shellMode = shellModeCameraMode === 'roam' ? 'full' : 'dollhouse'
    const shell = buildRoomShell(shellGroup, room, finishMaterials, {
      mode: shellMode,
      resolveVariant: (variantId) => {
        const catalog = useCatalogStore.getState()
        for (const list of Object.values(catalog.variants)) {
          const found = list.find((v) => v.id === variantId)
          if (found) return found
        }
        return undefined
      },
    })
    addStandardLighting(shellGroup, room)
    floorMeshRef.current = shell.floorMesh
    ceilingMeshRef.current = shell.ceilingMesh

    // Only frame the camera when switching to a different room — preserve pose
    // during geometry edits so vertex drag doesn't yank the camera.
    if (framedRoomIdRef.current !== room.id) {
      const vertices = getVertices(room)
      const centroid = polygonCentroid(vertices)
      const ceilingH = (room.ceiling_height_cm ?? 260) / 100
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
      for (const v of vertices) {
        if (v.u < minU) minU = v.u
        if (v.u > maxU) maxU = v.u
        if (v.v < minV) minV = v.v
        if (v.v > maxV) maxV = v.v
      }
      const maxRoomDim = Math.max(maxU - minU, maxV - minV, ceilingH)
      const camDist = maxRoomDim * 1.4
      cameraRef.current.position.set(
        centroid.u + camDist * 0.7,
        ceilingH * 1.6,
        centroid.v + camDist * 0.7
      )
      controlsRef.current.target.set(centroid.u, ceilingH * 0.4, centroid.v)
      controlsRef.current.update()
      framedRoomIdRef.current = room.id
    }
  }, [room, finishMaterials, shellModeCameraMode, fixtureVariantSignature])

  // ── Furniture rendering: sync placedFurniture ↔ scene graph ─────────────────
  useEffect(() => {
    // Re-sync whenever placed furniture OR catalog (items/variants) changes.
    // Dims, flat flag, scale → rebuild mesh. Position/rotation → update in place.
    const unsubCanvas = useCanvasStore.subscribe((state, prev) => {
      if (state.placedFurniture === prev.placedFurniture) return
      syncFurniture()
    })
    const unsubCatalog = useCatalogStore.subscribe((state, prev) => {
      if (state.items === prev.items && state.variants === prev.variants) return
      syncFurniture()
    })
    syncFurniture()
    return () => {
      unsubCanvas()
      unsubCatalog()
    }

    function signature(
      pf: PlacedFurniture,
      variant: import('@/types').FurnitureVariant,
      item: import('@/types').FurnitureItem,
      isFlat: boolean,
    ): string {
      // Any change in this string triggers a mesh rebuild.
      const w = variant.width_cm ?? item.width_cm ?? 50
      const d = variant.depth_cm ?? item.depth_cm ?? 50
      const h = variant.height_cm ?? item.height_cm ?? 50
      const glb = isFlat ? 'flat' : variant.glb_path ?? 'placeholder'
      return `${pf.selected_variant_id}|${w}|${d}|${h}|${glb}|${pf.scale_factor ?? 1}`
    }

    function disposeGroup(group: THREE.Group) {
      group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.geometry?.dispose()
          const mat = m.material
          if (Array.isArray(mat)) { for (const x of mat) x.dispose() }
          else if (mat) mat.dispose()
        }
      })
    }

    function syncFurniture() {
      const layer = furnitureLayerRef.current
      if (!layer) return
      const catalog = useCatalogStore.getState()
      const canvas = useCanvasStore.getState()
      const existing = furnitureGroupsRef.current
      const signatures = furnitureSignaturesRef.current

      const seen = new Set<string>()
      for (const pf of canvas.placedFurniture) {
        seen.add(pf.id)
        const variants = catalog.variants[pf.furniture_item_id] ?? []
        const variant = variants.find((v) => v.id === pf.selected_variant_id)
        const item = catalog.items.find((i) => i.id === pf.furniture_item_id)
        if (!variant || !item) continue

        const isFlat = catalog.isItemFlat(item.id)
        const sig = signature(pf, variant, item, isFlat)
        const currentGroup = existing.get(pf.id)
        const currentSig = signatures.get(pf.id)

        if (currentGroup && currentSig === sig) {
          // Only transform changed — update in place.
          currentGroup.position.set(pf.x_cm / 100, pf.y_cm / 100, pf.z_cm / 100)
          currentGroup.rotation.y = (pf.rotation_deg * Math.PI) / 180
          continue
        }

        // Signature changed (or new) → rebuild.
        if (currentGroup) {
          layer.remove(currentGroup)
          disposeGroup(currentGroup)
        }
        const { group, loader } = createFurnitureGroup({ placed: pf, variant, item, isFlat })
        layer.add(group)
        existing.set(pf.id, group)
        signatures.set(pf.id, sig)
        void loader()
      }

      // Remove stale
      for (const [id, group] of existing) {
        if (!seen.has(id)) {
          layer.remove(group)
          disposeGroup(group)
          existing.delete(id)
          signatures.delete(id)
        }
      }
    }
  }, [])

  // ── Selection ring ──────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (state.selectedItemId === prev.selectedItemId) return
      updateSelectionRing()
    })
    updateSelectionRing()
    return unsub

    function updateSelectionRing() {
      const scene = sceneRef.current
      if (!scene) return
      const id = useCanvasStore.getState().selectedItemId

      // Clear previous ring
      if (selectionRingRef.current) {
        scene.remove(selectionRingRef.current)
        selectionRingRef.current.geometry.dispose()
        ;(selectionRingRef.current.material as THREE.Material).dispose()
        selectionRingRef.current = null
      }
      if (!id) return

      const group = furnitureGroupsRef.current.get(id)
      if (!group) return
      const box = new THREE.Box3().setFromObject(group)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.z, 0.3)

      const ringGeo = new THREE.RingGeometry(maxDim * 0.55, maxDim * 0.65, 48)
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x2BA8A0,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = -Math.PI / 2
      ring.position.set(group.position.x, 0.005, group.position.z)
      ring.renderOrder = 10
      scene.add(ring)
      selectionRingRef.current = ring
    }
  }, [])

  // Keep selection ring synced to group movement (during drag)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const id = useCanvasStore.getState().selectedItemId
      const ring = selectionRingRef.current
      if (id && ring) {
        const g = furnitureGroupsRef.current.get(id)
        if (g) ring.position.set(g.position.x, 0.005, g.position.z)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ── Placement ghost ─────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (state.placementMode === prev.placementMode && state.placementVariantId === prev.placementVariantId) return
      syncGhost()
    })
    return unsub

    function syncGhost() {
      const layer = furnitureLayerRef.current
      if (!layer) return
      const s = useCanvasStore.getState()

      // Clear previous ghost
      if (ghostGroupRef.current) {
        layer.remove(ghostGroupRef.current)
        ghostGroupRef.current.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            m.geometry?.dispose()
            const mat = m.material
            if (Array.isArray(mat)) { for (const x of mat) x.dispose() }
            else if (mat) mat.dispose()
          }
        })
        ghostGroupRef.current = null
      }

      if (!s.placementMode || !s.placementItemId || !s.placementVariantId) return

      const catalog = useCatalogStore.getState()
      const variants = catalog.variants[s.placementItemId] ?? []
      const variant = variants.find((v) => v.id === s.placementVariantId)
      const item = catalog.items.find((i) => i.id === s.placementItemId)
      if (!variant || !item) return
      const isFlat = catalog.isItemFlat(item.id)

      // Build a ghost PlacedFurniture at origin
      const ghostPlaced: PlacedFurniture = {
        id: '__ghost__',
        room_id: room.id,
        furniture_item_id: item.id,
        selected_variant_id: variant.id,
        x_cm: 0, y_cm: 0, z_cm: 0,
        rotation_deg: 0,
        price_at_placement: variant.price_thb,
        scale_factor: 1,
        sort_order: 0,
        created_at: '',
      }
      const { group, loader } = createFurnitureGroup({ placed: ghostPlaced, variant, item, isFlat })
      // Make it translucent
      loader().then(() => {
        group.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            const mat = m.material as THREE.MeshStandardMaterial
            if ('transparent' in mat) {
              mat.transparent = true
              mat.opacity = 0.5
              mat.depthWrite = false
              mat.needsUpdate = true
            }
          }
        })
      })
      group.name = 'placement-ghost'
      layer.add(group)
      ghostGroupRef.current = group
    }
  }, [room.id])

  // ── Fixture placement ghost ─────────────────────────────────────────────────
  // Shows a translucent panel on the nearest wall while the user is placing a
  // door or window. Size comes from the selected variant's dimensions.
  useEffect(() => {
    const sync = () => {
      const scene = sceneRef.current
      if (!scene) return

      // Clear existing fixture ghost
      if (fixtureGhostRef.current) {
        scene.remove(fixtureGhostRef.current)
        fixtureGhostRef.current.geometry?.dispose()
        const m = fixtureGhostRef.current.material
        if (Array.isArray(m)) { for (const x of m) x.dispose() }
        else if (m) (m as THREE.Material).dispose()
        fixtureGhostRef.current = null
      }

      const s = useCanvasStore.getState()
      if (!s.fixturePlacementType) return

      // Fixture size from variant (fall back to sensible defaults)
      const { widthM, heightM } = getFixtureDims(
        s.fixturePlacementItemId,
        s.fixturePlacementVariantId,
        s.fixturePlacementType,
      )

      const geo = new THREE.PlaneGeometry(widthM, heightM)
      const color = s.fixturePlacementType === 'door' ? 0x8B5A3C : 0x6AA9C8
      const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const ghost = new THREE.Mesh(geo, mat)
      ghost.name = 'fixture-ghost'
      ghost.visible = false
      scene.add(ghost)
      fixtureGhostRef.current = ghost
    }

    sync()
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (
        state.fixturePlacementType === prev.fixturePlacementType &&
        state.fixturePlacementVariantId === prev.fixturePlacementVariantId &&
        state.fixturePlacementItemId === prev.fixturePlacementItemId
      ) return
      sync()
    })
    return unsub
  }, [room.id])

  // ── Edit-shape handles (vertices + midpoints) ──────────────────────────────
  // Rendered only when useCanvasStore.shapeEditMode is on. Handles sit just
  // above the floor and are raycastable so pointer events can grab them.
  useEffect(() => {
    const rebuild = () => {
      const layer = handleLayerRef.current
      if (!layer) return

      // Clear existing handles
      for (const child of [...layer.children]) {
        layer.remove(child)
        const m = child as THREE.Mesh
        if (m.isMesh) {
          m.geometry?.dispose()
          const mat = m.material
          if (Array.isArray(mat)) { for (const x of mat) x.dispose() }
          else if (mat) mat.dispose()
        }
      }

      const editing = useCanvasStore.getState().shapeEditMode
      if (!editing) return

      const vertices = getVertices(room)
      const selectedIdx = useCanvasStore.getState().selectedVertexIndex

      // Vertex handles — teal spheres
      for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i]
        const isSelected = selectedIdx === i
        const geo = new THREE.SphereGeometry(isSelected ? 0.09 : 0.07, 16, 12)
        const mat = new THREE.MeshBasicMaterial({
          color: isSelected ? 0xE8614A : 0x2BA8A0,
          depthTest: false,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(v.u, 0.02, v.v)
        mesh.renderOrder = 20
        mesh.userData.kind = 'vertex'
        mesh.userData.vertexIndex = i
        layer.add(mesh)
      }

      // Midpoint handles — hollow rings
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i]
        const b = vertices[(i + 1) % vertices.length]
        const mx = (a.u + b.u) / 2
        const mz = (a.v + b.v) / 2
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.045, 0.07, 24),
          new THREE.MeshBasicMaterial({
            color: 0x2BA8A0,
            transparent: true,
            opacity: 0.5,
            depthTest: false,
            side: THREE.DoubleSide,
          })
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.set(mx, 0.015, mz)
        ring.renderOrder = 20
        ring.userData.kind = 'midpoint'
        ring.userData.wallIndex = i
        layer.add(ring)
      }
    }

    rebuild()
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (
        state.shapeEditMode === prev.shapeEditMode &&
        state.selectedVertexIndex === prev.selectedVertexIndex
      ) return
      rebuild()
    })
    return unsub
  }, [room])

  /**
   * Raycast against the handle layer. Returns the first hit descriptor:
   *   { kind: 'vertex', vertexIndex } | { kind: 'midpoint', wallIndex }
   */
  const raycastHandle = useCallback((clientX: number, clientY: number):
    | { kind: 'vertex'; vertexIndex: number }
    | { kind: 'midpoint'; wallIndex: number }
    | null => {
    const container = containerRef.current
    const camera = cameraRef.current
    const layer = handleLayerRef.current
    if (!container || !camera || !layer || layer.children.length === 0) return null
    const rect = container.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const hits = raycaster.intersectObjects(layer.children, false)
    if (hits.length === 0) return null
    const ud = hits[0].object.userData
    if (ud.kind === 'vertex' && typeof ud.vertexIndex === 'number') {
      return { kind: 'vertex', vertexIndex: ud.vertexIndex }
    }
    if (ud.kind === 'midpoint' && typeof ud.wallIndex === 'number') {
      return { kind: 'midpoint', wallIndex: ud.wallIndex }
    }
    return null
  }, [])

  // ── Camera mode switch (design ↔ roam) ─────────────────────────────────────
  useEffect(() => {
    const apply = () => {
      const mode = useUIStore.getState().cameraMode
      const orbit = controlsRef.current
      const roam = roamControlsRef.current
      const camera = cameraRef.current
      if (!orbit || !roam || !camera) return

      if (mode === 'roam') {
        orbit.enabled = false
        // Position camera at room centroid at eye height, looking toward
        // whatever the orbit camera was pointed at.
        const verts = getVertices(room)
        const centroid = polygonCentroid(verts)
        camera.position.set(centroid.u, 1.6, centroid.v)
        // Preserve rough heading from orbit target
        const target = orbit.target.clone()
        target.y = 1.6
        camera.lookAt(target)
      } else {
        // Exiting roam — unlock pointer if needed, re-enable orbit
        if (roam.isLocked) roam.unlock()
        orbit.enabled = true
      }
    }

    apply()
    const unsub = useUIStore.subscribe((state, prev) => {
      if (state.cameraMode === prev.cameraMode) return
      apply()
    })
    // When user manually unlocks (Esc via browser), fall back to design mode
    const onUnlock = () => {
      if (useUIStore.getState().cameraMode === 'roam') {
        useUIStore.getState().setCameraMode('design')
      }
    }
    roamControlsRef.current?.addEventListener('unlock', onUnlock)

    return () => {
      unsub()
      roamControlsRef.current?.removeEventListener('unlock', onUnlock)
    }
  }, [room])

  /**
   * Raycast against shell-layer walls. Walls are tagged with
   * `userData.kind = 'wall'` + `userData.wallIndex` by `buildRoomShell`.
   * Returns the wall index hit, or null.
   */
  const raycastWall = useCallback((clientX: number, clientY: number): number | null => {
    const container = containerRef.current
    const camera = cameraRef.current
    const shell = shellGroupRef.current
    if (!container || !camera || !shell) return null
    const rect = container.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const hits = raycaster.intersectObjects(shell.children, true)
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        if (o.userData?.kind === 'wall' && typeof o.userData.wallIndex === 'number') {
          return o.userData.wallIndex
        }
        o = o.parent
      }
    }
    return null
  }, [])

  // ── Pointer + keyboard handlers ────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Drag prevents OrbitControls
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return // left click only

      const s = useCanvasStore.getState()

      // Shape edit mode: handle vertex drag / midpoint insert / wall push-pull.
      if (s.shapeEditMode) {
        const hit = raycastHandle(e.clientX, e.clientY)
        if (hit?.kind === 'vertex') {
          s.setSelectedVertex(hit.vertexIndex)
          vertexDragRef.current = {
            vertexIndex: hit.vertexIndex,
            prevGeometry: JSON.parse(JSON.stringify(room.geometry)),
            prevWidthCm: room.width_cm,
            prevHeightCm: room.height_cm,
          }
          if (controlsRef.current) controlsRef.current.enabled = false
          container.setPointerCapture(e.pointerId)
          return
        }
        if (hit?.kind === 'midpoint') {
          insertVertexAtMidpoint(room, hit.wallIndex)
          return
        }

        // No handle hit → maybe a wall?
        const wallIdx = raycastWall(e.clientX, e.clientY)
        if (wallIdx != null) {
          const cursor = raycastFloor(e.clientX, e.clientY)
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
          if (controlsRef.current) controlsRef.current.enabled = false
          container.setPointerCapture(e.pointerId)
          return
        }

        // Empty click while editing → deselect vertex
        s.setSelectedVertex(null)
        return
      }

      // Fixture placement (door / window): click on wall commits the fixture.
      if (s.fixturePlacementType) {
        const hit = raycastFloor(e.clientX, e.clientY)
        if (!hit) return
        const vertices = getVertices(room)
        const snap = nearestWallSnap(hit.x, hit.z, vertices)
        if (snap.length < 0.01) return
        commitFixturePlacement(
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
        const hit = raycastFloor(e.clientX, e.clientY)
        if (!hit) return
        const step = getGridStepCm(s.placementItemId)
        const snap = !e.ctrlKey && !e.metaKey
        const xCm = snapCm(hit.x * 100, step, !snap)
        const zCm = snapCm(hit.z * 100, step, !snap)
        // Clamp to polygon
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

      // Fixture move: first click on a door/window picks it up (fixtureMoveRef
      // set + fixture follows the cursor in pointermove). Next click commits.
      // Escape restores the pre-pickup geometry.
      const fm = fixtureMoveRef.current
      if (fm) {
        // Second click — commit wherever the fixture currently is.
        commitShapeEdit(fm.prevGeometry, fm.prevWidthCm, fm.prevHeightCm)
        fixtureMoveRef.current = null
        return
      }
      const fixHit = raycastFixture(e.clientX, e.clientY)
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
      const hitId = raycastFurniture(e.clientX, e.clientY)
      if (hitId) {
        useCanvasStore.getState().setSelectedItem(hitId)

        // Start drag
        const placed = useCanvasStore.getState().placedFurniture.find((p) => p.id === hitId)
        if (!placed) return
        const floorHit = raycastFloor(e.clientX, e.clientY)
        if (!floorHit) return
        dragStateRef.current = {
          placedId: hitId,
          prevX: placed.x_cm,
          prevZ: placed.z_cm,
          offsetX: placed.x_cm / 100 - floorHit.x,
          offsetZ: placed.z_cm / 100 - floorHit.z,
        }
        // Pause orbit controls during drag
        if (controlsRef.current) controlsRef.current.enabled = false
        container.setPointerCapture(e.pointerId)
      } else {
        // Clicked empty space → deselect
        useCanvasStore.getState().setSelectedItem(null)
        useCanvasStore.getState().setSelectedFixture(null)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      // Vertex drag (shape edit mode)
      const vd = vertexDragRef.current
      if (vd) {
        const hit = raycastFloor(e.clientX, e.clientY)
        if (!hit) return
        const bypass = e.ctrlKey || e.metaKey
        const stepM = 0.10 // 10cm grid
        const snapU = bypass ? hit.x : Math.round(hit.x / stepM) * stepM
        const snapV = bypass ? hit.z : Math.round(hit.z / stepM) * stepM
        updateVertexLocal(vd.vertexIndex, snapU, snapV)
        return
      }

      // Fixture move (door / window follows cursor until next click commits).
      // Skip when any button is held — that's an orbit drag, not a follow.
      const fm = fixtureMoveRef.current
      if (fm && e.buttons === 0) {
        const hit = raycastFloor(e.clientX, e.clientY)
        if (!hit) return
        const projStore = useProjectStore
        const room0 = projStore.getState().rooms.find((r) => r.id === room.id)
        if (!room0) return
        const verts = getVertices(room0)
        const snap = nearestWallSnap(hit.x, hit.z, verts)
        if (snap.length < 0.01) return

        const geo = room0.geometry as import('@/types').RoomGeometry
        const existing = fm.fixtureType === 'door'
          ? (geo.doors ?? []).find((d) => d.id === fm.fixtureId)
          : (geo.windows ?? []).find((w) => w.id === fm.fixtureId)
        if (!existing) return
        const fixtureW = existing.width_m ?? (fm.fixtureType === 'door' ? 0.8 : 1.0)

        // Clamp position so the fixture fits on the picked wall.
        const halfW = Math.min(fixtureW / 2, snap.length * 0.45)
        const clamped = Math.max(
          halfW / snap.length,
          Math.min(1 - halfW / snap.length, snap.position),
        )

        const nextGeo: import('@/types').RoomGeometry = fm.fixtureType === 'door'
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
        const hit = raycastFloor(e.clientX, e.clientY)
        if (!hit) return
        const midU = (wd.origA.u + wd.origB.u) / 2
        const midV = (wd.origA.v + wd.origB.v) / 2
        const currentProj = (hit.x - midU) * wd.normalU + (hit.z - midV) * wd.normalV
        const rawDelta = currentProj - wd.startProj
        const bypass = e.ctrlKey || e.metaKey
        const stepM = 0.10
        const delta = bypass ? rawDelta : Math.round(rawDelta / stepM) * stepM

        applyWallPush(delta)
        return
      }

      // Placement ghost follow
      const s = useCanvasStore.getState()
      if (s.placementMode && ghostGroupRef.current) {
        const hit = raycastFloor(e.clientX, e.clientY)
        if (hit && s.placementItemId) {
          const step = getGridStepCm(s.placementItemId)
          const snap = !e.ctrlKey && !e.metaKey
          const xCm = snapCm(hit.x * 100, step, !snap)
          const zCm = snapCm(hit.z * 100, step, !snap)
          ghostGroupRef.current.position.set(xCm / 100, 0, zCm / 100)
        }
      }

      // Fixture ghost follow — snap to nearest wall, rotate to match wall angle
      if (s.fixturePlacementType && fixtureGhostRef.current) {
        const hit = raycastFloor(e.clientX, e.clientY)
        if (hit) {
          const vertices = getVertices(room)
          const snap = nearestWallSnap(hit.x, hit.z, vertices)
          const { widthM, heightM } = getFixtureDims(
            s.fixturePlacementItemId,
            s.fixturePlacementVariantId,
            s.fixturePlacementType,
          )
          // Clamp position so the fixture fits on the wall
          const halfW = widthM / 2
          const clampedPos = Math.max(
            halfW / snap.length,
            Math.min(1 - halfW / snap.length, snap.position),
          )
          const a = vertices[snap.wallIndex]
          const b = vertices[(snap.wallIndex + 1) % vertices.length]
          const cu = a.u + clampedPos * (b.u - a.u)
          const cv = a.v + clampedPos * (b.v - a.v)
          const ghost = fixtureGhostRef.current
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

      // Drag update
      const drag = dragStateRef.current
      if (drag) {
        const hit = raycastFloor(e.clientX, e.clientY)
        if (!hit) return
        const step = getGridStepCm(
          useCanvasStore.getState().placedFurniture.find((p) => p.id === drag.placedId)?.furniture_item_id ?? ''
        )
        const bypass = e.ctrlKey || e.metaKey
        const targetU = hit.x + drag.offsetX
        const targetV = hit.z + drag.offsetZ
        const xCm = snapCm(targetU * 100, step, bypass)
        const zCm = snapCm(targetV * 100, step, bypass)
        // Clamp to polygon
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
        if (controlsRef.current) controlsRef.current.enabled = true
        container.releasePointerCapture(e.pointerId)
        useCanvasStore.getState().commitMove(drag.placedId, drag.prevX, drag.prevZ)
      }
      // Commit vertex drag: persist to DB + push undo command
      const vd = vertexDragRef.current
      if (vd) {
        vertexDragRef.current = null
        if (controlsRef.current) controlsRef.current.enabled = true
        container.releasePointerCapture(e.pointerId)
        commitShapeEdit(vd.prevGeometry, vd.prevWidthCm, vd.prevHeightCm)
      }

      // Commit wall drag
      const wd = wallDragRef.current
      if (wd) {
        wallDragRef.current = null
        if (controlsRef.current) controlsRef.current.enabled = true
        container.releasePointerCapture(e.pointerId)
        commitShapeEdit(wd.prevGeometry, wd.prevWidthCm, wd.prevHeightCm)
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
        // Commit previous if switching items
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

    let wheelCommitTimer = 0

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Roam mode WASD capture (runs first; if in roam, skip design-mode hotkeys)
      if (useUIStore.getState().cameraMode === 'roam') {
        if (e.key === 'w' || e.key === 'W') roamKeysRef.current.w = true
        else if (e.key === 's' || e.key === 'S') roamKeysRef.current.s = true
        else if (e.key === 'a' || e.key === 'A') roamKeysRef.current.a = true
        else if (e.key === 'd' || e.key === 'D') roamKeysRef.current.d = true
        else if (e.key === 'Shift') roamKeysRef.current.shift = true
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
          deleteSelectedVertex(s.selectedVertexIndex)
          return
        }
        if (s.selectedItemId) {
          e.preventDefault()
          void s.removeItem(s.selectedItemId)
        }
      }
    }

    // ── Edit-shape helpers (closures over `room`) ────────────────────────────

    /**
     * Live vertex update during drag. Uses `useProjectStore.setState` so we only
     * touch local state (no DB write on every pointermove). Also updates the
     * handle sphere position directly for instant visual feedback.
     */
    function updateVertexLocal(vertexIndex: number, newU: number, newV: number) {
      const projStore = useProjectStore
      const room0 = projStore.getState().rooms.find((r) => r.id === room.id)
      if (!room0) return
      const curVerts = getVertices(room0)
      if (vertexIndex < 0 || vertexIndex >= curVerts.length) return
      const newVerts = curVerts.map((v, i) => (i === vertexIndex ? { u: newU, v: newV } : v))

      // Recompute bounding box (width_cm, height_cm)
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
      for (const v of newVerts) {
        if (v.u < minU) minU = v.u; if (v.u > maxU) maxU = v.u
        if (v.v < minV) minV = v.v; if (v.v > maxV) maxV = v.v
      }
      const newGeo: import('@/types').RoomGeometry = { ...room0.geometry, vertices: newVerts }
      projStore.setState((state) => ({
        rooms: state.rooms.map((r) => r.id === room.id
          ? { ...r, geometry: newGeo, width_cm: Math.round((maxU - minU) * 100), height_cm: Math.round((maxV - minV) * 100) }
          : r
        ),
        isDirty: true,
      }))
    }

    /**
     * Writes a new door or window into `room.geometry.{doors|windows}[]` and
     * pushes a geometry undo command. Width/height come from the selected
     * variant's dimensions (falls back to sensible defaults for unnamed vars).
     */
    function commitFixturePlacement(
      type: 'door' | 'window',
      wallIndex: number,
      position: number,
      itemId: string | null,
      variantId: string | null,
    ) {
      const projStore = useProjectStore
      const room0 = projStore.getState().rooms.find((r) => r.id === room.id)
      if (!room0) return
      const prevGeo = JSON.parse(JSON.stringify(room0.geometry)) as import('@/types').RoomGeometry
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
      let nextGeo: import('@/types').RoomGeometry
      if (type === 'door') {
        const newDoor: import('@/types').RoomDoor = {
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
        const newWindow: import('@/types').RoomWindow = {
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

      void projStore.getState().updateRoom(room.id, { geometry: nextGeo })
      useCanvasStore.getState().pushGeometryCommand(
        room.id,
        prevGeo,
        JSON.parse(JSON.stringify(nextGeo)),
        room0.width_cm, room0.height_cm,
        room0.width_cm, room0.height_cm,
      )
      useCanvasStore.getState().setSelectedFixture(newId)
    }

    /**
     * Commit whatever the current local geometry is to the DB + push an undo
     * command with the given pre-drag snapshot. Used by both vertex drag and
     * wall push/pull — they differ only in what happens during pointermove.
     */
    function commitShapeEdit(
      prevGeo: import('@/types').RoomGeometry,
      prevW: number,
      prevH: number,
    ) {
      const projStore = useProjectStore
      const room0 = projStore.getState().rooms.find((r) => r.id === room.id)
      if (!room0) return
      void projStore.getState().updateRoom(room.id, {
        geometry: room0.geometry,
        width_cm: room0.width_cm,
        height_cm: room0.height_cm,
      })
      useCanvasStore.getState().pushGeometryCommand(
        room.id,
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
    function applyWallPush(delta: number) {
      const wd = wallDragRef.current
      if (!wd) return
      const prevVerts = wd.prevGeometry.vertices
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
      const newGeo: import('@/types').RoomGeometry = { ...wd.prevGeometry, vertices: out }
      useProjectStore.setState((state) => ({
        rooms: state.rooms.map((r) => r.id === room.id
          ? { ...r, geometry: newGeo, width_cm: Math.round((maxU - minU) * 100), height_cm: Math.round((maxV - minV) * 100) }
          : r
        ),
        isDirty: true,
      }))
    }

    /** Insert a new vertex at the midpoint of wall `wallIndex`. */
    function insertVertexAtMidpoint(r: Room, wallIndex: number) {
      const projStore = useProjectStore
      const room0 = projStore.getState().rooms.find((x) => x.id === r.id)
      if (!room0) return
      const curVerts = getVertices(room0)
      const a = curVerts[wallIndex]
      const b = curVerts[(wallIndex + 1) % curVerts.length]
      const mid = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 }
      const newVerts = [...curVerts]
      newVerts.splice(wallIndex + 1, 0, mid)
      const prevGeo = JSON.parse(JSON.stringify(room0.geometry)) as import('@/types').RoomGeometry
      const nextGeo: import('@/types').RoomGeometry = { ...room0.geometry, vertices: newVerts }
      void projStore.getState().updateRoom(r.id, { geometry: nextGeo })
      useCanvasStore.getState().pushGeometryCommand(
        r.id, prevGeo, JSON.parse(JSON.stringify(nextGeo)),
        room0.width_cm, room0.height_cm, room0.width_cm, room0.height_cm,
      )
      useCanvasStore.getState().setSelectedVertex(wallIndex + 1)
    }

    /** Delete a vertex (minimum 3 remaining). */
    function deleteSelectedVertex(vertexIndex: number) {
      const projStore = useProjectStore
      const room0 = projStore.getState().rooms.find((r) => r.id === room.id)
      if (!room0) return
      const curVerts = getVertices(room0)
      if (curVerts.length <= 3) return
      const newVerts = curVerts.filter((_, i) => i !== vertexIndex)
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
      for (const v of newVerts) {
        if (v.u < minU) minU = v.u; if (v.u > maxU) maxU = v.u
        if (v.v < minV) minV = v.v; if (v.v > maxV) maxV = v.v
      }
      const prevGeo = JSON.parse(JSON.stringify(room0.geometry)) as import('@/types').RoomGeometry
      const nextGeo: import('@/types').RoomGeometry = { ...room0.geometry, vertices: newVerts }
      const nextW = Math.round((maxU - minU) * 100)
      const nextH = Math.round((maxV - minV) * 100)
      void projStore.getState().updateRoom(room.id, { geometry: nextGeo, width_cm: nextW, height_cm: nextH })
      useCanvasStore.getState().pushGeometryCommand(
        room.id, prevGeo, JSON.parse(JSON.stringify(nextGeo)),
        room0.width_cm, room0.height_cm, nextW, nextH,
      )
      useCanvasStore.getState().setSelectedVertex(null)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W') roamKeysRef.current.w = false
      else if (e.key === 's' || e.key === 'S') roamKeysRef.current.s = false
      else if (e.key === 'a' || e.key === 'A') roamKeysRef.current.a = false
      else if (e.key === 'd' || e.key === 'D') roamKeysRef.current.d = false
      else if (e.key === 'Shift') roamKeysRef.current.shift = false
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
  }, [room, raycastFloor, raycastFurniture, raycastHandle, raycastWall, raycastFixture])

  // Cursor style hint based on placement mode
  const placementMode = useCanvasStore((s) => s.placementMode)
  const gridOn = useUIStore((s) => s.canvasGrid)
  const setCanvasGrid = useUIStore((s) => s.setCanvasGrid)
  const cameraMode = useUIStore((s) => s.cameraMode)
  const setCameraMode = useUIStore((s) => s.setCameraMode)

  const enterRoam = () => {
    setCameraMode('roam')
    // Lock on the next frame so the click event has finished propagating
    requestAnimationFrame(() => roamControlsRef.current?.lock())
  }

  return (
    <div
      ref={containerRef}
      className={`room-canvas ${placementMode ? 'placement-mode' : ''} ${cameraMode === 'roam' ? 'roam-mode' : ''}`}
    >
      {/* Edit-shape wall length labels (populated imperatively in the animate loop). */}
      <div ref={dimLabelsRef} className="wall-dim-labels-layer" />

      {/* Floating canvas controls */}
      <button
        type="button"
        className={`canvas-toggle-btn grid-toggle-btn ${gridOn ? 'active' : ''}`}
        onClick={() => setCanvasGrid(!gridOn)}
        title={gridOn ? t('editor.canvas.hideWorldGrid') : t('editor.canvas.showWorldGrid')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M0.5 4.5h13M0.5 9.5h13M4.5 0.5v13M9.5 0.5v13" />
        </svg>
        {t('editor.canvas.gridLabel')}
      </button>

      {/* Camera mode toggle */}
      <button
        type="button"
        className={`canvas-toggle-btn mode-toggle-btn ${cameraMode === 'roam' ? 'active' : ''}`}
        onClick={() => cameraMode === 'design' ? enterRoam() : setCameraMode('design')}
        title={cameraMode === 'roam' ? t('editor.canvas.backToDesign') : t('editor.canvas.enterRoam')}
      >
        {cameraMode === 'roam' ? `🎨 ${t('editor.canvas.cameraDesign')}` : `🚶 ${t('editor.canvas.cameraRoam')}`}
      </button>

      {/* Roam-mode hint — small banner shown while walking */}
      {cameraMode === 'roam' && (
        <div className="roam-hint">
          <strong>WASD</strong> {t('editor.canvas.roamHintMove')} · <strong>Shift</strong> {t('editor.canvas.roamHintSprint')} · <strong>Mouse</strong> {t('editor.canvas.roamHintLook')} · <strong>Esc</strong> {t('editor.canvas.roamHintExit')}
        </div>
      )}

      <style>{`
        .room-canvas {
          width: 100%;
          height: 100%;
          position: relative;
          overflow: hidden;
          background: var(--color-canvas-bg);
          touch-action: none;
        }
        .room-canvas.placement-mode {
          cursor: crosshair;
        }
        .room-canvas canvas {
          display: block;
        }
        .canvas-toggle-btn {
          position: absolute;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid var(--color-border-custom);
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(6px);
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all 0.15s;
          z-index: 5;
        }
        .canvas-toggle-btn:hover {
          color: var(--color-text-primary);
          border-color: var(--color-primary-brand);
        }
        .canvas-toggle-btn.active {
          background: var(--color-primary-brand);
          border-color: var(--color-primary-brand);
          color: white;
        }
        .grid-toggle-btn {
          bottom: 16px;
          left: 16px;
        }
        .mode-toggle-btn {
          top: 16px;
          right: 16px;
        }
        .room-canvas.roam-mode {
          cursor: none;
        }
        .roam-hint {
          position: absolute;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          padding: 8px 14px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          font-size: 11px;
          font-weight: 500;
          z-index: 6;
          letter-spacing: 0.2px;
          pointer-events: none;
        }
        .roam-hint strong {
          font-weight: 700;
          color: #7FE5DE;
        }
        .wall-dim-labels-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 4;
        }
        .wall-dim-label {
          position: absolute;
          left: 0;
          top: 0;
          padding: 3px 9px;
          border-radius: 999px;
          background: #FFFFFF;
          color: var(--color-primary-brand);
          border: 1.5px solid var(--color-primary-brand);
          font-size: 11px;
          font-weight: 700;
          font-family: inherit;
          letter-spacing: 0.2px;
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
          user-select: none;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  )
}
