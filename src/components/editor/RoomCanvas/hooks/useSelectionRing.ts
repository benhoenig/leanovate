import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useCanvasStore } from '@/stores/useCanvasStore'
import type { SceneContext } from '../types'

/**
 * Renders a teal selection ring under the currently-selected furniture
 * group, and keeps it anchored to the group every animation frame via a
 * cheap rAF tick (so it follows drag without subscribing to the canvas
 * store's position mutations).
 */
export function useSelectionRing(ctx: SceneContext): void {
  const selectionRingRef = useRef<THREE.Mesh | null>(null)

  // Rebuild the ring whenever selection changes.
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (state.selectedItemId === prev.selectedItemId) return
      updateSelectionRing()
    })
    updateSelectionRing()
    return unsub

    function updateSelectionRing() {
      const scene = ctx.sceneRef.current
      if (!scene) return
      const id = useCanvasStore.getState().selectedItemId

      if (selectionRingRef.current) {
        scene.remove(selectionRingRef.current)
        selectionRingRef.current.geometry.dispose()
        ;(selectionRingRef.current.material as THREE.Material).dispose()
        selectionRingRef.current = null
      }
      if (!id) return

      const group = ctx.furnitureGroupsRef.current.get(id)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track group movement so the ring follows a drag (group.position mutates
  // in place on pointermove — no store event). Cheap: O(1) per frame.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const id = useCanvasStore.getState().selectedItemId
      const ring = selectionRingRef.current
      if (id && ring) {
        const g = ctx.furnitureGroupsRef.current.get(id)
        if (g) ring.position.set(g.position.x, 0.005, g.position.z)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
