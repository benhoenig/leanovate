import type { FurnitureItem, FurnitureVariant, RenderApprovalStatus, RenderStatus } from '@/types'
import { rawUpdate } from '@/lib/supabase'
import type { RenderSlice, CatalogSliceCreator } from './types'
import { mapVariant } from './helpers'
import { runRenderPipeline, runThumbnailBackfill } from './pipeline'

export const createRenderSlice: CatalogSliceCreator<RenderSlice> = (set, get) => ({
  approveRender: async (variantId) => {
    const { error } = await rawUpdate('furniture_variants', variantId, {
      render_approval_status: 'approved',
    })
    if (error) return { error }
    set((state) => ({ variants: mapVariant(state.variants, variantId, { render_approval_status: 'approved' as RenderApprovalStatus }) }))

    // Fire-and-forget: render the Sims-style catalog tile thumbnail from the
    // .glb and cache it. Never block the approve action on this — a failed
    // snapshot just falls back to the original product photo in the tile.
    runThumbnailBackfill(variantId).catch((err) =>
      console.warn('[approveRender] thumbnail backfill failed:', err)
    )

    return { error: null }
  },

  rejectRender: async (variantId) => {
    const { error } = await rawUpdate('furniture_variants', variantId, {
      render_approval_status: 'rejected',
    })
    if (error) return { error }
    set((state) => ({ variants: mapVariant(state.variants, variantId, { render_approval_status: 'rejected' as RenderApprovalStatus }) }))
    return { error: null }
  },

  retryRender: async (variantId) => {
    // Architectural fixtures (doors/windows) skip TRELLIS entirely — if a
    // designer somehow lands on retryRender for one (e.g. a legacy row
    // still visible in the approval queue), short-circuit to the bypass
    // state instead of re-running the pipeline.
    const state = get()
    let parentItemId: string | null = null
    for (const [itemId, list] of Object.entries(state.variants)) {
      if (list.some((v) => v.id === variantId)) {
        parentItemId = itemId
        break
      }
    }
    const architectural = parentItemId
      ? state.isItemArchitectural(parentItemId)
      : false

    if (architectural) {
      const { error } = await rawUpdate('furniture_variants', variantId, {
        render_approval_status: 'approved',
        render_status: 'completed',
        glb_path: null,
      })
      if (error) return { error }
      set((s) => ({
        variants: mapVariant(s.variants, variantId, {
          render_approval_status: 'approved' as RenderApprovalStatus,
          render_status: 'completed' as RenderStatus,
          glb_path: null,
        }),
      }))
      return { error: null }
    }

    // Reset approval + render status, then re-run pipeline
    const { error } = await rawUpdate('furniture_variants', variantId, {
      render_approval_status: 'pending',
      render_status: 'waiting',
      glb_path: null,
    })
    if (error) return { error }
    set((s) => ({
      variants: mapVariant(s.variants, variantId, {
        render_approval_status: 'pending' as RenderApprovalStatus,
        render_status: 'waiting' as RenderStatus,
        glb_path: null,
      }),
    }))
    runRenderPipeline(variantId).catch((err) => console.warn('[retryRender]', err))
    return { error: null }
  },

  ensureVariantThumbnail: async (variantId) => {
    await runThumbnailBackfill(variantId)
  },

  getPendingRenderApprovalVariants: () => {
    const { items, variants } = get()
    const result: Array<{ item: FurnitureItem; variant: FurnitureVariant }> = []
    for (const item of items) {
      for (const variant of variants[item.id] ?? []) {
        if (variant.render_approval_status === 'pending' && variant.glb_path) {
          result.push({ item, variant })
        }
      }
    }
    return result
  },
})
