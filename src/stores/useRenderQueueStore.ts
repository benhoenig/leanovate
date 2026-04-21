import { create } from 'zustand'
import { useCatalogStore } from './useCatalogStore'

// ── Types ───────────────────────────────────────────────────────────────────

export type QueueStage = 'uploading' | 'creating' | 'trellis' | 'ready' | 'failed'

export interface QueueEntry {
  id: string
  variantId: string | null
  itemId: string
  itemName: string
  colorName: string
  thumbUrl: string | null
  stage: QueueStage
  uploadedCount: number
  totalImages: number
  startedAt: number
  error: string | null
  isFlat: boolean
}

export interface EnqueueDraft {
  draftId: string
  colorName: string
  images: File[]
  price_thb?: number
  source_url?: string
  sort_order: number
}

interface RenderQueueState {
  entries: Record<string, QueueEntry>

  enqueueVariant: (itemId: string, itemName: string, draft: EnqueueDraft) => string
  dismiss: (id: string) => void

  getActive: () => QueueEntry[]
  getReady: () => QueueEntry[]
  getFailed: () => QueueEntry[]
  isVariantInFlight: (variantId: string) => boolean
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function patchEntry(id: string, updates: Partial<QueueEntry>): void {
  useRenderQueueStore.setState((state) => {
    const existing = state.entries[id]
    if (!existing) return state
    return { entries: { ...state.entries, [id]: { ...existing, ...updates } } }
  })
}

function findVariant(variantId: string) {
  const st = useCatalogStore.getState()
  for (const list of Object.values(st.variants)) {
    const v = list.find((x) => x.id === variantId)
    if (v) return v
  }
  return null
}

/**
 * Resolves once the catalog store reports render_status=completed or failed
 * for the given variant. Uses Zustand subscribe — no polling.
 */
function awaitRenderCompletion(variantId: string): Promise<'completed' | 'failed'> {
  return new Promise((resolve) => {
    const check = (): boolean => {
      const v = findVariant(variantId)
      if (!v) return false
      if (v.render_status === 'completed') { resolve('completed'); return true }
      if (v.render_status === 'failed') { resolve('failed'); return true }
      return false
    }
    if (check()) return
    const unsub = useCatalogStore.subscribe((state, prev) => {
      if (state.variants === prev.variants) return
      if (check()) unsub()
    })
  })
}

/**
 * Background worker — drives one queue entry from upload → createVariant →
 * TRELLIS completion. Returns when the entry hits a terminal stage.
 */
async function processEntry(entryId: string, itemId: string, draft: EnqueueDraft): Promise<void> {
  const catalog = useCatalogStore.getState()
  const isFlat = catalog.isItemFlat(itemId)
  patchEntry(entryId, { isFlat })

  // ── Upload phase ──────────────────────────────────────────────────────────
  const imageUrls: string[] = []
  for (let i = 0; i < draft.images.length; i++) {
    const { url, error } = await useCatalogStore
      .getState()
      .uploadVariantImage(`${itemId}_${draft.draftId}`, draft.images[i])
    if (error || !url) {
      patchEntry(entryId, { stage: 'failed', error: error ?? 'Upload failed' })
      return
    }
    imageUrls.push(url)
    patchEntry(entryId, { uploadedCount: i + 1 })
  }

  // ── Variant row creation ──────────────────────────────────────────────────
  patchEntry(entryId, { stage: 'creating' })
  const { id: variantId, error: createError } = await useCatalogStore
    .getState()
    .createVariant({
      furniture_item_id: itemId,
      color_name: draft.colorName,
      original_image_urls: imageUrls,
      price_thb: draft.price_thb,
      source_url: draft.source_url,
      sort_order: draft.sort_order,
    })

  if (createError || !variantId) {
    patchEntry(entryId, { stage: 'failed', error: createError ?? 'Create failed' })
    return
  }
  patchEntry(entryId, { variantId })

  // Flat items are auto-completed by createVariant — no TRELLIS wait needed.
  if (isFlat) {
    patchEntry(entryId, { stage: 'ready' })
    return
  }

  // ── TRELLIS phase ─────────────────────────────────────────────────────────
  // createVariant already fire-and-forgets runRenderPipeline.
  // We observe its result via the catalog store.
  patchEntry(entryId, { stage: 'trellis' })
  const result = await awaitRenderCompletion(variantId)
  patchEntry(entryId, {
    stage: result === 'completed' ? 'ready' : 'failed',
    error: result === 'failed' ? 'TRELLIS render failed' : null,
  })
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useRenderQueueStore = create<RenderQueueState>((set, get) => ({
  entries: {},

  enqueueVariant: (itemId, itemName, draft) => {
    const id = crypto.randomUUID()
    const thumbUrl = draft.images[0] ? URL.createObjectURL(draft.images[0]) : null

    const entry: QueueEntry = {
      id,
      variantId: null,
      itemId,
      itemName,
      colorName: draft.colorName,
      thumbUrl,
      stage: 'uploading',
      uploadedCount: 0,
      totalImages: draft.images.length,
      startedAt: Date.now(),
      error: null,
      isFlat: false,
    }

    set((state) => ({ entries: { ...state.entries, [id]: entry } }))

    processEntry(id, itemId, draft).catch((err) => {
      console.error('[renderQueue] processEntry crashed:', err)
      patchEntry(id, { stage: 'failed', error: String(err) })
    })

    return id
  },

  dismiss: (id) => {
    set((state) => {
      const entry = state.entries[id]
      if (entry?.thumbUrl) URL.revokeObjectURL(entry.thumbUrl)
      const { [id]: _, ...rest } = state.entries
      return { entries: rest }
    })
  },

  getActive: () =>
    Object.values(get().entries).filter((e) =>
      e.stage === 'uploading' || e.stage === 'creating' || e.stage === 'trellis',
    ),

  getReady: () => Object.values(get().entries).filter((e) => e.stage === 'ready'),

  getFailed: () => Object.values(get().entries).filter((e) => e.stage === 'failed'),

  isVariantInFlight: (variantId) =>
    Object.values(get().entries).some(
      (e) =>
        e.variantId === variantId &&
        (e.stage === 'uploading' || e.stage === 'creating' || e.stage === 'trellis'),
    ),
}))
