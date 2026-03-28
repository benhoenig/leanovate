import { create } from 'zustand'

type SidebarTab = 'rooms' | 'catalog' | 'templates'
type RightPanelTab = 'properties' | 'cost'

interface UIState {
  // Sidebar
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void

  // Right panel
  rightPanelTab: RightPanelTab
  setRightPanelTab: (tab: RightPanelTab) => void

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
