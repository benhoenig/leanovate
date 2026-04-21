import type { StateCreator } from 'zustand'
import type {
  FurnitureItem,
  FurnitureVariant,
  FurnitureCategory,
  Style,
  ItemStatus,
} from '@/types'

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

// ── Slice interfaces ──────────────────────────────────────────────────────────

export interface CategoriesSlice {
  categories: FurnitureCategory[]
  styles: Style[]
  /** style_ids keyed by furniture_item_id */
  itemStyles: Record<string, string[]>

  loadCategories: () => Promise<void>
  loadStyles: () => Promise<void>
  loadItemStyles: (itemId: string) => Promise<void>
}

export interface ItemsSlice {
  items: FurnitureItem[]
  searchQuery: string
  selectedCategoryId: string | null
  isLoading: boolean
  /** Include hidden items in `items` + `getFilteredItems` results. Session-local toggle. */
  showHidden: boolean

  loadItems: (filter?: { status?: ItemStatus; includeHidden?: boolean }) => Promise<void>
  createItem: (data: CreateItemInput) => Promise<{ id: string | null; error: string | null }>
  updateItem: (
    id: string,
    updates: Partial<Pick<FurnitureItem, 'name' | 'description' | 'category_id' | 'width_cm' | 'depth_cm' | 'height_cm' | 'source_url' | 'is_flat_override' | 'block_size_override'>>
  ) => Promise<void>
  setItemStyles: (itemId: string, styleIds: string[]) => Promise<void>

  submitItemForReview: (itemId: string) => Promise<void>
  approveItem: (itemId: string) => Promise<void>
  rejectItem: (itemId: string) => Promise<void>

  /** Mark the item as hidden from the catalog grid. Reversible via unhideItem. */
  hideItem: (itemId: string) => Promise<{ error: string | null }>
  /** Clear hidden_at/hidden_by on the item. */
  unhideItem: (itemId: string) => Promise<{ error: string | null }>
  /**
   * Hard-delete the item (cascades to variants + styles). Blocks with a
   * clear error if any placed_furniture row references it — hide instead.
   */
  deleteItem: (itemId: string) => Promise<{ error: string | null }>

  setSearchQuery: (query: string) => void
  setSelectedCategory: (id: string | null) => void
  setShowHidden: (show: boolean) => void

  getFilteredItems: () => FurnitureItem[]
  /** Is the effective flat bypass active for an item? (category.is_flat unless overridden) */
  isItemFlat: (itemId: string) => boolean
}

export interface VariantsSlice {
  /** variants keyed by furniture_item_id */
  variants: Record<string, FurnitureVariant[]>
  isLoadingVariants: boolean

  loadVariantsForItem: (itemId: string) => Promise<void>
  /** Fetch specific variants by id (used to preload fixture variants referenced from room geometry). */
  loadVariantsByIds: (variantIds: string[]) => Promise<void>

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

  getVariantsForItem: (itemId: string) => FurnitureVariant[]
}

export interface RenderSlice {
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
  /** Variants with a .glb that are awaiting designer approval (render_approval_status='pending' + glb_path not null) */
  getPendingRenderApprovalVariants: () => Array<{ item: FurnitureItem; variant: FurnitureVariant }>
}

// Full store = union of all slices. Each slice gets this type via `get()`
// so cross-slice calls (e.g. variantsSlice calling `isItemFlat`) type-check.
export type CatalogState = CategoriesSlice & ItemsSlice & VariantsSlice & RenderSlice

/** Convenience alias for a slice StateCreator with access to the full store via `get()`. */
export type CatalogSliceCreator<T> = StateCreator<CatalogState, [], [], T>
