import { create } from 'zustand'
import type { PlacedFurniture, Direction } from '@/types'
import { supabase } from '@/lib/supabase'
import { useCatalogStore } from '@/stores/useCatalogStore'

const DIRECTIONS: Direction[] = ['front_left', 'front_right', 'back_right', 'back_left']

interface CanvasState {
  // ─ Data ─────────────────────────────────────────────────────────────────
  placedFurniture: PlacedFurniture[]
  selectedItemId: string | null        // id of selected PlacedFurniture
  placementMode: boolean
  placementItemId: string | null       // furniture_item_id to place
  placementVariantId: string | null    // default variant for placement
  roomRotation: Direction
  isDragging: boolean

  // Fixture (door/window) placement
  fixturePlacementType: 'door' | 'window' | null
  selectedFixtureId: string | null

  // Shape edit mode
  shapeEditMode: boolean
  selectedVertexIndex: number | null

  // ─ Actions ──────────────────────────────────────────────────────────────

  loadPlacedFurniture: (roomId: string) => Promise<void>
  savePlacedFurniture: () => Promise<void>
  placeItems: (items: Array<{ roomId: string; furnitureItemId: string; variantId: string; x: number; y: number; direction: Direction }>) => Promise<void>
  clearRoomFurniture: (roomId: string) => Promise<void>

  setPlacementMode: (active: boolean, itemId?: string, variantId?: string) => void
  placeItem: (roomId: string, roomX: number, roomY: number) => Promise<void>
  cancelPlacement: () => void

  setSelectedItem: (id: string | null) => void

  moveItem: (id: string, roomX: number, roomY: number) => void
  rotateItem: (id: string) => void
  switchVariant: (id: string, variantId: string, price: number | null) => void
  removeItem: (id: string) => Promise<void>

  setRoomRotation: (direction: Direction) => void
  setDragging: (val: boolean) => void

  setFixturePlacementMode: (type: 'door' | 'window' | null) => void
  setSelectedFixture: (id: string | null) => void

  setShapeEditMode: (val: boolean) => void
  setSelectedVertex: (idx: number | null) => void
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  placedFurniture: [],
  selectedItemId: null,
  placementMode: false,
  placementItemId: null,
  placementVariantId: null,
  roomRotation: 'front_left',
  isDragging: false,
  fixturePlacementType: null,
  selectedFixtureId: null,
  shapeEditMode: false,
  selectedVertexIndex: null,

  // ─── Load / Save ──────────────────────────────────────────────────────────

  loadPlacedFurniture: async (roomId) => {
    const { data, error } = await supabase
      .from('placed_furniture')
      .select('*')
      .eq('room_id', roomId)
      .order('sort_order', { ascending: true })
    if (error) {
      console.error('loadPlacedFurniture:', error)
      return
    }
    set({ placedFurniture: data as PlacedFurniture[], selectedItemId: null })
  },

  savePlacedFurniture: async () => {
    const { placedFurniture } = get()
    for (const item of placedFurniture) {
      const { error } = await supabase
        .from('placed_furniture')
        .update({
          x: item.x,
          y: item.y,
          direction: item.direction,
          selected_variant_id: item.selected_variant_id,
          price_at_placement: item.price_at_placement,
          sort_order: item.sort_order,
        })
        .eq('id', item.id)
      if (error) console.error('savePlacedFurniture item error:', error)
    }
  },

  placeItems: async (items) => {
    if (items.length === 0) return
    const catalogState = useCatalogStore.getState()
    const { placedFurniture } = get()
    const rows = items.map((item, i) => {
      const variants = catalogState.getVariantsForItem(item.furnitureItemId)
      const variant = variants.find((v) => v.id === item.variantId)
      return {
        room_id: item.roomId,
        furniture_item_id: item.furnitureItemId,
        selected_variant_id: item.variantId,
        x: item.x,
        y: item.y,
        direction: item.direction,
        price_at_placement: variant?.price_thb ?? null,
        sort_order: placedFurniture.length + i,
      }
    })
    const { data, error } = await supabase
      .from('placed_furniture')
      .insert(rows)
      .select()
    if (error) {
      console.error('placeItems:', error)
      return
    }
    set((state) => ({
      placedFurniture: [...state.placedFurniture, ...(data as PlacedFurniture[])],
    }))
  },

  clearRoomFurniture: async (roomId) => {
    const { error } = await supabase
      .from('placed_furniture')
      .delete()
      .eq('room_id', roomId)
    if (error) {
      console.error('clearRoomFurniture:', error)
      return
    }
    set({ placedFurniture: [], selectedItemId: null })
  },

  // ─── Placement ────────────────────────────────────────────────────────────

  setPlacementMode: (active, itemId, variantId) =>
    set({
      placementMode: active,
      placementItemId: active ? (itemId ?? null) : null,
      placementVariantId: active ? (variantId ?? null) : null,
      selectedItemId: active ? null : get().selectedItemId,
      fixturePlacementType: null,
      selectedFixtureId: null,
    }),

  placeItem: async (roomId, roomX, roomY) => {
    const { placementItemId, placementVariantId, placedFurniture } = get()
    if (!placementItemId || !placementVariantId) return

    const catalogState = useCatalogStore.getState()
    const variants = catalogState.getVariantsForItem(placementItemId)
    const variant = variants.find((v) => v.id === placementVariantId)
    const price = variant?.price_thb ?? null

    const { data, error } = await supabase
      .from('placed_furniture')
      .insert({
        room_id: roomId,
        furniture_item_id: placementItemId,
        selected_variant_id: placementVariantId,
        x: roomX,
        y: roomY,
        direction: 'front_left' as Direction,
        price_at_placement: price,
        sort_order: placedFurniture.length,
      })
      .select()
      .single()

    if (error) {
      console.error('placeItem:', error)
      return
    }

    const placed = data as PlacedFurniture
    set((state) => ({
      placedFurniture: [...state.placedFurniture, placed],
      placementMode: false,
      placementItemId: null,
      placementVariantId: null,
      selectedItemId: placed.id,
    }))
  },

  cancelPlacement: () =>
    set({ placementMode: false, placementItemId: null, placementVariantId: null, fixturePlacementType: null }),

  // ─── Selection ────────────────────────────────────────────────────────────

  setSelectedItem: (id) => set({ selectedItemId: id, selectedFixtureId: id ? null : get().selectedFixtureId }),

  // ─── Manipulation ─────────────────────────────────────────────────────────

  moveItem: (id, roomX, roomY) => {
    set((state) => ({
      placedFurniture: state.placedFurniture.map((item) =>
        item.id === id ? { ...item, x: roomX, y: roomY } : item
      ),
    }))
    supabase
      .from('placed_furniture')
      .update({ x: roomX, y: roomY })
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.error('moveItem DB:', error)
      })
  },

  rotateItem: (id) => {
    const item = get().placedFurniture.find((i) => i.id === id)
    if (!item) return
    const nextDir = DIRECTIONS[(DIRECTIONS.indexOf(item.direction) + 1) % 4]
    set((state) => ({
      placedFurniture: state.placedFurniture.map((i) =>
        i.id === id ? { ...i, direction: nextDir } : i
      ),
    }))
    supabase
      .from('placed_furniture')
      .update({ direction: nextDir })
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.error('rotateItem DB:', error)
      })
  },

  switchVariant: (id, variantId, price) => {
    set((state) => ({
      placedFurniture: state.placedFurniture.map((i) =>
        i.id === id
          ? { ...i, selected_variant_id: variantId, price_at_placement: price }
          : i
      ),
    }))
    supabase
      .from('placed_furniture')
      .update({ selected_variant_id: variantId, price_at_placement: price })
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.error('switchVariant DB:', error)
      })
  },

  removeItem: async (id) => {
    const { error } = await supabase.from('placed_furniture').delete().eq('id', id)
    if (error) {
      console.error('removeItem:', error)
      return
    }
    set((state) => ({
      placedFurniture: state.placedFurniture.filter((i) => i.id !== id),
      selectedItemId: state.selectedItemId === id ? null : state.selectedItemId,
    }))
  },

  // ─── Room Rotation ────────────────────────────────────────────────────────

  setRoomRotation: (direction) => set({ roomRotation: direction }),

  // ─── Drag ─────────────────────────────────────────────────────────────────

  setDragging: (val) => set({ isDragging: val }),

  // ─── Fixture Placement (doors/windows) ──────────────────────────────────

  setFixturePlacementMode: (type) => set({
    fixturePlacementType: type,
    placementMode: false,
    placementItemId: null,
    placementVariantId: null,
    selectedItemId: null,
    selectedFixtureId: null,
  }),

  setSelectedFixture: (id) => set({
    selectedFixtureId: id,
    selectedItemId: null,
  }),

  // ─── Shape Edit Mode ──────────────────────────────────────────────────

  setShapeEditMode: (val) => set({
    shapeEditMode: val,
    selectedVertexIndex: null,
    selectedItemId: null,
    selectedFixtureId: null,
    placementMode: false,
    fixturePlacementType: null,
  }),

  setSelectedVertex: (idx) => set({ selectedVertexIndex: idx }),
}))
