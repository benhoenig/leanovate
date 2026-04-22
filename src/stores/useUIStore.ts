import { create } from 'zustand'
import i18n, { type Language, SUPPORTED_LANGUAGES } from '@/lib/i18n'

export type SidebarTab = 'rooms' | 'finishes' | 'catalog' | 'fixtures' | 'templates'
type RightPanelTab = 'properties' | 'cost'
export type CameraMode = 'design' | 'roam'
export type AdminTab = 'pending' | 'catalog' | 'link-health' | 'team' | 'ai-usage'

const CANVAS_GRID_LS_KEY = 'leanovate.canvasGrid'
const STUDIO_LIGHTS_LS_KEY = 'leanovate.studioLights'

function readInitialGrid(): boolean {
  try {
    const stored = localStorage.getItem(CANVAS_GRID_LS_KEY)
    return stored === 'true'
  } catch {
    return false
  }
}

function readInitialStudioLights(): boolean {
  // Default on: new designers need the studio fill to see anything before
  // placing real fixtures. Once they're building real lighting, they flip it off.
  try {
    const stored = localStorage.getItem(STUDIO_LIGHTS_LS_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

function readInitialLanguage(): Language {
  const current = (i18n.resolvedLanguage || 'en') as Language
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(current) ? current : 'en'
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

  // Studio lighting rig (ambient + sun + fill). Helps new rooms read before
  // the designer places real fixtures; typically flipped off once real
  // ceiling/lamp lights are configured. Persisted to localStorage.
  studioLights: boolean
  setStudioLights: (on: boolean) => void

  // Camera mode: design (orbit) vs roam (first-person walkthrough)
  cameraMode: CameraMode
  setCameraMode: (mode: CameraMode) => void

  // Admin page active tab. Session-local so it survives incidental remounts
  // of AdminPage (e.g. auth-store profile refresh → ProtectedRoute re-eval).
  // Without this, local useState('pending') would reset every time the
  // route wrapper re-renders, snapping the user back to Pending.
  adminTab: AdminTab
  setAdminTab: (tab: AdminTab) => void

  // Shuffle / regenerate price filter — applies to both per-item
  // "Shuffle this" and whole-room "Regenerate." Session-local (not
  // persisted) — designers set a budget per presentation flow and
  // it resets on reload.
  shufflePriceCapEnabled: boolean
  shufflePriceCap: number       // baht per item
  setShufflePriceCapEnabled: (on: boolean) => void
  setShufflePriceCap: (baht: number) => void

  // Language (persisted to localStorage via i18next detector)
  language: Language
  setLanguage: (lang: Language) => void

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

  studioLights: readInitialStudioLights(),
  setStudioLights: (on) => {
    set({ studioLights: on })
    try { localStorage.setItem(STUDIO_LIGHTS_LS_KEY, String(on)) } catch { /* ignore quota errors */ }
  },

  // Session-local — no need to persist across tabs. Always starts in design.
  cameraMode: 'design',
  setCameraMode: (mode) => set({ cameraMode: mode }),

  adminTab: 'pending',
  setAdminTab: (tab) => set({ adminTab: tab }),

  shufflePriceCapEnabled: false,
  shufflePriceCap: 20000,
  setShufflePriceCapEnabled: (on) => set({ shufflePriceCapEnabled: on }),
  setShufflePriceCap: (baht) => set({ shufflePriceCap: Math.max(0, baht) }),

  language: readInitialLanguage(),
  setLanguage: (lang) => {
    set({ language: lang })
    i18n.changeLanguage(lang)
  },

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
