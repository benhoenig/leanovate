import { useEffect } from 'react'
import { getVertices, polygonCentroid } from '@/lib/roomGeometry'
import { useUIStore } from '@/stores/useUIStore'
import type { Room } from '@/types'
import type { SceneContext } from '../types'

/**
 * Switches between design (OrbitControls) and roam (PointerLockControls +
 * WASD) camera modes in response to `useUIStore.cameraMode` changes.
 *
 * Entering roam: orbit disabled, camera teleported to room centroid at eye
 * height, heading preserved from the orbit target.
 *
 * Exiting roam: unlocks pointer if locked, re-enables orbit.
 *
 * Also listens for browser-initiated pointer unlock (Esc via chrome) and
 * falls the UI back to design mode so the two never disagree.
 */
export function useCameraMode(ctx: SceneContext, room: Room): void {
  const { controlsRef, roamControlsRef, cameraRef } = ctx

  useEffect(() => {
    const apply = () => {
      const mode = useUIStore.getState().cameraMode
      const orbit = controlsRef.current
      const roam = roamControlsRef.current
      const camera = cameraRef.current
      if (!orbit || !roam || !camera) return

      if (mode === 'roam') {
        orbit.enabled = false
        const verts = getVertices(room)
        const centroid = polygonCentroid(verts)
        camera.position.set(centroid.u, 1.6, centroid.v)
        const target = orbit.target.clone()
        target.y = 1.6
        camera.lookAt(target)
      } else {
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
    const roam = roamControlsRef.current
    roam?.addEventListener('unlock', onUnlock)

    return () => {
      unsub()
      roam?.removeEventListener('unlock', onUnlock)
    }
  }, [controlsRef, roamControlsRef, cameraRef, room])
}
