import type { FurnitureCategory, Style } from '@/types'
import { supabase } from '@/lib/supabase'
import type { CategoriesSlice, CatalogSliceCreator } from './types'

export const createCategoriesSlice: CatalogSliceCreator<CategoriesSlice> = (set) => ({
  categories: [],
  styles: [],
  itemStyles: {},

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
})
