import { create } from 'zustand'
import type { FurnitureItem, FurnitureVariant, FurnitureCategory, Style } from '@/types'

interface CatalogState {
  // State
  items: FurnitureItem[]
  variants: Record<string, FurnitureVariant[]> // keyed by furniture_item_id
  categories: FurnitureCategory[]
  styles: Style[]
  searchQuery: string
  selectedCategoryId: string | null
  isLoading: boolean

  // Actions — to be implemented in Phase 3
  setItems: (items: FurnitureItem[]) => void
  setVariants: (itemId: string, variants: FurnitureVariant[]) => void
  setCategories: (categories: FurnitureCategory[]) => void
  setStyles: (styles: Style[]) => void
  setSearchQuery: (query: string) => void
  setSelectedCategory: (id: string | null) => void
}

export const useCatalogStore = create<CatalogState>((set) => ({
  items: [],
  variants: {},
  categories: [],
  styles: [],
  searchQuery: '',
  selectedCategoryId: null,
  isLoading: false,

  setItems: (items) => set({ items }),
  setVariants: (itemId, variants) =>
    set((state) => ({
      variants: { ...state.variants, [itemId]: variants },
    })),
  setCategories: (categories) => set({ categories }),
  setStyles: (styles) => set({ styles }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (id) => set({ selectedCategoryId: id }),
}))
