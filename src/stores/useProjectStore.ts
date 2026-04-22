import { create } from 'zustand'
import type { Project, Room, FinishMaterial } from '@/types'
import { supabase, rawInsert, rawUpdate, rawDelete } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'

interface ProjectState {
  // State
  projects: Project[]
  currentProject: Project | null
  rooms: Room[]
  selectedRoomId: string | null
  finishMaterials: FinishMaterial[]
  isDirty: boolean
  isLoading: boolean

  // Actions
  loadProjects: () => Promise<void>
  createProject: (name: string, description?: string) => Promise<{ id: string | null; error: string | null }>
  updateProject: (id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'manual_costs' | 'unit_width_cm' | 'unit_height_cm' | 'thumbnail_path'>>) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  loadProject: (id: string) => Promise<void>
  addRoom: (projectId: string, name: string) => Promise<{ id: string | null; error: string | null }>
  updateRoom: (id: string, updates: Partial<Pick<Room, 'name' | 'width_cm' | 'height_cm' | 'ceiling_height_cm' | 'geometry' | 'finishes' | 'sort_order'>>) => Promise<void>
  deleteRoom: (id: string) => Promise<void>
  saveProject: () => Promise<void>
  setSelectedRoom: (id: string | null) => void
  loadFinishMaterials: () => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  rooms: [],
  selectedRoomId: null,
  finishMaterials: [],
  isDirty: false,
  isLoading: false,

  loadProjects: async () => {
    set({ isLoading: true })
    try {
      const profile = useAuthStore.getState().profile
      let query = supabase.from('projects').select('*').order('created_at', { ascending: false })
      if (profile?.role !== 'admin') {
        query = query.eq('owner_id', profile?.id ?? '')
      }
      const { data, error } = await query
      if (error) throw error
      set({ projects: data as Project[] })
    } catch (error) {
      console.error('Failed to load projects:', error)
    } finally {
      set({ isLoading: false })
    }
  },

  createProject: async (name, description) => {
    const profile = useAuthStore.getState().profile
    if (!profile) return { id: null, error: 'Not authenticated' }
    try {
      const { data, error } = await rawInsert<Project>('projects', {
        name,
        description: description ?? null,
        owner_id: profile.id,
        status: 'draft',
        unit_width_cm: 1000,
        unit_height_cm: 800,
        manual_costs: {},
      })
      if (error || !data) return { id: null, error: error ?? 'Insert failed' }
      await get().loadProjects()
      return { id: data.id, error: null }
    } catch {
      return { id: null, error: 'Failed to create project' }
    }
  },

  updateProject: async (id, updates) => {
    const { error } = await rawUpdate('projects', id, updates)
    if (error) {
      console.error('Failed to update project:', error)
      return
    }
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      currentProject: state.currentProject?.id === id ? { ...state.currentProject, ...updates } : state.currentProject,
      isDirty: false,
    }))
  },

  deleteProject: async (id) => {
    const { error } = await rawDelete('projects', id)
    if (error) {
      console.error('Failed to delete project:', error)
      return
    }
    set((state) => ({ projects: state.projects.filter((p) => p.id !== id) }))
  },

  loadProject: async (id) => {
    set({ isLoading: true })
    try {
      const [projectRes, roomsRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id).single(),
        supabase.from('rooms').select('*').eq('project_id', id).order('sort_order', { ascending: true }),
      ])
      if (projectRes.error) throw projectRes.error
      if (roomsRes.error) throw roomsRes.error
      set({
        currentProject: projectRes.data as Project,
        rooms: roomsRes.data as Room[],
        selectedRoomId: (roomsRes.data as Room[])[0]?.id ?? null,
        isDirty: false,
      })
    } catch (error) {
      console.error('Failed to load project:', error)
    } finally {
      set({ isLoading: false })
    }
  },

  addRoom: async (projectId, name) => {
    const roomCount = get().rooms.length
    try {
      const { data, error } = await rawInsert<Room>('rooms', {
        project_id: projectId,
        name,
        x: 0,
        y: 0,
        width_cm: 300,
        height_cm: 300,
        ceiling_height_cm: 260,
        geometry: { walls: [], doors: [], windows: [] },
        finishes: {},
        sort_order: roomCount,
      })
      if (error || !data) return { id: null, error: error ?? 'Insert failed' }
      set((state) => ({ rooms: [...state.rooms, data], selectedRoomId: data.id, isDirty: false }))
      return { id: data.id, error: null }
    } catch {
      return { id: null, error: 'Failed to add room' }
    }
  },

  updateRoom: async (id, updates) => {
    set((state) => ({
      rooms: state.rooms.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      isDirty: true,
    }))
    const { error } = await rawUpdate('rooms', id, updates)
    if (error) {
      console.error('Failed to update room:', error)
    }
  },

  deleteRoom: async (id) => {
    const { error } = await rawDelete('rooms', id)
    if (error) {
      console.error('Failed to delete room:', error)
      return
    }
    set((state) => {
      const remaining = state.rooms.filter((r) => r.id !== id)
      const newSelected = state.selectedRoomId === id ? (remaining[0]?.id ?? null) : state.selectedRoomId
      return { rooms: remaining, selectedRoomId: newSelected, isDirty: false }
    })
  },

  saveProject: async () => {
    const { currentProject, rooms } = get()
    if (!currentProject) return
    set({ isLoading: true })
    try {
      // Sequential to avoid Supabase client concurrency deadlock
      for (const r of rooms) {
        await rawUpdate('rooms', r.id, {
          name: r.name,
          width_cm: r.width_cm,
          height_cm: r.height_cm,
          geometry: r.geometry,
          finishes: r.finishes,
          sort_order: r.sort_order,
        })
      }
      set({ isDirty: false })
      useAuthStore.getState() // keep reference, toast shown by caller
    } catch (error) {
      console.error('Failed to save project:', error)
    } finally {
      set({ isLoading: false })
    }
  },

  setSelectedRoom: (id) => set({ selectedRoomId: id }),

  loadFinishMaterials: async () => {
    const { data, error } = await supabase
      .from('finish_materials')
      .select('*')
      .order('type', { ascending: true })
    if (error) {
      console.error('Failed to load finish materials:', error)
      return
    }
    set({ finishMaterials: data as FinishMaterial[] })
  },
}))
