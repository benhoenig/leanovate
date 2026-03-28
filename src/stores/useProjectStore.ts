import { create } from 'zustand'
import type { Project, Room } from '@/types'

interface ProjectState {
  // State
  projects: Project[]
  currentProject: Project | null
  rooms: Room[]
  isDirty: boolean
  isLoading: boolean

  // Actions — to be implemented in Phase 2
  setProjects: (projects: Project[]) => void
  setCurrentProject: (project: Project | null) => void
  setRooms: (rooms: Room[]) => void
  setDirty: (dirty: boolean) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  rooms: [],
  isDirty: false,
  isLoading: false,

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (project) => set({ currentProject: project }),
  setRooms: (rooms) => set({ rooms }),
  setDirty: (dirty) => set({ isDirty: dirty }),
}))
