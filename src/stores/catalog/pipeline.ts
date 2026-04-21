import type { FurnitureVariant, RenderStatus } from '@/types'
import { SUPABASE_URL, SUPABASE_ANON_KEY, getAuthToken, rawUpdate } from '@/lib/supabase'
import { renderVariantThumbnail } from '@/lib/renderVariantThumbnail'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { mapVariant } from './helpers'

// ── Raw fetch helper for edge functions ─────────────────────────────────────
// Bypasses the Supabase JS client to avoid concurrency hangs (see CLAUDE.md #8)

export function invokeEdgeFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<{ error: string | null; data?: Record<string, unknown> }> {
  const token = getAuthToken()
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        const text = await resp.text()
        console.error(`[invokeEdgeFunction] ${name} failed:`, resp.status, text)
        return { error: text || `HTTP ${resp.status}` }
      }
      try {
        const data = await resp.json()
        return { error: null, data }
      } catch {
        return { error: null }
      }
    })
    .catch((err) => {
      console.error(`[invokeEdgeFunction] ${name} network error:`, err)
      return { error: String(err) }
    })
}

/**
 * Drives the post-variant-creation pipeline for non-flat items:
 *   1. Set render_status = 'processing' locally
 *   2. Invoke generate-3d-model (TRELLIS)
 *   3. Render 4 isometric sprites client-side
 *   4. Set render_status = 'completed' | 'failed'
 *
 * render_approval_status stays 'pending' regardless — designer decides.
 * DB writes happen inside the edge function; this function only mirrors
 * render_status locally.
 *
 * Phase 8 update: sprite rendering removed. The .glb is the canvas asset
 * directly (rendered in Three.js), so render_status flips to 'completed'
 * as soon as TRELLIS returns a valid glb_path.
 */
export async function runRenderPipeline(variantId: string): Promise<void> {
  const patch = (updates: Partial<FurnitureVariant>) =>
    useCatalogStore.setState((state) => ({
      variants: mapVariant(state.variants, variantId, updates),
    }))

  patch({ render_status: 'processing' as RenderStatus })

  const result = await invokeEdgeFunction('generate-3d-model', { variant_id: variantId })
  if (result.error) {
    patch({ render_status: 'failed' as RenderStatus })
    return
  }

  const glbPath = result.data?.glb_path as string | undefined
  if (!glbPath) {
    patch({ render_status: 'failed' as RenderStatus })
    return
  }

  patch({ glb_path: glbPath, render_status: 'completed' as RenderStatus })

  // Kick off the tile snapshot as soon as the .glb is available — even before
  // designer approval — so the catalog has a real thumbnail the moment the
  // render gate clears. Failures are silent; the tile just uses the original
  // photo fallback.
  runThumbnailBackfill(variantId).catch((err) =>
    console.warn('[runRenderPipeline] thumbnail backfill failed:', err)
  )
}

// ── Thumbnail backfill ──────────────────────────────────────────────────────
//
// Shared worker that renders + uploads a variant tile thumbnail and patches
// `thumbnail_path` on the row + in-memory state. Deduplicates concurrent
// calls per variant so rapid re-renders (polling + approve + mount) don't
// spin up multiple WebGL contexts for the same variant.

const thumbnailInFlight = new Map<string, Promise<void>>()

export function runThumbnailBackfill(variantId: string): Promise<void> {
  const existing = thumbnailInFlight.get(variantId)
  if (existing) return existing

  const task = (async () => {
    // Locate the variant across the item-keyed map.
    const state = useCatalogStore.getState()
    let variant: FurnitureVariant | null = null
    for (const list of Object.values(state.variants)) {
      const hit = list.find((v) => v.id === variantId)
      if (hit) { variant = hit; break }
    }

    // No-op if the variant isn't loaded locally, has no .glb (flat or still
    // generating), or already has a cached thumbnail.
    if (!variant) return
    if (!variant.glb_path) return
    if (variant.thumbnail_path) return

    const { path, error } = await renderVariantThumbnail(variantId, variant.glb_path)
    if (error || !path) {
      console.warn(`[runThumbnailBackfill] ${variantId}:`, error)
      return
    }

    const { error: dbErr } = await rawUpdate('furniture_variants', variantId, {
      thumbnail_path: path,
    })
    if (dbErr) {
      console.warn(`[runThumbnailBackfill] db update failed for ${variantId}:`, dbErr)
      return
    }

    useCatalogStore.setState((s) => ({
      variants: mapVariant(s.variants, variantId, { thumbnail_path: path }),
    }))
  })().finally(() => {
    thumbnailInFlight.delete(variantId)
  })

  thumbnailInFlight.set(variantId, task)
  return task
}
