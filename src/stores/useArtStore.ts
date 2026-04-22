import { create } from 'zustand'
import { rawSelect, rawInsert, rawUpdate, rawDelete, rawStorageUpload, getPublicStorageUrl, getAuthToken } from '@/lib/supabase'
import { useAuthStore } from './useAuthStore'
import type { ArtImage, ArtScope } from '@/types'

interface ArtState {
  art: ArtImage[]
  isLoading: boolean
  error: string | null

  // Loaders
  loadArt: () => Promise<void>

  // Mutations
  uploadArt: (file: File, name: string) => Promise<{ art: ArtImage | null; error: string | null }>
  setScope: (id: string, scope: ArtScope) => Promise<{ error: string | null }>
  renameArt: (id: string, name: string) => Promise<{ error: string | null }>
  deleteArt: (id: string) => Promise<{ error: string | null }>

  // Selectors
  getArtById: (id: string | null | undefined) => ArtImage | null
  getMyArt: () => ArtImage[]
  getTeamArt: () => ArtImage[]
  getArtUrl: (art: ArtImage) => string
}

const BUCKET = 'frame-art'

/**
 * Measures the aspect ratio (width / height) of an image file by decoding it
 * in an offscreen <img>. Rejects on decode failure. The picker uses this to
 * filter art that fits a given frame's mat opening.
 */
async function measureAspectRatio(file: File): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        reject(new Error('Image decoded with zero dimensions'))
        return
      }
      resolve(img.naturalWidth / img.naturalHeight)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to decode image'))
    }
    img.src = url
  })
}

function inferExtension(file: File): string {
  const fromType = file.type.split('/')[1]?.toLowerCase()
  if (fromType === 'jpeg' || fromType === 'jpg') return 'jpg'
  if (fromType === 'png') return 'png'
  if (fromType === 'webp') return 'webp'
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName === 'jpg' || fromName === 'jpeg') return 'jpg'
  if (fromName === 'png') return 'png'
  if (fromName === 'webp') return 'webp'
  return 'jpg'
}

export const useArtStore = create<ArtState>((set, get) => ({
  art: [],
  isLoading: false,
  error: null,

  loadArt: async () => {
    // rawSelect — fires from useFurnitureLayer on editor mount, concurrently
    // with catalog + project loads. See CLAUDE.md #8.
    // RLS filters to: own private art + all team art (+ admin sees all).
    set({ isLoading: true, error: null })
    const { data, error } = await rawSelect<ArtImage>(
      'art_library',
      'order=created_at.desc',
    )
    if (error) {
      set({ isLoading: false, error })
      return
    }
    set({ art: data ?? [], isLoading: false })
  },

  uploadArt: async (file, name) => {
    const profile = useAuthStore.getState().profile
    if (!profile) return { art: null, error: 'Not authenticated' }

    let aspect: number
    try {
      aspect = await measureAspectRatio(file)
    } catch (err) {
      return { art: null, error: String(err) }
    }

    // Unique path — we'll know the row's id after insert, but to avoid a second
    // round-trip we pre-generate a UUID-like path prefix using crypto.randomUUID.
    const ext = inferExtension(file)
    const objectId = crypto.randomUUID()
    const path = `${profile.id}/${objectId}.${ext}`

    const { error: uploadErr } = await rawStorageUpload(BUCKET, path, file, {
      contentType: file.type || 'image/jpeg',
    })
    if (uploadErr) return { art: null, error: uploadErr }

    const row = {
      uploaded_by: profile.id,
      name: name.trim() || file.name.replace(/\.[^.]+$/, ''),
      image_path: path,
      aspect_ratio: aspect,
      scope: 'private' as ArtScope,
    }
    const { data, error } = await rawInsert<ArtImage>('art_library', row)
    if (error || !data) return { art: null, error: error ?? 'Insert failed' }

    set({ art: [data, ...get().art] })
    return { art: data, error: null }
  },

  setScope: async (id, scope) => {
    const { error } = await rawUpdate('art_library', id, { scope })
    if (error) return { error }
    set({
      art: get().art.map((a) => (a.id === id ? { ...a, scope } : a)),
    })
    return { error: null }
  },

  renameArt: async (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return { error: 'Name cannot be empty' }
    const { error } = await rawUpdate('art_library', id, { name: trimmed })
    if (error) return { error }
    set({
      art: get().art.map((a) => (a.id === id ? { ...a, name: trimmed } : a)),
    })
    return { error: null }
  },

  deleteArt: async (id) => {
    const target = get().art.find((a) => a.id === id)
    const { error } = await rawDelete('art_library', id)
    if (error) return { error }
    // Best-effort storage cleanup — row delete is the source of truth; leaving
    // an orphaned blob in the bucket is acceptable if this fails.
    if (target) {
      try {
        const token = getAuthToken()
        const supaUrl = import.meta.env.VITE_SUPABASE_URL as string
        const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
        await fetch(`${supaUrl}/storage/v1/object/${BUCKET}/${target.image_path}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}`, apikey: anon },
        })
      } catch {
        /* ignore */
      }
    }
    set({ art: get().art.filter((a) => a.id !== id) })
    return { error: null }
  },

  getArtById: (id) => {
    if (!id) return null
    return get().art.find((a) => a.id === id) ?? null
  },

  getMyArt: () => {
    const uid = useAuthStore.getState().profile?.id
    if (!uid) return []
    return get().art.filter((a) => a.uploaded_by === uid)
  },

  getTeamArt: () => get().art.filter((a) => a.scope === 'team'),

  getArtUrl: (art) => getPublicStorageUrl(BUCKET, art.image_path),
}))
