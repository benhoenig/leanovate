import * as THREE from 'three'

/**
 * Pure raycasting helpers extracted from the RoomCanvas component.
 *
 * Each function accepts the container + camera + target Object3D explicitly
 * rather than reading from refs, so they can be unit-tested and reused
 * across interaction hooks without closure-capturing the whole scene.
 */

function ndcMouse(container: HTMLElement, clientX: number, clientY: number): THREE.Vector2 {
  const rect = container.getBoundingClientRect()
  return new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
}

/** Raycast against the infinite Y=0 plane (used for floor hit tests). */
export function raycastFloor(
  container: HTMLElement,
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
): { x: number; z: number } | null {
  const mouse = ndcMouse(container, clientX, clientY)
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(mouse, camera)
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hit = new THREE.Vector3()
  if (!raycaster.ray.intersectPlane(plane, hit)) return null
  return { x: hit.x, z: hit.z }
}

/**
 * Raycast against the furniture layer. Walks up the parent tree looking
 * for `userData.placedId` (stamped by createFurnitureGroup). Returns the
 * first hit's placedId, or null.
 */
export function raycastFurniture(
  container: HTMLElement,
  camera: THREE.Camera,
  layer: THREE.Object3D,
  clientX: number,
  clientY: number,
): string | null {
  const mouse = ndcMouse(container, clientX, clientY)
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
}

/**
 * Raycast against door / window meshes inside the shell. Walks up looking
 * for `userData.fixtureId` stamped by buildRoomShell.
 */
export function raycastFixture(
  container: HTMLElement,
  camera: THREE.Camera,
  shell: THREE.Object3D,
  clientX: number,
  clientY: number,
): { fixtureId: string; fixtureType: 'door' | 'window' } | null {
  const mouse = ndcMouse(container, clientX, clientY)
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
}

/**
 * Raycast against shell-layer walls. Walls are tagged with `userData.kind='wall'`
 * + `userData.wallIndex` by buildRoomShell.
 */
export function raycastWall(
  container: HTMLElement,
  camera: THREE.Camera,
  shell: THREE.Object3D,
  clientX: number,
  clientY: number,
): number | null {
  const mouse = ndcMouse(container, clientX, clientY)
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
}

/**
 * Raycast against the edit-shape handle layer. Returns the first hit
 * descriptor: vertex sphere or midpoint ring.
 */
export function raycastHandle(
  container: HTMLElement,
  camera: THREE.Camera,
  layer: THREE.Object3D,
  clientX: number,
  clientY: number,
):
  | { kind: 'vertex'; vertexIndex: number }
  | { kind: 'midpoint'; wallIndex: number }
  | null {
  if (layer.children.length === 0) return null
  const mouse = ndcMouse(container, clientX, clientY)
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
}
