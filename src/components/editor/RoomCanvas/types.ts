import type { RefObject } from 'react'
import type * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'

/**
 * Shared scene context returned by `useThreeScene` and consumed by every
 * downstream hook. Holds the stable Three.js objects (renderer, camera,
 * persistent layer groups) plus a few mutable refs that multiple hooks
 * read/write (ceiling mesh, furniture group map, roam-mode keys).
 *
 * All refs are React refs so the mount/cleanup lifecycle stays inside
 * `useThreeScene` — downstream hooks just observe.
 */
export interface SceneContext {
  containerRef: RefObject<HTMLDivElement | null>
  rendererRef: RefObject<THREE.WebGLRenderer | null>
  sceneRef: RefObject<THREE.Scene | null>
  cameraRef: RefObject<THREE.PerspectiveCamera | null>
  controlsRef: RefObject<OrbitControls | null>
  roamControlsRef: RefObject<PointerLockControls | null>

  /** Shell group — rebuilt when geometry/finishes change. Floor+walls+ceiling+lights. */
  shellGroupRef: RefObject<THREE.Group | null>
  /** Persistent across shell rebuilds. */
  furnitureLayerRef: RefObject<THREE.Group | null>
  /** Persistent across shell rebuilds. Holds vertex + midpoint drag handles. */
  handleLayerRef: RefObject<THREE.Group | null>
  /** Persistent world-grid reference. */
  gridGroupRef: RefObject<THREE.Group | null>

  /**
   * Ceiling mesh ref. The shell writes it on rebuild, the animate loop reads
   * it each frame to toggle visibility when the design-mode camera dips
   * below ceiling height.
   */
  ceilingMeshRef: RefObject<THREE.Mesh | null>

  /** Map<placedId, group> — read by the selection ring to follow drag. */
  furnitureGroupsRef: RefObject<Map<string, THREE.Group>>

  /** Map<placedId, signature> — rebuild the group when the signature changes. */
  furnitureSignaturesRef: RefObject<Map<string, string>>

  /** Room ID the camera was last framed for — avoid re-framing on every geometry tweak. */
  framedRoomIdRef: RefObject<string | null>

  /** Container for per-wall cm length labels shown in Edit Shape mode. */
  dimLabelsRef: RefObject<HTMLDivElement | null>

  /** Per-frame keyboard state for WASD roam movement. */
  roamKeysRef: RefObject<{ w: boolean; a: boolean; s: boolean; d: boolean; shift: boolean }>
}
