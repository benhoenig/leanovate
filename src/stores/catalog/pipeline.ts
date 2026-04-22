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

// ── TRELLIS call serialization + 429 retry ──────────────────────────────────
//
// Replicate applies a "burst = 1" concurrent-create limit on accounts below
// a (undocumented, roughly $20) credit threshold — see CLAUDE.md backlog.
// When a designer batch-uploads 4 color variants, three get 429'd instantly.
//
// Fix: every runRenderPipeline call chains onto a module-level promise tail,
// so only one generate-3d-model edge-function call is in flight at a time.
// On 429, the worker parses `retry_after` from the error body, waits that
// many seconds, and retries the same variant — no failure surfaced to the
// queue tray.
//
// The edge function itself blocks on Replicate polling, so "one in flight"
// means one TRELLIS prediction per ~30–60s. Slower than parallel, but
// reliable under the current rate-limit tier.

let queueTail: Promise<void> = Promise.resolve()
const MAX_RATE_LIMIT_RETRIES = 6
const DEFAULT_RETRY_SECONDS = 15

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Detects a rate-limit error (Replicate 429) in the edge-function error
 * string and pulls out the retry delay. Returns null for non-429 errors.
 */
function parseRateLimitDelay(errorText: string): number | null {
  if (!errorText.includes('HTTP 429')) return null
  const match = errorText.match(/"retry_after"\s*:\s*(\d+)/)
  if (match) {
    const s = parseInt(match[1], 10)
    if (!isNaN(s) && s > 0) return s
  }
  return DEFAULT_RETRY_SECONDS
}

/**
 * Drives the post-variant-creation pipeline for non-flat items:
 *   1. Set render_status = 'processing' locally
 *   2. Invoke generate-3d-model (TRELLIS) — one at a time, retries 429s
 *   3. Set render_status = 'completed' | 'failed'
 *
 * render_approval_status stays 'pending' regardless — designer decides.
 * DB writes happen inside the edge function; this function only mirrors
 * render_status locally.
 */
export function runRenderPipeline(variantId: string): Promise<void> {
  const myTurn = queueTail.then(() => runRenderPipelineWorker(variantId))
  // Swallow rejections from the tail so one failure doesn't break the chain.
  queueTail = myTurn.catch(() => {})
  return myTurn
}

async function runRenderPipelineWorker(variantId: string): Promise<void> {
  const patch = (updates: Partial<FurnitureVariant>) =>
    useCatalogStore.setState((state) => ({
      variants: mapVariant(state.variants, variantId, updates),
    }))

  patch({ render_status: 'processing' as RenderStatus })

  let attempt = 0
  while (true) {
    const result = await invokeEdgeFunction('generate-3d-model', { variant_id: variantId })
    if (!result.error) {
      const glbPath = result.data?.glb_path as string | undefined
      if (!glbPath) {
        patch({ render_status: 'failed' as RenderStatus })
        return
      }
      patch({ glb_path: glbPath, render_status: 'completed' as RenderStatus })
      runThumbnailBackfill(variantId).catch((err) =>
        console.warn('[runRenderPipeline] thumbnail backfill failed:', err)
      )
      return
    }

    // 429 → wait retry_after and retry. Any other error → mark failed.
    const delaySec = parseRateLimitDelay(result.error)
    if (delaySec == null || attempt >= MAX_RATE_LIMIT_RETRIES) {
      patch({ render_status: 'failed' as RenderStatus })
      return
    }
    attempt++
    console.warn(
      `[runRenderPipeline] variant ${variantId} rate-limited (attempt ${attempt}/${MAX_RATE_LIMIT_RETRIES}), retrying in ${delaySec}s`,
    )
    // Buffer a second so we're past Replicate's reset window.
    await sleep((delaySec + 1) * 1000)
  }
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
