import type { FurnitureItem, ItemStatus } from '@/types'
import {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  getAuthToken,
  rawInsert,
  rawUpdate,
  rawDelete,
} from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ItemsSlice, CatalogSliceCreator } from './types'

export const createItemsSlice: CatalogSliceCreator<ItemsSlice> = (set, get) => ({
  items: [],
  searchQuery: '',
  selectedCategoryId: null,
  isLoading: false,
  showHidden: false,

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
      mat_opening_cm: data.mat_opening_cm ?? null,
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

  submitItemForReview: async (itemId) => {
    const { error } = await rawUpdate('furniture_items', itemId, { status: 'pending' })
    if (error) { console.error('submitItemForReview:', error); return }
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, status: 'pending' as ItemStatus } : i
      ),
    }))
  },

  approveItem: async (itemId) => {
    const profile = useAuthStore.getState().profile
    const reviewed_at = new Date().toISOString()
    const reviewed_by = profile?.id ?? null
    const { error } = await rawUpdate('furniture_items', itemId, {
      status: 'approved',
      reviewed_by,
      reviewed_at,
    })
    if (error) { console.error('approveItem:', error); return }
    // Optimistic local update — propagates status + reviewer fields to any
    // subscribers (CatalogPanel in the editor, CatalogOverview in admin)
    // without needing a full `loadItems` re-fetch.
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId
          ? { ...i, status: 'approved' as ItemStatus, reviewed_by, reviewed_at }
          : i
      ),
    }))
  },

  rejectItem: async (itemId) => {
    const profile = useAuthStore.getState().profile
    const reviewed_at = new Date().toISOString()
    const reviewed_by = profile?.id ?? null
    const { error } = await rawUpdate('furniture_items', itemId, {
      status: 'rejected',
      reviewed_by,
      reviewed_at,
    })
    if (error) { console.error('rejectItem:', error); return }
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId
          ? { ...i, status: 'rejected' as ItemStatus, reviewed_by, reviewed_at }
          : i
      ),
    }))
  },

  hideItem: async (itemId) => {
    const profile = useAuthStore.getState().profile
    const hidden_at = new Date().toISOString()
    const hidden_by = profile?.id ?? null
    const { error } = await rawUpdate('furniture_items', itemId, { hidden_at, hidden_by })
    if (error) { console.error('hideItem:', error); return { error } }
    set((state) => ({
      items: state.items.map((i) => (i.id === itemId ? { ...i, hidden_at, hidden_by } : i)),
    }))
    return { error: null }
  },

  unhideItem: async (itemId) => {
    const { error } = await rawUpdate('furniture_items', itemId, {
      hidden_at: null,
      hidden_by: null,
    })
    if (error) { console.error('unhideItem:', error); return { error } }
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, hidden_at: null, hidden_by: null } : i
      ),
    }))
    return { error: null }
  },

  deleteItem: async (itemId) => {
    // Guard: refuse hard-delete when the item is referenced by any
    // placed_furniture row. The FK would block it anyway — we just surface a
    // clearer error so the UI can steer the user to Hide instead.
    const token = getAuthToken()
    const placedResp = await fetch(
      `${SUPABASE_URL}/rest/v1/placed_furniture?furniture_item_id=eq.${itemId}&select=id&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
        },
      }
    )
    if (placedResp.ok) {
      const rows = (await placedResp.json()) as unknown[]
      if (rows.length > 0) {
        return {
          error:
            'This item is placed in one or more projects and cannot be deleted. Hide it instead.',
        }
      }
    }

    // Guard: fixture items (doors/windows) are referenced from
    // `rooms.geometry.doors[]` / `rooms.geometry.windows[]` by `variant_id`.
    // There's no FK on JSONB, so cascading variants would silently leave
    // dangling references and the shell would render the fallback panel.
    // Collect this item's variant ids, then scan all rooms.
    const variantsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/furniture_variants?furniture_item_id=eq.${itemId}&select=id`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
        },
      }
    )
    if (variantsResp.ok) {
      const variantRows = (await variantsResp.json()) as Array<{ id: string }>
      const variantIds = new Set(variantRows.map((v) => v.id))
      if (variantIds.size > 0) {
        const roomsResp = await fetch(
          `${SUPABASE_URL}/rest/v1/rooms?select=id,geometry`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: SUPABASE_ANON_KEY,
            },
          }
        )
        if (roomsResp.ok) {
          const roomRows = (await roomsResp.json()) as Array<{
            id: string
            geometry: { doors?: Array<{ variant_id?: string }>; windows?: Array<{ variant_id?: string }> } | null
          }>
          const referenced = roomRows.some((r) => {
            const doors = r.geometry?.doors ?? []
            const windows = r.geometry?.windows ?? []
            return (
              doors.some((d) => d.variant_id && variantIds.has(d.variant_id)) ||
              windows.some((w) => w.variant_id && variantIds.has(w.variant_id))
            )
          })
          if (referenced) {
            return {
              error:
                'This fixture is used as a door or window in one or more rooms and cannot be deleted. Hide it instead.',
            }
          }
        }
      }
    }

    const { error } = await rawDelete('furniture_items', itemId)
    if (error) { console.error('deleteItem:', error); return { error } }
    set((state) => {
      const { [itemId]: _removedVariants, ...restVariants } = state.variants
      const { [itemId]: _removedStyles, ...restStyles } = state.itemStyles
      void _removedVariants
      void _removedStyles
      return {
        items: state.items.filter((i) => i.id !== itemId),
        variants: restVariants,
        itemStyles: restStyles,
      }
    })
    return { error: null }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (id) => set({ selectedCategoryId: id }),
  setShowHidden: (show) => set({ showHidden: show }),

  getFilteredItems: () => {
    const { items, searchQuery, selectedCategoryId, showHidden } = get()
    return items.filter((item) => {
      const matchesSearch =
        !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesCategory =
        !selectedCategoryId || item.category_id === selectedCategoryId
      const matchesHidden = showHidden || !item.hidden_at
      return matchesSearch && matchesCategory && matchesHidden
    })
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

  isItemArchitectural: (itemId) => {
    // Architectural = rendered from procedural geometry, not a TRELLIS-generated
    // .glb. Currently covers wall fixtures (doors/windows) and ceiling lights
    // (luminaire mesh + SpotLight). Any new `mount_type` that renders procedurally
    // should be added here so `createVariant` + `retryRender` keep skipping TRELLIS.
    const { items, categories } = get()
    const item = items.find((i) => i.id === itemId)
    if (!item) return false
    const cat = categories.find((c) => c.id === item.category_id)
    if (!cat) return false
    return cat.mount_type === 'wall' || cat.mount_type === 'ceiling' || cat.emits_light
  },
})
