import { create } from 'zustand'

interface TemplateState {
  // State — to be fully implemented in Phase 5
  isLoading: boolean

  // Placeholder actions
  setLoading: (loading: boolean) => void
}

export const useTemplateStore = create<TemplateState>((set) => ({
  isLoading: false,

  setLoading: (loading) => set({ isLoading: loading }),
}))
