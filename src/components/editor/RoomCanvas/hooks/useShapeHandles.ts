import { useEffect } from 'react'
import * as THREE from 'three'
import { getVertices } from '@/lib/roomGeometry'
import { useCanvasStore } from '@/stores/useCanvasStore'
import type { Room } from '@/types'
import type { SceneContext } from '../types'

/**
 * Renders the Edit Shape mode handle overlay:
 *   - Teal spheres at polygon vertices (selectable, draggable)
 *   - Hollow teal rings at wall midpoints (click to insert a new vertex)
 *
 * Handles sit slightly above the floor with `depthTest: false` so they
 * render over the shell even when wall push/pull raises them. Subscribes
 * to `shapeEditMode` and `selectedVertexIndex` so the selected vertex
 * gets the accent colour / larger radius treatment.
 */
export function useShapeHandles(ctx: SceneContext, room: Room): void {
  useEffect(() => {
    const rebuild = () => {
      const layer = ctx.handleLayerRef.current
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

      // Vertex handles — teal spheres (accent colour when selected)
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

      // Midpoint handles — hollow rings (click to insert vertex)
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
          }),
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
  }, [ctx, room])
}
