import { create } from 'zustand'
import type { PlacedFurniture, Direction } from '@/types'

interface CanvasState {
  // State
  placedFurniture: PlacedFurniture[]
  selectedItemId: string | null
  placementMode: boolean
  placementItemId: string | null
  roomRotation: Direction

  // Actions — to be implemented in Phase 4
  setPlacedFurniture: (items: PlacedFurniture[]) => void
  setSelectedItem: (id: string | null) => void
  setPlacementMode: (active: boolean, itemId?: string) => void
  setRoomRotation: (direction: Direction) => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  placedFurniture: [],
  selectedItemId: null,
  placementMode: false,
  placementItemId: null,
  roomRotation: 'front_left',

  setPlacedFurniture: (items) => set({ placedFurniture: items }),
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setPlacementMode: (active, itemId) =>
    set({ placementMode: active, placementItemId: itemId ?? null }),
  setRoomRotation: (direction) => set({ roomRotation: direction }),
}))
