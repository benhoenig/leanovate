import { create } from 'zustand'
import type { Profile } from '@/types'
import { supabase, rawSelect } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  profile: Profile | null
  isLoading: boolean
  isInitialized: boolean

  // Actions
  initialize: () => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  loadProfile: (userId: string) => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  isLoading: true,
  isInitialized: false,

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        set({ user: session.user })
        await get().loadProfile(session.user.id)
      }
    } catch (error) {
      console.error('Auth initialization failed:', error)
    } finally {
      set({ isLoading: false, isInitialized: true })
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        set({ user: session.user })
        await get().loadProfile(session.user.id)
      } else if (event === 'SIGNED_OUT') {
        set({ user: null, profile: null })
      }
    })
  },

  signUp: async (email, password, displayName) => {
    set({ isLoading: true })
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
        },
      })
      if (error) return { error: error.message }
      if (data.user) {
        set({ user: data.user })
        await get().loadProfile(data.user.id)
      }
      return { error: null }
    } catch (error) {
      return { error: 'An unexpected error occurred' }
    } finally {
      set({ isLoading: false })
    }
  },

  signIn: async (email, password) => {
    set({ isLoading: true })
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error: error.message }
      if (data.user) {
        set({ user: data.user })
        await get().loadProfile(data.user.id)
      }
      return { error: null }
    } catch (error) {
      return { error: 'An unexpected error occurred' }
    } finally {
      set({ isLoading: false })
    }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, profile: null })
  },

  loadProfile: async (userId: string) => {
    // rawSelect (raw fetch) to avoid supabase client deadlock (CLAUDE.md #8).
    // loadProfile runs on SIGNED_IN + page refresh init, can overlap with
    // any other mount-time read in the app.
    const { data, error } = await rawSelect<Profile>(
      'profiles',
      `id=eq.${userId}`,
    )

    if (error) {
      console.error('Failed to load profile:', error)
      return
    }
    const row = data?.[0]
    if (row) set({ profile: row })
  },
}))
