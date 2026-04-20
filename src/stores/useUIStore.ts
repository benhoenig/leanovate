import { create } from 'zustand'

export type SidebarTab = 'rooms' | 'finishes' | 'catalog' | 'templates'
type RightPanelTab = 'properties' | 'cost'
export type CameraMode = 'design' | 'roam'

const CANVAS_GRID_LS_KEY = 'leanovate.canvasGrid'

function readInitialGrid(): boolean {
  try {
    const stored = localStorage.getItem(CANVAS_GRID_LS_KEY)
    return stored === 'true'
  } catch {
    return false
  }
}

interface UIState {
  // Sidebar
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void

  // Right panel
  rightPanelTab: RightPanelTab
  setRightPanelTab: (tab: RightPanelTab) => void

  // Canvas grid visibility (toggleable, persisted to localStorage)
  canvasGrid: boolean
  setCanvasGrid: (on: boolean) => void

  // Camera mode: design (orbit) vs roam (first-person walkthrough)
  cameraMode: CameraMode
  setCameraMode: (mode: CameraMode) => void

  // Modals
  activeModal: string | null
  openModal: (id: string) => void
  closeModal: () => void

  // Toast notifications
  toast: { message: string; type: 'success' | 'error' | 'warning' } | null
  showToast: (message: string, type?: 'success' | 'error' | 'warning') => void
  clearToast: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarTab: 'rooms',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  rightPanelTab: 'properties',
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  canvasGrid: readInitialGrid(),
  setCanvasGrid: (on) => {
    set({ canvasGrid: on })
    try { localStorage.setItem(CANVAS_GRID_LS_KEY, String(on)) } catch { /* ignore quota errors */ }
  },

  // Session-local — no need to persist across tabs. Always starts in design.
  cameraMode: 'design',
  setCameraMode: (mode) => set({ cameraMode: mode }),

  activeModal: null,
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  toast: null,
  showToast: (message, type = 'success') => {
    set({ toast: { message, type } })
    setTimeout(() => set({ toast: null }), 4000)
  },
  clearToast: () => set({ toast: null }),
}))
