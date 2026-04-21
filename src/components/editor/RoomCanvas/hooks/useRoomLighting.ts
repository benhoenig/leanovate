import { useEffect, useRef } from 'react'
import {
  addStudioLights,
  setStudioLightsEnabled,
  type StudioLightingRefs,
} from '@/lib/roomScene'
import { getVertices, polygonCentroid } from '@/lib/roomGeometry'
import { useUIStore } from '@/stores/useUIStore'
import type { Room } from '@/types'
import type { SceneContext } from '../types'

/**
 * Studio fill-light rig only. Per-room.
 *
 * Ceiling downlights + lamps live on placed furniture now — each placed item
 * whose category `emits_light=true` gets its own SpotLight/PointLight attached
 * in `useFurnitureLayer`. This hook just keeps the dollhouse-clarity rig
 * (ambient + sun + fill) in sync with the studio toggle.
 */
export function useRoomLighting(ctx: SceneContext, room: Room): void {
  const { lightingGroupRef } = ctx
  const studioRefs = useRef<StudioLightingRefs | null>(null)

  const studioOn = useUIStore((s) => s.studioLights)

  // Rebuild on room switch or geometry change (studio rig is positioned
  // relative to the room's centroid + ceiling height).
  const vertices = getVertices(room)
  const centroid = polygonCentroid(vertices)
  const geomSig = `${centroid.u.toFixed(2)},${centroid.v.toFixed(2)}:${room.ceiling_height_cm ?? 260}`

  useEffect(() => {
    const group = lightingGroupRef.current
    if (!group) return

    for (const child of [...group.children]) group.remove(child)
    studioRefs.current = addStudioLights(group, room)
    setStudioLightsEnabled(studioRefs.current, studioOn)
    // studioOn handled by its own effect below — including here would cause
    // unnecessary rebuilds on toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightingGroupRef, room.id, geomSig])

  useEffect(() => {
    const s = studioRefs.current
    if (!s) return
    setStudioLightsEnabled(s, studioOn)
  }, [studioOn])
}
