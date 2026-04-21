import { useEffect } from 'react'
import * as THREE from 'three'
import { createFurnitureGroup } from '@/lib/roomScene'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useArtStore } from '@/stores/useArtStore'
import type { FurnitureItem, FurnitureVariant, PlacedFurniture } from '@/types'
import type { SceneContext } from '../types'

/**
 * Syncs placed furniture in the canvas store with the Three.js scene graph.
 *
 * Rebuild vs update is keyed by a compact signature string (variant id +
 * dimensions + flat flag + scale). If only position/rotation changed, the
 * existing group is mutated in place to avoid re-parsing the `.glb`.
 *
 * Subscribes directly to the canvas + catalog stores — no React state, no
 * re-renders of the host component.
 */
export function useFurnitureLayer(ctx: SceneContext): void {
  useEffect(() => {
    const unsubCanvas = useCanvasStore.subscribe((state, prev) => {
      if (state.placedFurniture === prev.placedFurniture) return
      syncFurniture()
    })
    const unsubCatalog = useCatalogStore.subscribe((state, prev) => {
      if (state.items === prev.items && state.variants === prev.variants && state.categories === prev.categories) return
      syncFurniture()
    })
    // Art swaps on placed frames need a rebuild so the overlay plane swaps
    // texture. Picture-frame items are rare in practice, so re-rendering
    // every other placed item on any art change is an acceptable cost.
    const unsubArt = useArtStore.subscribe((state, prev) => {
      if (state.art === prev.art) return
      syncFurniture()
    })
    // Lazy-load the art library once when the layer mounts so placed frames
    // can resolve their image URLs. Safe to call repeatedly.
    void useArtStore.getState().loadArt()
    syncFurniture()
    return () => {
      unsubCanvas()
      unsubCatalog()
      unsubArt()
    }

    function signature(
      pf: PlacedFurniture,
      variant: FurnitureVariant,
      item: FurnitureItem,
      isFlat: boolean,
      flatOrientation: 'horizontal' | 'vertical',
      artUrl: string | null,
      emitsLight: boolean,
      mountType: string,
    ): string {
      const w = variant.width_cm ?? item.width_cm ?? 50
      const d = variant.depth_cm ?? item.depth_cm ?? 50
      const h = variant.height_cm ?? item.height_cm ?? 50
      const glb = isFlat ? `flat:${flatOrientation}` : variant.glb_path ?? 'placeholder'
      // Light-emitting items rebuild on any settings change. Cheap since the
      // fixture mesh is procedural + no .glb fetch. If slider-drag cost ever
      // bites, swap this for an in-place applyLightSettings on a refs map.
      const lightSig = emitsLight
        ? `light:${mountType}:${JSON.stringify(pf.light_settings ?? 'default')}`
        : 'no-light'
      return `${pf.selected_variant_id}|${w}|${d}|${h}|${glb}|${pf.scale_factor ?? 1}|${artUrl ?? 'no-art'}|${lightSig}`
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
      const layer = ctx.furnitureLayerRef.current
      if (!layer) return
      const catalog = useCatalogStore.getState()
      const canvas = useCanvasStore.getState()
      const existing = ctx.furnitureGroupsRef.current
      const signatures = ctx.furnitureSignaturesRef.current

      const art = useArtStore.getState()
      const seen = new Set<string>()
      for (const pf of canvas.placedFurniture) {
        seen.add(pf.id)
        const variants = catalog.variants[pf.furniture_item_id] ?? []
        const variant = variants.find((v) => v.id === pf.selected_variant_id)
        const item = catalog.items.find((i) => i.id === pf.furniture_item_id)
        if (!variant || !item) continue

        const isFlat = catalog.isItemFlat(item.id)
        const category = catalog.categories.find((c) => c.id === item.category_id)
        const flatOrientation = category?.flat_orientation ?? 'horizontal'
        const emitsLight = category?.emits_light ?? false
        const mountType = category?.mount_type ?? 'floor'
        const artRow = art.getArtById(pf.art_id)
        const artUrl = artRow ? art.getArtUrl(artRow) : null

        const sig = signature(pf, variant, item, isFlat, flatOrientation, artUrl, emitsLight, mountType)
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
        const { group, loader } = createFurnitureGroup({
          placed: pf,
          variant,
          item,
          isFlat,
          flatOrientation,
          artUrl,
          matOpeningCm: item.mat_opening_cm,
          emitsLight,
          mountType,
          lightSettings: pf.light_settings,
        })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
