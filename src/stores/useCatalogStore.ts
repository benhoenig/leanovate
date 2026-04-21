import { create } from 'zustand'
import type {
  FurnitureItem,
  FurnitureVariant,
  FurnitureCategory,
  Style,
  ItemStatus,
  RenderStatus,
  RenderApprovalStatus,
} from '@/types'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, getAuthToken, rawInsert, rawUpdate } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { renderVariantThumbnail } from '@/lib/renderVariantThumbnail'

// ── Raw fetch helper for edge functions ─────────────────────────────────────
// Bypasses the Supabase JS client to avoid concurrency hangs (see CLAUDE.md #8)

function invokeEdgeFunction(name: string, body: Record<string, unknown>): Promise<{ error: string | null; data?: Record<string, unknown> }> {
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

// ── Input shapes ──────────────────────────────────────────────────────────────

export interface CreateItemInput {
  name: string
  category_id: string
  source_url: string
  source_domain: string
  description?: string
  width_cm?: number
  depth_cm?: number
  height_cm?: number
  is_flat_override?: boolean | null
}

export interface CreateVariantInput {
  furniture_item_id: string
  color_name: string
  original_image_urls: string[]
  price_thb?: number
  source_url?: string
  width_cm?: number
  depth_cm?: number
  height_cm?: number
  sort_order?: number
}

// ── Store interface ───────────────────────────────────────────────────────────

interface CatalogState {
  // ─ Data ──────────────────────────────────────────────────────────────────
  items: FurnitureItem[]
  /** variants keyed by furniture_item_id */
  variants: Record<string, FurnitureVariant[]>
  categories: FurnitureCategory[]
  styles: Style[]
  /** style_ids keyed by furniture_item_id */
  itemStyles: Record<string, string[]>

  // ─ Filters ───────────────────────────────────────────────────────────────
  searchQuery: string
  selectedCategoryId: string | null

  // ─ Loading ───────────────────────────────────────────────────────────────
  isLoading: boolean
  isLoadingVariants: boolean

  // ─ Loaders ───────────────────────────────────────────────────────────────
  loadCategories: () => Promise<void>
  loadStyles: () => Promise<void>
  loadItems: (filter?: { status?: ItemStatus }) => Promise<void>
  loadVariantsForItem: (itemId: string) => Promise<void>
  /** Fetch specific variants by id (used to preload fixture variants referenced from room geometry). */
  loadVariantsByIds: (variantIds: string[]) => Promise<void>
  loadItemStyles: (itemId: string) => Promise<void>

  // ─ Item CRUD ─────────────────────────────────────────────────────────────
  createItem: (data: CreateItemInput) => Promise<{ id: string | null; error: string | null }>
  updateItem: (
    id: string,
    updates: Partial<Pick<FurnitureItem, 'name' | 'description' | 'category_id' | 'width_cm' | 'depth_cm' | 'height_cm' | 'source_url' | 'is_flat_override' | 'block_size_override'>>
  ) => Promise<void>
  setItemStyles: (itemId: string, styleIds: string[]) => Promise<void>

  // ─ Variant CRUD ──────────────────────────────────────────────────────────
  /**
   * Creates a variant row AND kicks off the pipeline:
   *   - If parent item/category is flat → skip TRELLIS, mark render_status=completed
   *   - Otherwise → invoke generate-3d-model, then render sprites client-side.
   *     render_approval_status stays 'pending' until designer reviews the .glb.
   */
  createVariant: (data: CreateVariantInput) => Promise<{ id: string | null; error: string | null }>
  updateVariant: (
    id: string,
    updates: Partial<Pick<FurnitureVariant, 'color_name' | 'price_thb' | 'source_url' | 'width_cm' | 'depth_cm' | 'height_cm' | 'render_status' | 'render_approval_status' | 'glb_path' | 'original_image_urls'>>
  ) => Promise<void>
  /** Upload one image file to the original-images bucket. Returns the public URL. */
  uploadVariantImage: (storagePrefix: string, file: File) => Promise<{ url: string | null; error: string | null }>

  // ─ Post-TRELLIS approval flow ────────────────────────────────────────────
  /** Designer approves the generated .glb — item is now usable without the "pending" badge. */
  approveRender: (variantId: string) => Promise<{ error: string | null }>
  /** Designer rejects the generated .glb — they can re-upload images and retry. */
  rejectRender: (variantId: string) => Promise<{ error: string | null }>
  /** Re-run TRELLIS for an existing variant (e.g. after re-upload). */
  retryRender: (variantId: string) => Promise<{ error: string | null }>
  /**
   * Lazily backfill a catalog tile thumbnail for a variant that has a .glb
   * but no `thumbnail_path` yet (legacy data or approveRender's
   * fire-and-forget snapshot hasn't completed). Safe to call repeatedly —
   * no-ops if the variant already has a thumbnail or has no .glb.
   */
  ensureVariantThumbnail: (variantId: string) => Promise<void>

  // ─ Catalog approval flow ─────────────────────────────────────────────────
  submitItemForReview: (itemId: string) => Promise<void>
  approveItem: (itemId: string) => Promise<void>
  rejectItem: (itemId: string) => Promise<void>

  // ─ Filter state ──────────────────────────────────────────────────────────
  setSearchQuery: (query: string) => void
  setSelectedCategory: (id: string | null) => void

  // ─ Derived selectors ─────────────────────────────────────────────────────
  getFilteredItems: () => FurnitureItem[]
  getVariantsForItem: (itemId: string) => FurnitureVariant[]
  /** Variants with a .glb that are awaiting designer approval (render_approval_status='pending' + glb_path not null) */
  getPendingRenderApprovalVariants: () => Array<{ item: FurnitureItem; variant: FurnitureVariant }>
  /** Is the effective flat bypass active for an item? (category.is_flat unless overridden) */
  isItemFlat: (itemId: string) => boolean
}

// ── Implementation ────────────────────────────────────────────────────────────

export const useCatalogStore = create<CatalogState>((set, get) => ({
  items: [],
  variants: {},
  categories: [],
  styles: [],
  itemStyles: {},
  searchQuery: '',
  selectedCategoryId: null,
  isLoading: false,
  isLoadingVariants: false,

  // ─── Loaders ───────────────────────────────────────────────────────────────

  loadCategories: async () => {
    const { data, error } = await supabase
      .from('furniture_categories')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) { console.error('loadCategories:', error); return }
    set({ categories: data as FurnitureCategory[] })
  },

  loadStyles: async () => {
    const { data, error } = await supabase
      .from('styles')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) { console.error('loadStyles:', error); return }
    set({ styles: data as Style[] })
  },

  loadItems: async (filter) => {
    set({ isLoading: true })
    try {
      const profile = useAuthStore.getState().profile

      let query = supabase
        .from('furniture_items')
        .select('*')
        .order('created_at', { ascending: false })

      if (filter?.status) {
        query = query.eq('status', filter.status)
      } else if (profile?.role !== 'admin') {
        query = query.or(`submitted_by.eq.${profile?.id ?? ''},status.eq.approved`)
      }

      const { data, error } = await query
      if (error) throw error
      set({ items: data as FurnitureItem[] })
    } catch (err) {
      console.error('loadItems:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  loadVariantsForItem: async (itemId) => {
    set({ isLoadingVariants: true })
    try {
      const { data, error } = await supabase
        .from('furniture_variants')
        .select('*')
        .eq('furniture_item_id', itemId)
        .order('sort_order', { ascending: true })
      if (error) throw error
      set((state) => ({
        variants: { ...state.variants, [itemId]: data as FurnitureVariant[] },
      }))
    } catch (err) {
      console.error('loadVariantsForItem:', err)
    } finally {
      set({ isLoadingVariants: false })
    }
  },

  loadVariantsByIds: async (variantIds) => {
    const unique = [...new Set(variantIds)].filter(Boolean)
    if (unique.length === 0) return
    // Skip any variant id we already have cached in any item bucket.
    const state = get()
    const known = new Set<string>()
    for (const list of Object.values(state.variants)) {
      for (const v of list) known.add(v.id)
    }
    const missing = unique.filter((id) => !known.has(id))
    if (missing.length === 0) return
    try {
      const { data, error } = await supabase
        .from('furniture_variants')
        .select('*')
        .in('id', missing)
      if (error) throw error
      const fetched = (data ?? []) as FurnitureVariant[]
      // Group by parent item id so the existing resolveVariant lookup finds them.
      const byItem = new Map<string, FurnitureVariant[]>()
      for (const v of fetched) {
        const arr = byItem.get(v.furniture_item_id) ?? []
        arr.push(v)
        byItem.set(v.furniture_item_id, arr)
      }
      set((s) => {
        const next = { ...s.variants }
        for (const [itemId, vs] of byItem) {
          const existing = next[itemId] ?? []
          // Merge — keep any variants already loaded for the same item, add new ones.
          const merged = [...existing]
          for (const v of vs) {
            if (!merged.some((x) => x.id === v.id)) merged.push(v)
          }
          next[itemId] = merged
        }
        return { variants: next }
      })
    } catch (err) {
      console.error('loadVariantsByIds:', err)
    }
  },

  loadItemStyles: async (itemId) => {
    const { data, error } = await supabase
      .from('furniture_item_styles')
      .select('style_id')
      .eq('furniture_item_id', itemId)
    if (error) { console.error('loadItemStyles:', error); return }
    set((state) => ({
      itemStyles: {
        ...state.itemStyles,
        [itemId]: (data as { style_id: string }[]).map((r) => r.style_id),
      },
    }))
  },

  // ─── Item CRUD ─────────────────────────────────────────────────────────────

  createItem: async (data) => {
    const profile = useAuthStore.getState().profile
    if (!profile) {
      console.error('createItem: profile is null — user not authenticated or profile failed to load')
      return { id: null, error: 'Not authenticated. Please refresh and try again.' }
    }

    const { data: row, error } = await rawInsert<FurnitureItem>('furniture_items', {
      name: data.name,
      category_id: data.category_id,
      // Null for wall fixtures (no purchase link). Floor items that were added
      // without a link still get 'manual' so source_domain lookups don't break.
      source_url: data.source_url || null,
      source_domain: data.source_domain || 'manual',
      description: data.description ?? null,
      width_cm: data.width_cm ?? null,
      depth_cm: data.depth_cm ?? null,
      height_cm: data.height_cm ?? null,
      is_flat_override: data.is_flat_override ?? null,
      status: 'draft',
      submitted_by: profile.id,
    })

    if (error || !row) {
      console.error('createItem insert error:', error)
      return { id: null, error: error ?? 'Insert returned no data' }
    }

    set((state) => ({ items: [row, ...state.items] }))
    return { id: row.id, error: null }
  },

  updateItem: async (id, updates) => {
    const { error } = await rawUpdate('furniture_items', id, updates as Record<string, unknown>)
    if (error) { console.error('updateItem:', error); return }
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    }))
  },

  setItemStyles: async (itemId, styleIds) => {
    const token = getAuthToken()
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/furniture_item_styles?furniture_item_id=eq.${itemId}`,
      { method: 'DELETE', headers }
    )

    if (styleIds.length > 0) {
      const rows = styleIds.map((style_id) => ({ furniture_item_id: itemId, style_id }))
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/furniture_item_styles`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rows),
      })
      if (!resp.ok) {
        const text = await resp.text()
        console.error('setItemStyles:', text)
        return
      }
    }
    set((state) => ({ itemStyles: { ...state.itemStyles, [itemId]: styleIds } }))
  },

  // ─── Variant CRUD ──────────────────────────────────────────────────────────

  createVariant: async (data) => {
    if (data.original_image_urls.length === 0) {
      return { id: null, error: 'At least one image is required' }
    }

    const isFlat = get().isItemFlat(data.furniture_item_id)

    // Flat items skip TRELLIS entirely → render_status='completed' immediately,
    // render_approval_status='approved' (no .glb to review).
    const { data: row, error } = await rawInsert<FurnitureVariant>('furniture_variants', {
      furniture_item_id: data.furniture_item_id,
      color_name: data.color_name,
      original_image_urls: data.original_image_urls,
      price_thb: data.price_thb ?? null,
      source_url: data.source_url ?? null,
      width_cm: data.width_cm ?? null,
      depth_cm: data.depth_cm ?? null,
      height_cm: data.height_cm ?? null,
      sort_order: data.sort_order ?? 0,
      render_status: isFlat ? 'completed' : 'waiting',
      render_approval_status: isFlat ? 'approved' : 'pending',
      link_status: 'unchecked',
    })

    if (error || !row) return { id: null, error: error ?? 'Insert returned no data' }

    set((state) => {
      const existing = state.variants[data.furniture_item_id] ?? []
      return {
        variants: {
          ...state.variants,
          [data.furniture_item_id]: [...existing, row],
        },
      }
    })

    // For non-flat items: fire-and-forget the TRELLIS + sprite pipeline.
    // Render approval happens after sprites come back.
    if (!isFlat) {
      runRenderPipeline(row.id).catch((err) =>
        console.warn('[createVariant] pipeline error:', err)
      )
    }

    return { id: row.id, error: null }
  },

  updateVariant: async (id, updates) => {
    const { error } = await rawUpdate('furniture_variants', id, updates as Record<string, unknown>)
    if (error) { console.error('updateVariant:', error); return }
    set((state) => {
      const newVariants: Record<string, FurnitureVariant[]> = {}
      for (const [itemId, list] of Object.entries(state.variants)) {
        newVariants[itemId] = list.map((v) => (v.id === id ? { ...v, ...updates } : v))
      }
      return { variants: newVariants }
    })
  },

  uploadVariantImage: async (storagePrefix, file) => {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${storagePrefix}/${crypto.randomUUID()}.${ext}`

    try {
      const token = getAuthToken()
      const resp = await fetch(
        `${SUPABASE_URL}/storage/v1/object/original-images/${path}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_ANON_KEY,
          },
          body: file,
        }
      )

      if (!resp.ok) {
        const text = await resp.text()
        console.error('[uploadVariantImage] Upload failed:', resp.status, text)
        return { url: null, error: text || `Upload failed (HTTP ${resp.status})` }
      }

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/original-images/${path}`
      return { url: publicUrl, error: null }
    } catch (err) {
      console.error('[uploadVariantImage] Unexpected error:', err)
      return { url: null, error: String(err) }
    }
  },

  // ─── Post-TRELLIS approval ──────────────────────────────────────────────────

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
    // Reset approval + render status, then re-run pipeline
    const { error } = await rawUpdate('furniture_variants', variantId, {
      render_approval_status: 'pending',
      render_status: 'waiting',
      glb_path: null,
    })
    if (error) return { error }
    set((state) => ({
      variants: mapVariant(state.variants, variantId, {
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

  // ─── Catalog approval ──────────────────────────────────────────────────────

  submitItemForReview: async (itemId) => {
    const { error } = await supabase
      .from('furniture_items')
      .update({ status: 'pending' })
      .eq('id', itemId)
    if (error) { console.error('submitItemForReview:', error); return }
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, status: 'pending' as ItemStatus } : i
      ),
    }))
  },

  approveItem: async (itemId) => {
    const profile = useAuthStore.getState().profile
    const { error } = await supabase
      .from('furniture_items')
      .update({
        status: 'approved',
        reviewed_by: profile?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', itemId)
    if (error) { console.error('approveItem:', error); return }
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, status: 'approved' as ItemStatus } : i
      ),
    }))
  },

  rejectItem: async (itemId) => {
    const profile = useAuthStore.getState().profile
    const { error } = await supabase
      .from('furniture_items')
      .update({
        status: 'rejected',
        reviewed_by: profile?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', itemId)
    if (error) { console.error('rejectItem:', error); return }
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, status: 'rejected' as ItemStatus } : i
      ),
    }))
  },

  // ─── Filter state ──────────────────────────────────────────────────────────

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (id) => set({ selectedCategoryId: id }),

  // ─── Derived selectors ─────────────────────────────────────────────────────

  getFilteredItems: () => {
    const { items, searchQuery, selectedCategoryId } = get()
    return items.filter((item) => {
      const matchesSearch =
        !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesCategory =
        !selectedCategoryId || item.category_id === selectedCategoryId
      return matchesSearch && matchesCategory
    })
  },

  getVariantsForItem: (itemId) => get().variants[itemId] ?? [],


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

  isItemFlat: (itemId) => {
    const { items, categories } = get()
    const item = items.find((i) => i.id === itemId)
    if (!item) return false
    if (item.is_flat_override !== null && item.is_flat_override !== undefined) {
      return item.is_flat_override
    }
    const cat = categories.find((c) => c.id === item.category_id)
    return cat?.is_flat ?? false
  },
}))

// ── Pipeline helpers ─────────────────────────────────────────────────────────

function mapVariant(
  variants: Record<string, FurnitureVariant[]>,
  variantId: string,
  updates: Partial<FurnitureVariant>
): Record<string, FurnitureVariant[]> {
  const out: Record<string, FurnitureVariant[]> = {}
  for (const [itemId, list] of Object.entries(variants)) {
    out[itemId] = list.map((v) => (v.id === variantId ? { ...v, ...updates } : v))
  }
  return out
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
async function runRenderPipeline(variantId: string): Promise<void> {
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

function runThumbnailBackfill(variantId: string): Promise<void> {
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
