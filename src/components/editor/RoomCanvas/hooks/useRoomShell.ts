import { useEffect } from 'react'
import { buildRoomShell, disposeSceneObjects } from '@/lib/roomScene'
import { getVertices, polygonCentroid } from '@/lib/roomGeometry'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useUIStore } from '@/stores/useUIStore'
import type { Room, FinishMaterial } from '@/types'
import type * as THREE from 'three'
import type { SceneContext } from '../types'

/**
 * Rebuilds the room shell (floor / walls with cutouts / ceiling / lights)
 * whenever geometry, finishes, camera mode, or any referenced fixture
 * variant's render state changes.
 *
 * Depends on a `fixtureVariantSignature` selector that watches the
 * catalog store for changes to any door/window variant referenced in the
 * room geometry — this is how a newly-completed TRELLIS `.glb` gets
 * pulled into the shell without a manual remount.
 *
 * Only frames the camera when switching to a *different* room (tracked via
 * `framedRoomIdRef`). Preserves pose during geometry edits so vertex drag
 * doesn't yank the camera.
 */
export function useRoomShell(
  ctx: SceneContext,
  room: Room,
  finishMaterials: FinishMaterial[],
): void {
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

  const { shellGroupRef, cameraRef, controlsRef, ceilingMeshRef, framedRoomIdRef } = ctx

  useEffect(() => {
    const shellGroup = shellGroupRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!shellGroup || !camera || !controls) return

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
      camera.position.set(
        centroid.u + camDist * 0.7,
        ceilingH * 1.6,
        centroid.v + camDist * 0.7,
      )
      controls.target.set(centroid.u, ceilingH * 0.4, centroid.v)
      controls.update()
      framedRoomIdRef.current = room.id
    }
  }, [shellGroupRef, cameraRef, controlsRef, ceilingMeshRef, framedRoomIdRef, room, finishMaterials, shellModeCameraMode, fixtureVariantSignature])
}
