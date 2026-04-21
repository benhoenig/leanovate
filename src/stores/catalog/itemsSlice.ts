import type { FurnitureItem, ItemStatus } from '@/types'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, getAuthToken, rawInsert, rawUpdate } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ItemsSlice, CatalogSliceCreator } from './types'

export const createItemsSlice: CatalogSliceCreator<ItemsSlice> = (set, get) => ({
  items: [],
  searchQuery: '',
  selectedCategoryId: null,
  isLoading: false,

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
    const { error } = await rawUpdate('furniture_items', itemId, {
      status: 'approved',
      reviewed_by: profile?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    if (error) { console.error('approveItem:', error); return }
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, status: 'approved' as ItemStatus } : i
      ),
    }))
  },

  rejectItem: async (itemId) => {
    const profile = useAuthStore.getState().profile
    const { error } = await rawUpdate('furniture_items', itemId, {
      status: 'rejected',
      reviewed_by: profile?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    if (error) { console.error('rejectItem:', error); return }
    set((state) => ({
      items: state.items.map((i) =>
        i.id === itemId ? { ...i, status: 'rejected' as ItemStatus } : i
      ),
    }))
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (id) => set({ selectedCategoryId: id }),

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
})
