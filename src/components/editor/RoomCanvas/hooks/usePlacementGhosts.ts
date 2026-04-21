import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createFurnitureGroup } from '@/lib/roomScene'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import type { PlacedFurniture } from '@/types'
import type { SceneContext } from '../types'
import { getFixtureDims } from '../lib/gridSnap'

/**
 * Manages the two placement preview ghosts:
 *   1. Furniture ghost — translucent `.glb` clone that follows the cursor
 *      while the catalog store is in placement mode.
 *   2. Fixture ghost — translucent panel snapped to the nearest wall while
 *      placing a door or window.
 *
 * Returns the ghost refs so pointer hooks can mutate their positions each
 * frame on pointermove (avoids a second store subscription per move).
 */
export function usePlacementGhosts(
  ctx: SceneContext,
  roomId: string,
): {
  ghostGroupRef: React.RefObject<THREE.Group | null>
  fixtureGhostRef: React.RefObject<THREE.Mesh | null>
} {
  const ghostGroupRef = useRef<THREE.Group | null>(null)
  const fixtureGhostRef = useRef<THREE.Mesh | null>(null)

  // ── Furniture ghost ────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (state.placementMode === prev.placementMode && state.placementVariantId === prev.placementVariantId) return
      syncGhost()
    })
    return unsub

    function syncGhost() {
      const layer = ctx.furnitureLayerRef.current
      if (!layer) return
      const s = useCanvasStore.getState()

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
        room_id: roomId,
        furniture_item_id: item.id,
        selected_variant_id: variant.id,
        x_cm: 0, y_cm: 0, z_cm: 0,
        rotation_deg: 0,
        price_at_placement: variant.price_thb,
        scale_factor: 1,
        sort_order: 0,
        art_id: null,
        light_settings: null,
        created_at: '',
      }
      const category = catalog.categories.find((c) => c.id === item.category_id)
      const { group, loader } = createFurnitureGroup({
        placed: ghostPlaced,
        variant,
        item,
        isFlat,
        flatOrientation: category?.flat_orientation ?? 'horizontal',
        artUrl: null,
        matOpeningCm: item.mat_opening_cm,
        emitsLight: category?.emits_light ?? false,
        mountType: category?.mount_type ?? 'floor',
        lightSettings: null,  // ghost uses default light settings
      })
      // Make it translucent once the async loader resolves
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // ── Fixture ghost ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sync = () => {
      const scene = ctx.sceneRef.current
      if (!scene) return

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  return { ghostGroupRef, fixtureGhostRef }
}
