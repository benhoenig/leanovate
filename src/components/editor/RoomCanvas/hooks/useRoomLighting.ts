import { useEffect, useRef } from 'react'
import {
  addStudioLights,
  addCeilingFixture,
  applyCeilingFixtureSettings,
  rebuildFixtureMesh,
  setStudioLightsEnabled,
  resolveLightingSettings,
  type StudioLightingRefs,
  type CeilingFixtureRefs,
} from '@/lib/roomScene'
import { getVertices, polygonCentroid } from '@/lib/roomGeometry'
import { useUIStore } from '@/stores/useUIStore'
import type { Room, FinishMaterial } from '@/types'
import type { SceneContext } from '../types'

/**
 * Builds and drives the room's lighting. Lives in a *persistent* group so
 * slider changes mutate refs in place — never triggering a shell rebuild.
 *
 * Three effects, narrowest first:
 *   1. Rebuild lights on room switch / geometry / ceiling change (coarse).
 *   2. Mutate fixture on settings change (material_id / temp / intensity / enabled).
 *   3. Toggle studio rig on UI-store flag change.
 */
export function useRoomLighting(
  ctx: SceneContext,
  room: Room,
  finishMaterials: FinishMaterial[],
): void {
  const { lightingGroupRef } = ctx
  const studioRefs = useRef<StudioLightingRefs | null>(null)
  const fixtureRefs = useRef<CeilingFixtureRefs | null>(null)
  const lastMaterialId = useRef<string | null>(null)

  const studioOn = useUIStore((s) => s.studioLights)
  const settings = resolveLightingSettings(room.finishes?.lighting)

  // (Re)build on room switch or geometry change. Clears the lighting group,
  // then creates fresh studio + fixture refs positioned for the new room.
  const vertices = getVertices(room)
  const centroid = polygonCentroid(vertices)
  const geomSig = `${centroid.u.toFixed(2)},${centroid.v.toFixed(2)}:${room.ceiling_height_cm ?? 260}`

  useEffect(() => {
    const group = lightingGroupRef.current
    if (!group) return

    for (const child of [...group.children]) group.remove(child)

    studioRefs.current = addStudioLights(group, room)
    fixtureRefs.current = addCeilingFixture(group, room, settings, finishMaterials)
    setStudioLightsEnabled(studioRefs.current, studioOn)
    lastMaterialId.current = settings.material_id
    // settings + studioOn + finishMaterials intentionally excluded — the next
    // two effects handle mutations in place. Including them here would cause
    // a full rebuild on every slider tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightingGroupRef, room.id, geomSig])

  // Mutate fixture on settings change (fast path — runs on every slider tick).
  useEffect(() => {
    const fx = fixtureRefs.current
    if (!fx) return
    if (settings.material_id !== lastMaterialId.current) {
      rebuildFixtureMesh(fx, settings.material_id, finishMaterials)
      lastMaterialId.current = settings.material_id
    }
    applyCeilingFixtureSettings(fx, settings)
    // `settings` is a fresh object every render (from resolveLightingSettings).
    // Listing its primitive fields keeps the effect from firing each render,
    // which would defeat the "don't rebuild on unrelated re-renders" goal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.material_id, settings.enabled, settings.temperature_k, settings.intensity, finishMaterials])

  // Studio toggle.
  useEffect(() => {
    const s = studioRefs.current
    if (!s) return
    setStudioLightsEnabled(s, studioOn)
  }, [studioOn])
}
