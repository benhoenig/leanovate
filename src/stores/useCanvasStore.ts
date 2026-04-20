import { create } from 'zustand'
import type { PlacedFurniture, RoomGeometry } from '@/types'
import type { RoomRotation } from '@/lib/roomGeometry'
import { supabase, rawInsert, rawInsertMany, rawUpdate, rawDelete, rawDeleteWhere } from '@/lib/supabase'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useProjectStore } from '@/stores/useProjectStore'

// ── Undo/Redo Command Types ──────────────────────────────────────────────

interface PlaceCommand { type: 'place'; item: PlacedFurniture }
interface RemoveCommand { type: 'remove'; item: PlacedFurniture }
interface MoveCommand { type: 'move'; itemId: string; prevX: number; prevY: number; nextX: number; nextY: number }
interface RotateCommand { type: 'rotate'; itemId: string; prevRotationDeg: number; nextRotationDeg: number }
interface ScaleCommand { type: 'scale'; itemId: string; prevScale: number; nextScale: number }
interface SwitchVariantCommand { type: 'switchVariant'; itemId: string; prevVariantId: string; prevPrice: number | null; nextVariantId: string; nextPrice: number | null }
interface GeometryCommand { type: 'geometry'; roomId: string; prevGeometry: RoomGeometry; nextGeometry: RoomGeometry; prevWidthCm: number; prevHeightCm: number; nextWidthCm: number; nextHeightCm: number }

type CanvasCommand = PlaceCommand | RemoveCommand | MoveCommand | RotateCommand | ScaleCommand | SwitchVariantCommand | GeometryCommand

const MAX_HISTORY = 50

interface CanvasState {
  // ─ Data ─────────────────────────────────────────────────────────────────
  placedFurniture: PlacedFurniture[]
  selectedItemId: string | null        // id of selected PlacedFurniture
  placementMode: boolean
  placementItemId: string | null       // furniture_item_id to place
  placementVariantId: string | null    // default variant for placement
  roomRotation: RoomRotation
  isDragging: boolean
  isPanning: boolean

  // Fixture (door/window) placement
  fixturePlacementType: 'door' | 'window' | null
  selectedFixtureId: string | null

  // Shape edit mode
  shapeEditMode: boolean
  selectedVertexIndex: number | null

  // Undo/Redo
  undoStack: CanvasCommand[]
  redoStack: CanvasCommand[]
  canUndo: boolean
  canRedo: boolean
  isUndoRedoInProgress: boolean

  // Zoom/Pan
  displayZoom: number
  zoomIn: () => void
  zoomOut: () => void
  fitToRoom: () => void

  // ─ Actions ──────────────────────────────────────────────────────────────

  loadPlacedFurniture: (roomId: string) => Promise<void>
  savePlacedFurniture: () => Promise<void>
  placeItems: (items: Array<{ roomId: string; furnitureItemId: string; variantId: string; x_cm: number; z_cm: number; rotation_deg: number }>) => Promise<void>
  clearRoomFurniture: (roomId: string) => Promise<void>

  setPlacementMode: (active: boolean, itemId?: string, variantId?: string) => void
  placeItem: (roomId: string, roomX: number, roomY: number) => Promise<void>
  cancelPlacement: () => void

  setSelectedItem: (id: string | null) => void

  moveItem: (id: string, roomX: number, roomY: number) => void
  /** Increment rotation by 90° (legacy keyboard rotate) */
  rotateItem: (id: string) => void
  /** Set rotation to a specific angle in degrees (0–360 normalized). Pushes one undo command per `commitRotation` call. */
  setItemRotation: (id: string, deg: number) => void
  /** Push an undo command after continuous rotation (e.g. scroll-wheel drag). */
  commitRotation: (id: string, prevDeg: number) => void
  scaleItem: (id: string, scaleFactor: number) => void
  switchVariant: (id: string, variantId: string, price: number | null) => void
  removeItem: (id: string) => Promise<void>

  commitMove: (id: string, prevX: number, prevY: number) => void
  commitScale: (id: string, prevScale: number) => void
  pushGeometryCommand: (roomId: string, prevGeo: RoomGeometry, nextGeo: RoomGeometry, prevW: number, prevH: number, nextW: number, nextH: number) => void
  undo: () => Promise<void>
  redo: () => Promise<void>

  setRoomRotation: (rotation: RoomRotation) => void
  setDragging: (val: boolean) => void
  setIsPanning: (val: boolean) => void

  setFixturePlacementMode: (type: 'door' | 'window' | null) => void
  setSelectedFixture: (id: string | null) => void

  setShapeEditMode: (val: boolean) => void
  setSelectedVertex: (idx: number | null) => void

  setDisplayZoom: (z: number) => void
  setZoomFunctions: (fns: { zoomIn: () => void; zoomOut: () => void; fitToRoom: () => void }) => void
}

// ── History helper ────────────────────────────────────────────────────────────

function pushCommand(
  set: (fn: (s: CanvasState) => Partial<CanvasState>) => void,
  _get: () => CanvasState,
  cmd: CanvasCommand,
) {
  set((s) => {
    const newUndo = [...s.undoStack, cmd]
    if (newUndo.length > MAX_HISTORY) newUndo.shift()
    return { undoStack: newUndo, redoStack: [], canUndo: true, canRedo: false }
  })
}

const CLEAR_HISTORY = { undoStack: [] as CanvasCommand[], redoStack: [] as CanvasCommand[], canUndo: false, canRedo: false }

export const useCanvasStore = create<CanvasState>((set, get) => ({
  placedFurniture: [],
  selectedItemId: null,
  placementMode: false,
  placementItemId: null,
  placementVariantId: null,
  roomRotation: 'front_left',
  isDragging: false,
  isPanning: false,
  fixturePlacementType: null,
  selectedFixtureId: null,
  shapeEditMode: false,
  selectedVertexIndex: null,

  // Undo/Redo
  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,
  isUndoRedoInProgress: false,

  // Zoom/Pan
  displayZoom: 1.0,
  zoomIn: () => {},
  zoomOut: () => {},
  fitToRoom: () => {},

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
    set({ placedFurniture: data as PlacedFurniture[], selectedItemId: null, ...CLEAR_HISTORY })
  },

  savePlacedFurniture: async () => {
    const { placedFurniture } = get()
    for (const item of placedFurniture) {
      const { error } = await rawUpdate('placed_furniture', item.id, {
        x_cm: item.x_cm,
        y_cm: item.y_cm,
        z_cm: item.z_cm,
        rotation_deg: item.rotation_deg,
        selected_variant_id: item.selected_variant_id,
        price_at_placement: item.price_at_placement,
        scale_factor: item.scale_factor,
        sort_order: item.sort_order,
      })
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
        x_cm: item.x_cm,
        y_cm: 0,
        z_cm: item.z_cm,
        rotation_deg: item.rotation_deg,
        price_at_placement: variant?.price_thb ?? null,
        sort_order: placedFurniture.length + i,
      }
    })
    const { data, error } = await rawInsertMany<PlacedFurniture>('placed_furniture', rows)
    if (error || !data) {
      console.error('placeItems:', error)
      return
    }
    set((state) => ({
      placedFurniture: [...state.placedFurniture, ...data],
      ...CLEAR_HISTORY,
    }))
  },

  clearRoomFurniture: async (roomId) => {
    const { error } = await rawDeleteWhere('placed_furniture', `room_id=eq.${roomId}`)
    if (error) {
      console.error('clearRoomFurniture:', error)
      return
    }
    set({ placedFurniture: [], selectedItemId: null, ...CLEAR_HISTORY })
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

    // Use raw fetch to avoid Supabase client concurrency hang (CLAUDE.md #8)
    const { data: placed, error } = await rawInsert<PlacedFurniture>('placed_furniture', {
      room_id: roomId,
      furniture_item_id: placementItemId,
      selected_variant_id: placementVariantId,
      x_cm: roomX,
      y_cm: 0,
      z_cm: roomY,
      rotation_deg: 0,
      price_at_placement: price,
      sort_order: placedFurniture.length,
    })

    if (error || !placed) {
      console.error('placeItem:', error)
      return
    }
    set((state) => ({
      placedFurniture: [...state.placedFurniture, placed],
      placementMode: false,
      placementItemId: null,
      placementVariantId: null,
      selectedItemId: placed.id,
    }))
    pushCommand(set, get, { type: 'place', item: placed })
  },

  cancelPlacement: () =>
    set({ placementMode: false, placementItemId: null, placementVariantId: null, fixturePlacementType: null }),

  // ─── Selection ────────────────────────────────────────────────────────────

  setSelectedItem: (id) => set({ selectedItemId: id, selectedFixtureId: id ? null : get().selectedFixtureId }),

  // ─── Manipulation ─────────────────────────────────────────────────────────

  moveItem: (id, roomX, roomY) => {
    set((state) => ({
      placedFurniture: state.placedFurniture.map((item) =>
        item.id === id ? { ...item, x_cm: roomX, z_cm: roomY } : item
      ),
    }))
    rawUpdate('placed_furniture', id, { x_cm: roomX, z_cm: roomY }).then(({ error }) => {
      if (error) console.error('moveItem DB:', error)
    })
  },

  scaleItem: (id, scaleFactor) => {
    set((state) => ({
      placedFurniture: state.placedFurniture.map((i) =>
        i.id === id ? { ...i, scale_factor: scaleFactor } : i
      ),
    }))
    useProjectStore.setState({ isDirty: true })
    rawUpdate('placed_furniture', id, { scale_factor: scaleFactor }).then(({ error }) => {
      if (error) console.error('scaleItem DB:', error)
    })
  },

  rotateItem: (id) => {
    const item = get().placedFurniture.find((i) => i.id === id)
    if (!item) return
    const prevRot = item.rotation_deg
    const nextRot = (prevRot + 90) % 360
    set((state) => ({
      placedFurniture: state.placedFurniture.map((i) =>
        i.id === id ? { ...i, rotation_deg: nextRot } : i
      ),
    }))
    rawUpdate('placed_furniture', id, { rotation_deg: nextRot }).then(({ error }) => {
      if (error) console.error('rotateItem DB:', error)
    })
    pushCommand(set, get, { type: 'rotate', itemId: id, prevRotationDeg: prevRot, nextRotationDeg: nextRot })
  },

  setItemRotation: (id, deg) => {
    // Normalize to [0, 360)
    const normalized = ((deg % 360) + 360) % 360
    set((state) => ({
      placedFurniture: state.placedFurniture.map((i) =>
        i.id === id ? { ...i, rotation_deg: normalized } : i
      ),
    }))
    rawUpdate('placed_furniture', id, { rotation_deg: normalized }).then(({ error }) => {
      if (error) console.error('setItemRotation DB:', error)
    })
  },

  commitRotation: (id, prevDeg) => {
    const item = get().placedFurniture.find((i) => i.id === id)
    if (!item || item.rotation_deg === prevDeg) return
    pushCommand(set, get, { type: 'rotate', itemId: id, prevRotationDeg: prevDeg, nextRotationDeg: item.rotation_deg })
  },

  switchVariant: (id, variantId, price) => {
    const item = get().placedFurniture.find((i) => i.id === id)
    if (!item) return
    const prevVariantId = item.selected_variant_id
    const prevPrice = item.price_at_placement
    set((state) => ({
      placedFurniture: state.placedFurniture.map((i) =>
        i.id === id
          ? { ...i, selected_variant_id: variantId, price_at_placement: price }
          : i
      ),
    }))
    rawUpdate('placed_furniture', id, { selected_variant_id: variantId, price_at_placement: price }).then(({ error }) => {
      if (error) console.error('switchVariant DB:', error)
    })
    pushCommand(set, get, { type: 'switchVariant', itemId: id, prevVariantId, prevPrice, nextVariantId: variantId, nextPrice: price })
  },

  removeItem: async (id) => {
    const item = get().placedFurniture.find((i) => i.id === id)
    if (!item) return
    const snapshot = { ...item }
    const { error } = await rawDelete('placed_furniture', id)
    if (error) {
      console.error('removeItem:', error)
      return
    }
    set((state) => ({
      placedFurniture: state.placedFurniture.filter((i) => i.id !== id),
      selectedItemId: state.selectedItemId === id ? null : state.selectedItemId,
    }))
    pushCommand(set, get, { type: 'remove', item: snapshot })
  },

  // ─── Undo/Redo Commit Helpers ──────────────────────────────────────────────

  commitMove: (id, prevX, prevY) => {
    const item = get().placedFurniture.find((i) => i.id === id)
    if (!item || (item.x_cm === prevX && item.z_cm === prevY)) return
    pushCommand(set, get, { type: 'move', itemId: id, prevX, prevY, nextX: item.x_cm, nextY: item.z_cm })
  },

  commitScale: (id, prevScale) => {
    const item = get().placedFurniture.find((i) => i.id === id)
    if (!item || item.scale_factor === prevScale) return
    pushCommand(set, get, { type: 'scale', itemId: id, prevScale, nextScale: item.scale_factor })
  },

  pushGeometryCommand: (roomId, prevGeo, nextGeo, prevW, prevH, nextW, nextH) => {
    pushCommand(set, get, {
      type: 'geometry', roomId,
      prevGeometry: prevGeo, nextGeometry: nextGeo,
      prevWidthCm: prevW, prevHeightCm: prevH, nextWidthCm: nextW, nextHeightCm: nextH,
    })
  },

  // ─── Undo/Redo ────────────────────────────────────────────────────────────

  undo: async () => {
    const { undoStack, redoStack, isUndoRedoInProgress } = get()
    if (undoStack.length === 0 || isUndoRedoInProgress) return
    set({ isUndoRedoInProgress: true })
    const cmd = undoStack[undoStack.length - 1]
    const newUndo = undoStack.slice(0, -1)

    try {
      switch (cmd.type) {
        case 'place': {
          await rawDelete('placed_furniture', cmd.item.id)
          set((s) => ({
            placedFurniture: s.placedFurniture.filter((i) => i.id !== cmd.item.id),
            selectedItemId: s.selectedItemId === cmd.item.id ? null : s.selectedItemId,
          }))
          break
        }
        case 'remove': {
          const { id: _oldId, created_at: _ca, ...insertData } = cmd.item
          const { data, error } = await rawInsert<PlacedFurniture>('placed_furniture', insertData)
          if (error || !data) { console.error('undo remove:', error); return }
          cmd.item = data
          set((s) => ({
            placedFurniture: [...s.placedFurniture, cmd.item],
            selectedItemId: cmd.item.id,
          }))
          break
        }
        case 'move': {
          set((s) => ({
            placedFurniture: s.placedFurniture.map((i) => i.id === cmd.itemId ? { ...i, x_cm: cmd.prevX, z_cm: cmd.prevY } : i),
          }))
          rawUpdate('placed_furniture', cmd.itemId, { x_cm: cmd.prevX, z_cm: cmd.prevY }).then(({ error }) => { if (error) console.error('undo move DB:', error) })
          break
        }
        case 'rotate': {
          set((s) => ({
            placedFurniture: s.placedFurniture.map((i) => i.id === cmd.itemId ? { ...i, rotation_deg: cmd.prevRotationDeg } : i),
          }))
          rawUpdate('placed_furniture', cmd.itemId, { rotation_deg: cmd.prevRotationDeg }).then(({ error }) => { if (error) console.error('undo rotate DB:', error) })
          break
        }
        case 'scale': {
          set((s) => ({
            placedFurniture: s.placedFurniture.map((i) => i.id === cmd.itemId ? { ...i, scale_factor: cmd.prevScale } : i),
          }))
          rawUpdate('placed_furniture', cmd.itemId, { scale_factor: cmd.prevScale }).then(({ error }) => { if (error) console.error('undo scale DB:', error) })
          break
        }
        case 'switchVariant': {
          set((s) => ({
            placedFurniture: s.placedFurniture.map((i) => i.id === cmd.itemId ? { ...i, selected_variant_id: cmd.prevVariantId, price_at_placement: cmd.prevPrice } : i),
          }))
          rawUpdate('placed_furniture', cmd.itemId, { selected_variant_id: cmd.prevVariantId, price_at_placement: cmd.prevPrice }).then(({ error }) => { if (error) console.error('undo switchVariant DB:', error) })
          break
        }
        case 'geometry': {
          useProjectStore.getState().updateRoom(cmd.roomId, {
            geometry: cmd.prevGeometry,
            width_cm: cmd.prevWidthCm,
            height_cm: cmd.prevHeightCm,
          })
          break
        }
      }
      set({ undoStack: newUndo, redoStack: [...redoStack, cmd], canUndo: newUndo.length > 0, canRedo: true })
    } finally {
      set({ isUndoRedoInProgress: false })
    }
  },

  redo: async () => {
    const { undoStack, redoStack, isUndoRedoInProgress } = get()
    if (redoStack.length === 0 || isUndoRedoInProgress) return
    set({ isUndoRedoInProgress: true })
    const cmd = redoStack[redoStack.length - 1]
    const newRedo = redoStack.slice(0, -1)

    try {
      switch (cmd.type) {
        case 'place': {
          const { id: _oldId, created_at: _ca, ...insertData } = cmd.item
          const { data, error } = await rawInsert<PlacedFurniture>('placed_furniture', insertData)
          if (error || !data) { console.error('redo place:', error); return }
          cmd.item = data
          set((s) => ({
            placedFurniture: [...s.placedFurniture, cmd.item],
            selectedItemId: cmd.item.id,
          }))
          break
        }
        case 'remove': {
          await rawDelete('placed_furniture', cmd.item.id)
          set((s) => ({
            placedFurniture: s.placedFurniture.filter((i) => i.id !== cmd.item.id),
            selectedItemId: s.selectedItemId === cmd.item.id ? null : s.selectedItemId,
          }))
          break
        }
        case 'move': {
          set((s) => ({
            placedFurniture: s.placedFurniture.map((i) => i.id === cmd.itemId ? { ...i, x_cm: cmd.nextX, z_cm: cmd.nextY } : i),
          }))
          rawUpdate('placed_furniture', cmd.itemId, { x_cm: cmd.nextX, z_cm: cmd.nextY }).then(({ error }) => { if (error) console.error('redo move DB:', error) })
          break
        }
        case 'rotate': {
          set((s) => ({
            placedFurniture: s.placedFurniture.map((i) => i.id === cmd.itemId ? { ...i, rotation_deg: cmd.nextRotationDeg } : i),
          }))
          rawUpdate('placed_furniture', cmd.itemId, { rotation_deg: cmd.nextRotationDeg }).then(({ error }) => { if (error) console.error('redo rotate DB:', error) })
          break
        }
        case 'scale': {
          set((s) => ({
            placedFurniture: s.placedFurniture.map((i) => i.id === cmd.itemId ? { ...i, scale_factor: cmd.nextScale } : i),
          }))
          rawUpdate('placed_furniture', cmd.itemId, { scale_factor: cmd.nextScale }).then(({ error }) => { if (error) console.error('redo scale DB:', error) })
          break
        }
        case 'switchVariant': {
          set((s) => ({
            placedFurniture: s.placedFurniture.map((i) => i.id === cmd.itemId ? { ...i, selected_variant_id: cmd.nextVariantId, price_at_placement: cmd.nextPrice } : i),
          }))
          rawUpdate('placed_furniture', cmd.itemId, { selected_variant_id: cmd.nextVariantId, price_at_placement: cmd.nextPrice }).then(({ error }) => { if (error) console.error('redo switchVariant DB:', error) })
          break
        }
        case 'geometry': {
          useProjectStore.getState().updateRoom(cmd.roomId, {
            geometry: cmd.nextGeometry,
            width_cm: cmd.nextWidthCm,
            height_cm: cmd.nextHeightCm,
          })
          break
        }
      }
      set({ undoStack: [...undoStack, cmd], redoStack: newRedo, canUndo: true, canRedo: newRedo.length > 0 })
    } finally {
      set({ isUndoRedoInProgress: false })
    }
  },

  // ─── Room Rotation ────────────────────────────────────────────────────────

  setRoomRotation: (direction) => set({ roomRotation: direction }),

  // ─── Drag ─────────────────────────────────────────────────────────────────

  setDragging: (val) => set({ isDragging: val }),
  setIsPanning: (val) => set({ isPanning: val }),

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

  // ─── Zoom/Pan ─────────────────────────────────────────────────────────

  setDisplayZoom: (z) => set({ displayZoom: z }),
  setZoomFunctions: (fns) => set({ zoomIn: fns.zoomIn, zoomOut: fns.zoomOut, fitToRoom: fns.fitToRoom }),
}))
