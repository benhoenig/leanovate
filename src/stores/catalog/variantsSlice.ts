import type { FurnitureVariant } from '@/types'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, getAuthToken, rawInsert, rawUpdate, rawSelect } from '@/lib/supabase'
import type { VariantsSlice, CatalogSliceCreator } from './types'
import { runRenderPipeline } from './pipeline'

export const createVariantsSlice: CatalogSliceCreator<VariantsSlice> = (set, get) => ({
  variants: {},
  isLoadingVariants: false,

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
      // Raw fetch — avoids colliding with CatalogPanel/EditorPage polling
      // on the shared Supabase client (see CLAUDE.md #8).
      const { data, error } = await rawSelect<FurnitureVariant>(
        'furniture_variants',
        `id=in.(${missing.join(',')})`,
      )
      if (error) throw new Error(error)
      const fetched = data ?? []
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

  createVariant: async (data) => {
    if (data.original_image_urls.length === 0) {
      return { id: null, error: 'At least one image is required' }
    }

    // Two categories of variants skip the TRELLIS pipeline entirely:
    //   • Flat items (rugs, wall art) — render as textured planes.
    //   • Architectural items (doors/windows) — render as room-shell
    //     primitives. TRELLIS produced heavy distortion on framed/glazed
    //     geometry, so we bypass the pipeline for wall-mount categories.
    const { isItemFlat, isItemArchitectural } = get()
    const bypassPipeline =
      isItemFlat(data.furniture_item_id) ||
      isItemArchitectural(data.furniture_item_id)

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
      render_status: bypassPipeline ? 'completed' : 'waiting',
      render_approval_status: bypassPipeline ? 'approved' : 'pending',
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

    // Only fire the TRELLIS pipeline when the bypass isn't active.
    // Render approval happens when the .glb comes back.
    if (!bypassPipeline) {
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

  getVariantsForItem: (itemId) => get().variants[itemId] ?? [],
})
