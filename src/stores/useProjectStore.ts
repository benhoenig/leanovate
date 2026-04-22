import { create } from 'zustand'
import type { Project, Room, FinishMaterial } from '@/types'
import { rawSelect, rawInsert, rawUpdate, rawDelete } from '@/lib/supabase'
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
    // rawSelect (raw fetch) instead of supabase.from() to avoid the Supabase
    // JS client lock (CLAUDE.md #8). The dashboard mounts fresh whenever the
    // designer navigates back from the editor or admin, and any other
    // in-flight client op (auth refresh, editor-side queries still winding
    // down) can silently hang this load. Raw fetch bypasses the lock.
    set({ isLoading: true })
    try {
      const profile = useAuthStore.getState().profile
      const filter = profile?.role === 'admin'
        ? 'order=created_at.desc'
        : `owner_id=eq.${profile?.id ?? ''}&order=created_at.desc`
      const { data, error } = await rawSelect<Project>('projects', filter)
      if (error) throw new Error(error)
      set({ projects: data ?? [] })
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
    // rawSelect instead of supabase.from() to avoid the Supabase JS client
    // lock (CLAUDE.md #8). EditorPage mounts fresh when the designer clicks
    // into a project, and any lingering client op from the dashboard or a
    // previous editor session can silently hang both queries here.
    set({ isLoading: true })
    try {
      const [projectRes, roomsRes] = await Promise.all([
        rawSelect<Project>('projects', `id=eq.${id}`),
        rawSelect<Room>('rooms', `project_id=eq.${id}&order=sort_order.asc`),
      ])
      if (projectRes.error) throw new Error(projectRes.error)
      if (roomsRes.error) throw new Error(roomsRes.error)
      const project = projectRes.data?.[0] ?? null
      const rooms = roomsRes.data ?? []
      set({
        currentProject: project,
        rooms,
        selectedRoomId: rooms[0]?.id ?? null,
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
    // rawSelect for the same reason as loadProjects/loadProject — EditorPage
    // mounts fresh and this runs right alongside loadProject; the JS client
    // lock could silently hang both queries.
    const { data, error } = await rawSelect<FinishMaterial>(
      'finish_materials',
      'order=type.asc',
    )
    if (error) {
      console.error('Failed to load finish materials:', error)
      return
    }
    set({ finishMaterials: data ?? [] })
  },
}))
