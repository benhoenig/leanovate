import { create } from 'zustand'
import type {
  UnitLayoutTemplate,
  FurnitureLayoutTemplate,
  DesignStyleTemplate,
  StalenessAlert,
  Direction,
} from '@/types'
import { supabase } from '@/lib/supabase'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useAuthStore } from '@/stores/useAuthStore'

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

  // Regenerate
  regenerateStyle: (styleId: string) => Promise<{ error: string | null }>

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

    const { data, error } = await supabase
      .from('unit_layout_templates')
      .insert({
        name,
        created_by: profile.id,
        unit_width_cm: currentProject.unit_width_cm,
        unit_height_cm: currentProject.unit_height_cm,
        rooms_data,
      })
      .select()
      .single()

    if (error) return { id: null, error: error.message }
    set((s) => ({ unitTemplates: [data as UnitLayoutTemplate, ...s.unitTemplates] }))
    return { id: (data as UnitLayoutTemplate).id, error: null }
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
        x: pf.x,
        y: pf.y,
        direction: pf.direction,
      }
    })

    const { data, error } = await supabase
      .from('furniture_layout_templates')
      .insert({ name, created_by: profile.id, layout_data })
      .select()
      .single()

    if (error) return { id: null, error: error.message }
    set((s) => ({ furnitureTemplates: [data as FurnitureLayoutTemplate, ...s.furnitureTemplates] }))
    return { id: (data as FurnitureLayoutTemplate).id, error: null }
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
        x: pf.x,
        y: pf.y,
        direction: pf.direction,
        price_at_save: variant?.price_thb ?? null,
      }
    })

    const { data, error } = await supabase
      .from('design_style_templates')
      .insert({ name, style_id: styleId, created_by: profile.id, items_data })
      .select()
      .single()

    if (error) return { id: null, error: error.message }
    set((s) => ({ styleTemplates: [data as DesignStyleTemplate, ...s.styleTemplates] }))
    return { id: (data as DesignStyleTemplate).id, error: null }
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
      const { error } = await supabase
        .from('rooms')
        .insert({
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

    const items: Array<{ roomId: string; furnitureItemId: string; variantId: string; x: number; y: number; direction: Direction }> = []
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
        x: slot.x,
        y: slot.y,
        direction: slot.direction,
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
    const items: Array<{ roomId: string; furnitureItemId: string; variantId: string; x: number; y: number; direction: Direction }> = []

    for (const ti of template.items_data) {
      const room = rooms.find((r) => r.name === ti.room_name) ?? rooms[0]
      items.push({
        roomId: room.id,
        furnitureItemId: ti.furniture_item_id,
        variantId: ti.variant_id,
        x: ti.x,
        y: ti.y,
        direction: ti.direction,
      })
    }

    if (items.length > 0) {
      await useCanvasStore.getState().placeItems(items)
    }

    set({ stalenessAlerts: [] })
    return { alerts: [], error: null }
  },

  // ─── Regenerate ───────────────────────────────────────────────────────────

  regenerateStyle: async (styleId) => {
    const { rooms } = useProjectStore.getState()
    const catalogState = useCatalogStore.getState()
    const selectedRoomId = useProjectStore.getState().selectedRoomId

    if (!selectedRoomId || rooms.length === 0) return { error: 'No room selected' }

    // Get all placed furniture to know what categories are on canvas
    const { placedFurniture } = useCanvasStore.getState()
    if (placedFurniture.length === 0) return { error: 'No furniture to regenerate' }

    // Gather category slots from current placement
    const slots = placedFurniture.map((pf) => {
      const item = catalogState.items.find((i) => i.id === pf.furniture_item_id)
      return {
        category_id: item?.category_id ?? '',
        room_id: pf.room_id,
        x: pf.x,
        y: pf.y,
        direction: pf.direction,
      }
    })

    // Find items tagged with this style for each category
    const items: Array<{ roomId: string; furnitureItemId: string; variantId: string; x: number; y: number; direction: Direction }> = []

    for (const slot of slots) {
      const matchingItems = catalogState.items.filter((i) => {
        if (i.status !== 'approved' || i.category_id !== slot.category_id) return false
        const itemStyles = catalogState.itemStyles[i.id] ?? []
        return itemStyles.includes(styleId)
      })

      if (matchingItems.length === 0) {
        // Fallback: any approved item in this category
        const fallbacks = catalogState.items.filter(
          (i) => i.status === 'approved' && i.category_id === slot.category_id
        )
        if (fallbacks.length === 0) continue
        const pick = fallbacks[Math.floor(Math.random() * fallbacks.length)]
        const variants = catalogState.getVariantsForItem(pick.id)
        if (variants.length === 0) continue
        const variant = variants[Math.floor(Math.random() * variants.length)]
        items.push({ roomId: slot.room_id, furnitureItemId: pick.id, variantId: variant.id, x: slot.x, y: slot.y, direction: slot.direction })
        continue
      }

      const pick = matchingItems[Math.floor(Math.random() * matchingItems.length)]
      const variants = catalogState.getVariantsForItem(pick.id)
      if (variants.length === 0) continue
      const variant = variants[Math.floor(Math.random() * variants.length)]
      items.push({ roomId: slot.room_id, furnitureItemId: pick.id, variantId: variant.id, x: slot.x, y: slot.y, direction: slot.direction })
    }

    // Clear current furniture and place new picks
    await useCanvasStore.getState().clearRoomFurniture(selectedRoomId)
    if (items.length > 0) {
      await useCanvasStore.getState().placeItems(items)
    }

    return { error: null }
  },

  // ─── Admin ────────────────────────────────────────────────────────────────

  promoteTemplate: async (type, templateId) => {
    const profile = useAuthStore.getState().profile
    if (!profile || profile.role !== 'admin') return

    const table = type === 'unit' ? 'unit_layout_templates'
      : type === 'furniture' ? 'furniture_layout_templates'
      : 'design_style_templates'

    const { error } = await supabase
      .from(table)
      .update({ is_global: true, promoted_by: profile.id })
      .eq('id', templateId)

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

    const { error } = await supabase.from(table).delete().eq('id', templateId)
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
