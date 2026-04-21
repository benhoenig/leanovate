import { create } from 'zustand'
import type { CatalogState } from './catalog/types'
import { createCategoriesSlice } from './catalog/categoriesSlice'
import { createItemsSlice } from './catalog/itemsSlice'
import { createVariantsSlice } from './catalog/variantsSlice'
import { createRenderSlice } from './catalog/renderSlice'

// Re-exports preserve the existing public import paths.
export type { CreateItemInput, CreateVariantInput } from './catalog/types'

export const useCatalogStore = create<CatalogState>((...a) => ({
  ...createCategoriesSlice(...a),
  ...createItemsSlice(...a),
  ...createVariantsSlice(...a),
  ...createRenderSlice(...a),
}))
