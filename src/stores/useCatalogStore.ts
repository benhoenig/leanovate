import { create } from 'zustand'
import type {
  FurnitureItem,
  FurnitureVariant,
  FurnitureSprite,
  FurnitureCategory,
  Style,
  ItemStatus,
  ImageStatus,
} from '@/types'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { renderSprites } from '@/lib/renderSprites'

// ── Raw fetch helper for edge functions ─────────────────────────────────────
// Completely bypasses the Supabase JS client to avoid concurrency hangs.
// Gets the auth token from useAuthStore (already in memory) instead of
// calling supabase.auth.getSession() which would touch the client.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function invokeEdgeFunction(name: string, body: Record<string, unknown>): Promise<{ error: string | null; data?: Record<string, unknown> }> {
  // Read token from localStorage directly — zero Supabase client interaction
  let token = SUPABASE_ANON_KEY
  try {
    const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.access_token) token = parsed.access_token
    }
  } catch { /* fall back to anon key */ }

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
}

export interface CreateVariantInput {
  furniture_item_id: string
  color_name: string
  original_image_url: string
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
  /** sprites keyed by variant_id */
  sprites: Record<string, FurnitureSprite[]>
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
  loadSpritesForVariant: (variantId: string) => Promise<void>
  loadItemStyles: (itemId: string) => Promise<void>

  // ─ Item CRUD ─────────────────────────────────────────────────────────────
  createItem: (data: CreateItemInput) => Promise<{ id: string | null; error: string | null }>
  updateItem: (
    id: string,
    updates: Partial<Pick<FurnitureItem, 'name' | 'description' | 'category_id' | 'width_cm' | 'depth_cm' | 'height_cm' | 'source_url'>>
  ) => Promise<void>
  setItemStyles: (itemId: string, styleIds: string[]) => Promise<void>

  // ─ Variant CRUD ──────────────────────────────────────────────────────────
  createVariant: (data: CreateVariantInput) => Promise<{ id: string | null; error: string | null }>
  updateVariant: (
    id: string,
    updates: Partial<Pick<FurnitureVariant, 'color_name' | 'price_thb' | 'source_url' | 'width_cm' | 'depth_cm' | 'height_cm' | 'image_status' | 'render_status' | 'clean_image_url' | 'glb_path'>>
  ) => Promise<void>
  /** Upload variant image file to Supabase Storage, returns public URL */
  uploadVariantImage: (variantId: string, file: File) => Promise<{ url: string | null; error: string | null }>
  /** Re-run background removal for a variant (after rejection) */
  triggerBackgroundRemoval: (variantId: string) => Promise<{ error: string | null }>

  // ─ AI pipeline status transitions ────────────────────────────────────────
  approveImage: (variantId: string) => Promise<{ error: string | null }>
  rejectImage: (variantId: string) => Promise<void>

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
  getSpritesForVariant: (variantId: string) => FurnitureSprite[]
  getPendingApprovalVariants: () => Array<{ item: FurnitureItem; variant: FurnitureVariant }>
}

// ── Implementation ────────────────────────────────────────────────────────────

export const useCatalogStore = create<CatalogState>((set, get) => ({
  items: [],
  variants: {},
  sprites: {},
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

  loadSpritesForVariant: async (variantId) => {
    const { data, error } = await supabase
      .from('furniture_sprites')
      .select('*')
      .eq('variant_id', variantId)
    if (error) { console.error('loadSpritesForVariant:', error); return }
    set((state) => ({
      sprites: { ...state.sprites, [variantId]: data as FurnitureSprite[] },
    }))
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

    const { data: row, error } = await supabase
      .from('furniture_items')
      .insert({
        name: data.name,
        category_id: data.category_id,
        source_url: data.source_url || 'manual',
        source_domain: data.source_domain || 'manual',
        description: data.description ?? null,
        width_cm: data.width_cm ?? null,
        depth_cm: data.depth_cm ?? null,
        height_cm: data.height_cm ?? null,
        status: 'draft',
        submitted_by: profile.id,
      })
      .select()
      .single()

    if (error) {
      console.error('createItem insert error:', error)
      return { id: null, error: error.message }
    }

    const newItem = row as FurnitureItem
    set((state) => ({ items: [newItem, ...state.items] }))
    return { id: newItem.id, error: null }
  },

  updateItem: async (id, updates) => {
    const { error } = await supabase.from('furniture_items').update(updates).eq('id', id)
    if (error) { console.error('updateItem:', error); return }
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    }))
  },

  setItemStyles: async (itemId, styleIds) => {
    await supabase.from('furniture_item_styles').delete().eq('furniture_item_id', itemId)
    if (styleIds.length > 0) {
      const rows = styleIds.map((style_id) => ({ furniture_item_id: itemId, style_id }))
      const { error } = await supabase.from('furniture_item_styles').insert(rows)
      if (error) { console.error('setItemStyles:', error); return }
    }
    set((state) => ({ itemStyles: { ...state.itemStyles, [itemId]: styleIds } }))
  },

  // ─── Variant CRUD ──────────────────────────────────────────────────────────

  createVariant: async (data) => {
    const { data: row, error } = await supabase
      .from('furniture_variants')
      .insert({
        furniture_item_id: data.furniture_item_id,
        color_name: data.color_name,
        original_image_url: data.original_image_url,
        price_thb: data.price_thb ?? null,
        source_url: data.source_url ?? null,
        width_cm: data.width_cm ?? null,
        depth_cm: data.depth_cm ?? null,
        height_cm: data.height_cm ?? null,
        sort_order: data.sort_order ?? 0,
        image_status: 'processing',
        render_status: 'waiting',
        link_status: 'unchecked',
      })
      .select()
      .single()

    if (error) return { id: null, error: error.message }

    const newVariant = row as FurnitureVariant
    set((state) => {
      const existing = state.variants[data.furniture_item_id] ?? []
      return {
        variants: {
          ...state.variants,
          [data.furniture_item_id]: [...existing, newVariant],
        },
      }
    })
    return { id: newVariant.id, error: null }
  },

  updateVariant: async (id, updates) => {
    const { error } = await supabase.from('furniture_variants').update(updates).eq('id', id)
    if (error) { console.error('updateVariant:', error); return }
    set((state) => {
      const newVariants: Record<string, FurnitureVariant[]> = {}
      for (const [itemId, list] of Object.entries(state.variants)) {
        newVariants[itemId] = list.map((v) => (v.id === id ? { ...v, ...updates } : v))
      }
      return { variants: newVariants }
    })
  },

  uploadVariantImage: async (variantId, file) => {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${variantId}/${crypto.randomUUID()}.${ext}`

    console.log('[uploadVariantImage] Starting upload…', { path, fileSize: file.size, fileType: file.type })

    try {
      const uploadPromise = supabase.storage
        .from('original-images')
        .upload(path, file, { upsert: false })

      // 30-second timeout to prevent infinite hang
      const timeoutPromise = new Promise<{ error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ error: { message: 'Upload timed out after 30 seconds' } }), 30000)
      )

      const { error: uploadError } = await Promise.race([uploadPromise, timeoutPromise])
      console.log('[uploadVariantImage] Upload complete', { error: uploadError?.message ?? null })

      if (uploadError) return { url: null, error: uploadError.message }

      const { data } = supabase.storage.from('original-images').getPublicUrl(path)
      return { url: data.publicUrl, error: null }
    } catch (err) {
      console.error('[uploadVariantImage] Unexpected error:', err)
      return { url: null, error: String(err) }
    }
  },

  triggerBackgroundRemoval: async (variantId) => {
    console.log('[triggerBgRemoval] Starting for variant:', variantId)
    // Update local Zustand state only (no DB write) — variant is already
    // created with image_status='processing' in the database.
    // Avoids concurrent DB ops that hang the Supabase client.
    set((state) => {
      const newVariants: Record<string, FurnitureVariant[]> = {}
      for (const [itemId, list] of Object.entries(state.variants)) {
        newVariants[itemId] = list.map((v) =>
          v.id === variantId ? { ...v, image_status: 'processing' as ImageStatus } : v
        )
      }
      return { variants: newVariants }
    })

    console.log('[triggerBgRemoval] Calling remove-background edge function…')
    const { error } = await invokeEdgeFunction('remove-background', { variant_id: variantId })
    console.log('[triggerBgRemoval] Edge function returned:', { error })
    if (error) return { error }

    // Reload the variant to pick up the status set by the edge function
    // (pending_approval on success, rejected on failure)
    const itemId = Object.entries(get().variants).find(
      ([, list]) => list.some((v) => v.id === variantId)
    )?.[0]
    console.log('[triggerBgRemoval] Reloading variants for item:', itemId)
    if (itemId) await get().loadVariantsForItem(itemId)

    // Log final status
    const updatedVariant = Object.values(get().variants).flat().find((v) => v.id === variantId)
    console.log('[triggerBgRemoval] Done. Variant status:', {
      image_status: updatedVariant?.image_status,
      clean_image_url: !!updatedVariant?.clean_image_url,
    })

    return { error: null }
  },

  // ─── AI pipeline transitions ────────────────────────────────────────────────

  approveImage: async (variantId) => {
    console.log('[approveImage] Approving variant:', variantId)
    const { error: dbError } = await supabase
      .from('furniture_variants')
      .update({ image_status: 'approved' as ImageStatus, render_status: 'processing' })
      .eq('id', variantId)
    if (dbError) {
      console.error('[approveImage] DB error:', dbError)
      return { error: dbError.message }
    }
    console.log('[approveImage] DB updated, updating local state')

    // Update local Zustand state directly (DB already updated above)
    set((state) => {
      const newVariants: Record<string, FurnitureVariant[]> = {}
      for (const [itemId, list] of Object.entries(state.variants)) {
        newVariants[itemId] = list.map((v) =>
          v.id === variantId ? { ...v, image_status: 'approved' as ImageStatus, render_status: 'processing' as FurnitureVariant['render_status'] } : v
        )
      }
      return { variants: newVariants }
    })

    // Trigger TRELLIS → then render sprites client-side
    console.log('[approveImage] Triggering generate-3d-model…')
    invokeEdgeFunction('generate-3d-model', { variant_id: variantId })
      .then(async (result) => {
        console.log('[approveImage] generate-3d-model completed:', result)
        if (result.error) return

        // Get glb_path from edge function response (avoids DB reload that hangs)
        const glbPath = result.data?.glb_path as string | undefined
        if (!glbPath) {
          console.error('[approveImage] No glb_path in generate-3d-model response')
          return
        }

        // Update local state with glb_path
        set((state) => {
          const newVariants: Record<string, FurnitureVariant[]> = {}
          for (const [itemId, list] of Object.entries(state.variants)) {
            newVariants[itemId] = list.map((v) =>
              v.id === variantId ? { ...v, glb_path: glbPath } : v
            )
          }
          return { variants: newVariants }
        })

        // Render sprites client-side in the browser
        console.log('[approveImage] Starting client-side sprite rendering, glb_path:', glbPath)
        const spriteResult = await renderSprites(variantId, glbPath)
        console.log('[approveImage] Sprite rendering result:', spriteResult)

        // Reload variant to reflect final render_status
        const itemId = Object.entries(get().variants).find(
          ([, list]) => list.some((v) => v.id === variantId)
        )?.[0]
        if (itemId) await get().loadVariantsForItem(itemId)
      })
      .catch((err) => console.warn('[approveImage] pipeline error:', err))

    return { error: null }
  },

  rejectImage: async (variantId) => {
    const { error } = await supabase
      .from('furniture_variants')
      .update({ image_status: 'rejected' as ImageStatus })
      .eq('id', variantId)
    if (error) { console.error('rejectImage:', error); return }
    // Update local state directly (DB already updated above)
    set((state) => {
      const newVariants: Record<string, FurnitureVariant[]> = {}
      for (const [itemId, list] of Object.entries(state.variants)) {
        newVariants[itemId] = list.map((v) =>
          v.id === variantId ? { ...v, image_status: 'rejected' as ImageStatus } : v
        )
      }
      return { variants: newVariants }
    })
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

  getSpritesForVariant: (variantId) => get().sprites[variantId] ?? [],

  getPendingApprovalVariants: () => {
    const { items, variants } = get()
    const result: Array<{ item: FurnitureItem; variant: FurnitureVariant }> = []
    for (const item of items) {
      for (const variant of variants[item.id] ?? []) {
        if (variant.image_status === 'pending_approval') {
          result.push({ item, variant })
        }
      }
    }
    return result
  },
}))
