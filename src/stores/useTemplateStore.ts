import { create } from 'zustand'
import type {
  UnitLayoutTemplate,
  FurnitureLayoutTemplate,
  DesignStyleTemplate,
  StalenessAlert,
} from '@/types'
import { supabase, rawInsert, rawUpdate, rawDelete } from '@/lib/supabase'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useAuthStore } from '@/stores/useAuthStore'

// ── Shuffle / regenerate filter contract ────────────────────────────────────

export interface ShuffleFilters {
  /**
   * Optional per-item price cap. When set, a candidate variant is only
   * eligible if its `price_thb <= maxPricePerItem`. Null-priced variants
   * are included iff `includeNullPrice` (matches the "unknown price"
   * toggle intent — designers often want to keep them in the pool).
   */
  maxPricePerItem?: number
  includeNullPrice?: boolean
}

/**
 * Effective block size for an item: item.block_size_override ?? category.default_block_size.
 * Returned as 'big' | 'small'. Falls back to 'big' if neither is set (defensive).
 */
function effectiveBlockSizeForItem(
  item: { id: string; category_id: string; block_size_override: 'big' | 'small' | null },
  categories: { id: string; default_block_size: 'big' | 'small' }[],
): 'big' | 'small' {
  if (item.block_size_override) return item.block_size_override
  const cat = categories.find((c) => c.id === item.category_id)
  return cat?.default_block_size ?? 'big'
}

/**
 * Pick a random approved variant from `variants` that matches the price
 * filter. Returns null when no eligible variant exists.
 */
function pickVariantForItem<V extends { price_thb: number | null; render_approval_status?: string }>(
  variants: V[],
  filters: ShuffleFilters | undefined,
): V | null {
  const eligible = variants.filter((v) => {
    if (filters?.maxPricePerItem != null) {
      if (v.price_thb == null) return !!filters.includeNullPrice
      if (v.price_thb > filters.maxPricePerItem) return false
    }
    return true
  })
  if (eligible.length === 0) return null
  return eligible[Math.floor(Math.random() * eligible.length)]
}

interface TemplateState {
  unitTemplates: UnitLayoutTemplate[]
  furnitureTemplates: FurnitureLayoutTemplate[]
  styleTemplates: DesignStyleTemplate[]
  isLoading: boolean
  stalenessAlerts: StalenessAlert[]

  // Loaders
  loadUnitTemplates: () => Promise<void>
  loadFurnitureTemplates: () => Promise<void>
  loadStyleTemplates: () => Promise<void>
  loadAllTemplates: () => Promise<void>

  // Save
  saveUnitTemplate: (name: string) => Promise<{ id: string | null; error: string | null }>
  saveFurnitureTemplate: (name: string) => Promise<{ id: string | null; error: string | null }>
  saveStyleTemplate: (name: string, styleId: string) => Promise<{ id: string | null; error: string | null }>

  // Apply
  applyUnitTemplate: (templateId: string) => Promise<{ error: string | null }>
  applyFurnitureTemplate: (templateId: string) => Promise<{ error: string | null }>
  applyStyleTemplate: (templateId: string, force?: boolean) => Promise<{ alerts: StalenessAlert[]; error: string | null }>

  // Regenerate / shuffle
  /**
   * Whole-room redesign: re-rolls every placed item with a new random pick
   * from the (category × style × block size [× price cap]) pool. Returns
   * per-slot match counts so the UI can surface a "shuffled N of M" toast
   * and never silently removes a placed item whose slot has no matches.
   */
  regenerateStyle: (
    styleId: string,
    filters?: ShuffleFilters,
  ) => Promise<{ error: string | null; swapped: number; skipped: number; total: number }>
  /**
   * Per-item shuffle — same filters, but scoped to one placed item. Keeps
   * position / rotation / scale; writes a new variant + price_at_placement.
   * Returns `swapped: false` + a reason if no alternates match.
   */
  shuffleSlot: (
    placedId: string,
    styleId: string | null,
    filters?: ShuffleFilters,
  ) => Promise<{ swapped: boolean; reason?: 'no-matches' | 'pool-size-1' | 'not-found' }>

  // Admin
  promoteTemplate: (type: 'unit' | 'furniture' | 'style', templateId: string) => Promise<void>
  deleteTemplate: (type: 'unit' | 'furniture' | 'style', templateId: string) => Promise<void>

  clearStalenessAlerts: () => void
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  unitTemplates: [],
  furnitureTemplates: [],
  styleTemplates: [],
  isLoading: false,
  stalenessAlerts: [],

  // ─── Loaders ──────────────────────────────────────────────────────────────

  loadUnitTemplates: async () => {
    const { data, error } = await supabase
      .from('unit_layout_templates')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) { console.error('loadUnitTemplates:', error); return }
    set({ unitTemplates: data as UnitLayoutTemplate[] })
  },

  loadFurnitureTemplates: async () => {
    const { data, error } = await supabase
      .from('furniture_layout_templates')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) { console.error('loadFurnitureTemplates:', error); return }
    set({ furnitureTemplates: data as FurnitureLayoutTemplate[] })
  },

  loadStyleTemplates: async () => {
    const { data, error } = await supabase
      .from('design_style_templates')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) { console.error('loadStyleTemplates:', error); return }
    set({ styleTemplates: data as DesignStyleTemplate[] })
  },

  loadAllTemplates: async () => {
    set({ isLoading: true })
    await get().loadUnitTemplates()
    await get().loadFurnitureTemplates()
    await get().loadStyleTemplates()
    set({ isLoading: false })
  },

  // ─── Save ─────────────────────────────────────────────────────────────────

  saveUnitTemplate: async (name) => {
    const profile = useAuthStore.getState().profile
    if (!profile) return { id: null, error: 'Not authenticated' }

    const { currentProject, rooms } = useProjectStore.getState()
    if (!currentProject) return { id: null, error: 'No project open' }
    if (rooms.length === 0) return { id: null, error: 'No rooms to save' }

    const rooms_data = rooms.map((r) => ({
      name: r.name,
      x: r.x,
      y: r.y,
      width_cm: r.width_cm,
      height_cm: r.height_cm,
      ceiling_height_cm: r.ceiling_height_cm,
      geometry: r.geometry,
      finishes: r.finishes,
      sort_order: r.sort_order,
    }))

    const { data, error } = await rawInsert<UnitLayoutTemplate>('unit_layout_templates', {
      name,
      created_by: profile.id,
      unit_width_cm: currentProject.unit_width_cm,
      unit_height_cm: currentProject.unit_height_cm,
      rooms_data,
    })

    if (error || !data) return { id: null, error: error ?? 'Insert failed' }
    set((s) => ({ unitTemplates: [data, ...s.unitTemplates] }))
    return { id: data.id, error: null }
  },

  saveFurnitureTemplate: async (name) => {
    const profile = useAuthStore.getState().profile
    if (!profile) return { id: null, error: 'Not authenticated' }

    const { placedFurniture } = useCanvasStore.getState()
    const { rooms } = useProjectStore.getState()
    const catalogState = useCatalogStore.getState()

    if (placedFurniture.length === 0) return { id: null, error: 'No furniture placed' }

    const layout_data = placedFurniture.map((pf) => {
      const item = catalogState.items.find((i) => i.id === pf.furniture_item_id)
      const room = rooms.find((r) => r.id === pf.room_id)
      return {
        category_id: item?.category_id ?? '',
        room_name: room?.name ?? '',
        x_cm: pf.x_cm,
        z_cm: pf.z_cm,
        rotation_deg: pf.rotation_deg,
      }
    })

    const { data, error } = await rawInsert<FurnitureLayoutTemplate>('furniture_layout_templates', {
      name,
      created_by: profile.id,
      layout_data,
    })

    if (error || !data) return { id: null, error: error ?? 'Insert failed' }
    set((s) => ({ furnitureTemplates: [data, ...s.furnitureTemplates] }))
    return { id: data.id, error: null }
  },

  saveStyleTemplate: async (name, styleId) => {
    const profile = useAuthStore.getState().profile
    if (!profile) return { id: null, error: 'Not authenticated' }

    const { placedFurniture } = useCanvasStore.getState()
    const { rooms } = useProjectStore.getState()
    const catalogState = useCatalogStore.getState()

    if (placedFurniture.length === 0) return { id: null, error: 'No furniture placed' }

    const items_data = placedFurniture.map((pf) => {
      const item = catalogState.items.find((i) => i.id === pf.furniture_item_id)
      const variants = catalogState.getVariantsForItem(pf.furniture_item_id)
      const variant = variants.find((v) => v.id === pf.selected_variant_id)
      const room = rooms.find((r) => r.id === pf.room_id)
      return {
        category_id: item?.category_id ?? '',
        furniture_item_id: pf.furniture_item_id,
        variant_id: pf.selected_variant_id,
        room_name: room?.name ?? '',
        x_cm: pf.x_cm,
        z_cm: pf.z_cm,
        rotation_deg: pf.rotation_deg,
        price_at_save: variant?.price_thb ?? null,
      }
    })

    const { data, error } = await rawInsert<DesignStyleTemplate>('design_style_templates', {
      name,
      style_id: styleId,
      created_by: profile.id,
      items_data,
    })

    if (error || !data) return { id: null, error: error ?? 'Insert failed' }
    set((s) => ({ styleTemplates: [data, ...s.styleTemplates] }))
    return { id: data.id, error: null }
  },

  // ─── Apply ────────────────────────────────────────────────────────────────

  applyUnitTemplate: async (templateId) => {
    const template = get().unitTemplates.find((t) => t.id === templateId)
    if (!template) return { error: 'Template not found' }

    const { currentProject, rooms } = useProjectStore.getState()
    if (!currentProject) return { error: 'No project open' }

    // Delete existing rooms sequentially
    for (const room of rooms) {
      await useProjectStore.getState().deleteRoom(room.id)
    }

    // Update project dimensions
    await useProjectStore.getState().updateProject(currentProject.id, {
      unit_width_cm: template.unit_width_cm,
      unit_height_cm: template.unit_height_cm,
    })

    // Create rooms from template snapshot
    for (const rd of template.rooms_data) {
      const { error } = await rawInsert('rooms', {
        project_id: currentProject.id,
        name: rd.name,
        x: rd.x,
        y: rd.y,
        width_cm: rd.width_cm,
        height_cm: rd.height_cm,
        ceiling_height_cm: rd.ceiling_height_cm,
        geometry: rd.geometry,
        finishes: rd.finishes,
        sort_order: rd.sort_order,
      })
      if (error) console.error('applyUnitTemplate room insert:', error)
    }

    // Reload project to get new rooms
    await useProjectStore.getState().loadProject(currentProject.id)
    return { error: null }
  },

  applyFurnitureTemplate: async (templateId) => {
    const template = get().furnitureTemplates.find((t) => t.id === templateId)
    if (!template) return { error: 'Template not found' }

    const { rooms } = useProjectStore.getState()
    const catalogState = useCatalogStore.getState()

    if (rooms.length === 0) return { error: 'No rooms in project' }

    const items: Array<{ roomId: string; furnitureItemId: string; variantId: string; x_cm: number; z_cm: number; rotation_deg: number }> = []
    const skipped: string[] = []

    for (const slot of template.layout_data) {
      // Match room by name, fallback to first room
      const room = rooms.find((r) => r.name === slot.room_name) ?? rooms[0]

      // Find first approved item in this category
      const approvedItems = catalogState.items.filter(
        (i) => i.category_id === slot.category_id && i.status === 'approved'
      )
      if (approvedItems.length === 0) {
        const cat = catalogState.categories.find((c) => c.id === slot.category_id)
        skipped.push(cat?.name ?? slot.category_id)
        continue
      }

      const item = approvedItems[0]
      const variants = catalogState.getVariantsForItem(item.id)
      const variant = variants[0]
      if (!variant) {
        skipped.push(item.name)
        continue
      }

      items.push({
        roomId: room.id,
        furnitureItemId: item.id,
        variantId: variant.id,
        x_cm: slot.x_cm,
        z_cm: slot.z_cm,
        rotation_deg: slot.rotation_deg,
      })
    }

    if (items.length > 0) {
      await useCanvasStore.getState().placeItems(items)
    }

    if (skipped.length > 0) {
      return { error: `Skipped ${skipped.length} slot(s) — no approved items for: ${skipped.join(', ')}` }
    }
    return { error: null }
  },

  applyStyleTemplate: async (templateId, force = false) => {
    const template = get().styleTemplates.find((t) => t.id === templateId)
    if (!template) return { alerts: [], error: 'Template not found' }

    const { rooms } = useProjectStore.getState()
    const catalogState = useCatalogStore.getState()

    if (rooms.length === 0) return { alerts: [], error: 'No rooms in project' }

    // Check staleness
    const alerts: StalenessAlert[] = []
    for (const ti of template.items_data) {
      const item = catalogState.items.find((i) => i.id === ti.furniture_item_id)
      const variants = catalogState.getVariantsForItem(ti.furniture_item_id)
      const variant = variants.find((v) => v.id === ti.variant_id)

      const priceChanged = ti.price_at_save != null && variant?.price_thb != null && ti.price_at_save !== variant.price_thb
      const linkInactive = variant?.link_status === 'inactive'

      if (priceChanged || linkInactive) {
        alerts.push({
          placed_furniture_id: ti.variant_id,
          furniture_item_name: item?.name ?? 'Unknown',
          variant_color_name: variant?.color_name ?? '',
          old_price: ti.price_at_save,
          new_price: variant?.price_thb ?? null,
          link_inactive: linkInactive,
        })
      }
    }

    if (alerts.length > 0 && !force) {
      set({ stalenessAlerts: alerts })
      return { alerts, error: null }
    }

    // Place items
    const items: Array<{ roomId: string; furnitureItemId: string; variantId: string; x_cm: number; z_cm: number; rotation_deg: number }> = []

    for (const ti of template.items_data) {
      const room = rooms.find((r) => r.name === ti.room_name) ?? rooms[0]
      items.push({
        roomId: room.id,
        furnitureItemId: ti.furniture_item_id,
        variantId: ti.variant_id,
        x_cm: ti.x_cm,
        z_cm: ti.z_cm,
        rotation_deg: ti.rotation_deg,
      })
    }

    if (items.length > 0) {
      await useCanvasStore.getState().placeItems(items)
    }

    set({ stalenessAlerts: [] })
    return { alerts: [], error: null }
  },

  // ─── Regenerate ───────────────────────────────────────────────────────────

  regenerateStyle: async (styleId, filters) => {
    const { rooms } = useProjectStore.getState()
    const catalogState = useCatalogStore.getState()
    const selectedRoomId = useProjectStore.getState().selectedRoomId

    if (!selectedRoomId || rooms.length === 0) {
      return { error: 'No room selected', swapped: 0, skipped: 0, total: 0 }
    }

    const { placedFurniture } = useCanvasStore.getState()
    if (placedFurniture.length === 0) {
      return { error: 'No furniture to regenerate', swapped: 0, skipped: 0, total: 0 }
    }

    const roomPlaced = placedFurniture.filter((p) => p.room_id === selectedRoomId)

    // Build a list of picks per slot. Slots whose pool is empty are left
    // intact (the existing placement stays) and counted as skipped.
    const picks: Array<{
      roomId: string; furnitureItemId: string; variantId: string
      x_cm: number; z_cm: number; rotation_deg: number
    }> = []
    const keepInstanceIds: string[] = []
    let skipped = 0

    for (const pf of roomPlaced) {
      const sourceItem = catalogState.items.find((i) => i.id === pf.furniture_item_id)
      if (!sourceItem) { skipped++; continue }
      const slotBlockSize = effectiveBlockSizeForItem(sourceItem, catalogState.categories)

      // Pool = approved items in same category × tagged with styleId × same effective block size.
      const poolItems = catalogState.items.filter((i) => {
        if (i.status !== 'approved') return false
        if (i.category_id !== sourceItem.category_id) return false
        if (effectiveBlockSizeForItem(i, catalogState.categories) !== slotBlockSize) return false
        const tags = catalogState.itemStyles[i.id] ?? []
        return tags.includes(styleId)
      })

      // For each candidate item, try to pick a variant that passes the price
      // filter. Items with no eligible variant are dropped from the pool.
      const candidates: Array<{ itemId: string; variantId: string }> = []
      for (const it of poolItems) {
        const vs = catalogState.getVariantsForItem(it.id)
        const picked = pickVariantForItem(vs, filters)
        if (picked) candidates.push({ itemId: it.id, variantId: picked.id })
      }

      if (candidates.length === 0) {
        // Keep the existing placement; don't silently remove it.
        keepInstanceIds.push(pf.id)
        skipped++
        continue
      }

      const chosen = candidates[Math.floor(Math.random() * candidates.length)]
      picks.push({
        roomId: pf.room_id,
        furnitureItemId: chosen.itemId,
        variantId: chosen.variantId,
        x_cm: pf.x_cm,
        z_cm: pf.z_cm,
        rotation_deg: pf.rotation_deg,
      })
    }

    // Remove only the furniture we have replacements for, then place picks.
    // Items with no pool match stay where they were.
    const canvasStore = useCanvasStore.getState()
    const toRemove = roomPlaced
      .map((pf) => pf.id)
      .filter((id) => !keepInstanceIds.includes(id))
    for (const id of toRemove) {
      await canvasStore.removeItem(id)
    }
    if (picks.length > 0) await canvasStore.placeItems(picks)

    return {
      error: null,
      swapped: picks.length,
      skipped,
      total: roomPlaced.length,
    }
  },

  shuffleSlot: async (placedId, styleId, filters) => {
    const catalogState = useCatalogStore.getState()
    const canvasStore = useCanvasStore.getState()
    const placed = canvasStore.placedFurniture.find((p) => p.id === placedId)
    if (!placed) return { swapped: false, reason: 'not-found' }
    const sourceItem = catalogState.items.find((i) => i.id === placed.furniture_item_id)
    if (!sourceItem) return { swapped: false, reason: 'not-found' }

    const slotBlockSize = effectiveBlockSizeForItem(sourceItem, catalogState.categories)

    // Pool = approved items in same category × same effective block size ×
    // tagged with styleId (if provided — otherwise any style).
    const poolItems = catalogState.items.filter((i) => {
      if (i.status !== 'approved') return false
      if (i.category_id !== sourceItem.category_id) return false
      if (effectiveBlockSizeForItem(i, catalogState.categories) !== slotBlockSize) return false
      if (styleId) {
        const tags = catalogState.itemStyles[i.id] ?? []
        if (!tags.includes(styleId)) return false
      }
      return true
    })

    // Filter to (item, variant) pairs that satisfy the price cap, and
    // exclude the currently-selected variant so a shuffle always produces a
    // different result when possible.
    const candidates: Array<{ itemId: string; variantId: string; price: number | null }> = []
    for (const it of poolItems) {
      const vs = catalogState.getVariantsForItem(it.id)
      for (const v of vs) {
        if (v.id === placed.selected_variant_id) continue
        if (filters?.maxPricePerItem != null) {
          if (v.price_thb == null && !filters.includeNullPrice) continue
          if (v.price_thb != null && v.price_thb > filters.maxPricePerItem) continue
        }
        candidates.push({ itemId: it.id, variantId: v.id, price: v.price_thb })
      }
    }

    if (candidates.length === 0) {
      // Distinguish "only the current item fits" from "nothing fits" so the
      // UI can show a helpful message.
      const poolSize = poolItems.length
      return {
        swapped: false,
        reason: poolSize <= 1 ? 'pool-size-1' : 'no-matches',
      }
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)]

    // Simplest implementation: remove the old placement and place a fresh
    // one at the same coordinates. Preserves x/z/rotation; price_at_placement
    // takes the new variant's current price.
    await canvasStore.removeItem(placed.id)
    await canvasStore.placeItems([{
      roomId: placed.room_id,
      furnitureItemId: chosen.itemId,
      variantId: chosen.variantId,
      x_cm: placed.x_cm,
      z_cm: placed.z_cm,
      rotation_deg: placed.rotation_deg,
    }])
    return { swapped: true }
  },

  // ─── Admin ────────────────────────────────────────────────────────────────

  promoteTemplate: async (type, templateId) => {
    const profile = useAuthStore.getState().profile
    if (!profile || profile.role !== 'admin') return

    const table = type === 'unit' ? 'unit_layout_templates'
      : type === 'furniture' ? 'furniture_layout_templates'
      : 'design_style_templates'

    const { error } = await rawUpdate(table, templateId, { is_global: true, promoted_by: profile.id })

    if (error) { console.error('promoteTemplate:', error); return }

    // Update local state
    if (type === 'unit') {
      set((s) => ({
        unitTemplates: s.unitTemplates.map((t) =>
          t.id === templateId ? { ...t, is_global: true, promoted_by: profile.id } : t
        ),
      }))
    } else if (type === 'furniture') {
      set((s) => ({
        furnitureTemplates: s.furnitureTemplates.map((t) =>
          t.id === templateId ? { ...t, is_global: true, promoted_by: profile.id } : t
        ),
      }))
    } else {
      set((s) => ({
        styleTemplates: s.styleTemplates.map((t) =>
          t.id === templateId ? { ...t, is_global: true, promoted_by: profile.id } : t
        ),
      }))
    }
  },

  deleteTemplate: async (type, templateId) => {
    const table = type === 'unit' ? 'unit_layout_templates'
      : type === 'furniture' ? 'furniture_layout_templates'
      : 'design_style_templates'

    const { error } = await rawDelete(table, templateId)
    if (error) { console.error('deleteTemplate:', error); return }

    if (type === 'unit') {
      set((s) => ({ unitTemplates: s.unitTemplates.filter((t) => t.id !== templateId) }))
    } else if (type === 'furniture') {
      set((s) => ({ furnitureTemplates: s.furnitureTemplates.filter((t) => t.id !== templateId) }))
    } else {
      set((s) => ({ styleTemplates: s.styleTemplates.filter((t) => t.id !== templateId) }))
    }
  },

  clearStalenessAlerts: () => set({ stalenessAlerts: [] }),
}))
