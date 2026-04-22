import type { FurnitureCategory, Style } from '@/types'
import { rawSelect } from '@/lib/supabase'
import type { CategoriesSlice, CatalogSliceCreator } from './types'

export const createCategoriesSlice: CatalogSliceCreator<CategoriesSlice> = (set) => ({
  categories: [],
  styles: [],
  itemStyles: {},

  // All three loads use rawSelect (raw fetch) instead of supabase.from() —
  // see CLAUDE.md #8. EditorPage mount fires these concurrently with
  // loadItems and a fan-out of loadVariantsForItem; the supabase JS client
  // deadlocks one when many client reads race.

  loadCategories: async () => {
    const { data, error } = await rawSelect<FurnitureCategory>(
      'furniture_categories',
      'order=sort_order.asc',
    )
    if (error) { console.error('loadCategories:', error); return }
    set({ categories: data ?? [] })
  },

  loadStyles: async () => {
    const { data, error } = await rawSelect<Style>(
      'styles',
      'order=sort_order.asc',
    )
    if (error) { console.error('loadStyles:', error); return }
    set({ styles: data ?? [] })
  },

  loadItemStyles: async (itemId) => {
    const { data, error } = await rawSelect<{ style_id: string }>(
      'furniture_item_styles',
      `furniture_item_id=eq.${itemId}`,
      'style_id',
    )
    if (error) { console.error('loadItemStyles:', error); return }
    set((state) => ({
      itemStyles: {
        ...state.itemStyles,
        [itemId]: (data ?? []).map((r) => r.style_id),
      },
    }))
  },
})
