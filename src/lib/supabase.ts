import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env.local file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Bypass navigator.locks which can hang in some environments
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lock: ((_name: string, _acquireTimeout: number, fn: () => Promise<any>) => fn()) as any,
  },
})

// ── Raw fetch helpers ────────────────────────────────────────────────────────
// The Supabase JS client deadlocks when two async ops run through it
// concurrently (e.g. CatalogPanel polling + a write). Use these raw fetch
// helpers for ALL writes/uploads/edge-function calls to bypass the client.
// See CLAUDE.md Key Rule #8.

export const SUPABASE_URL = supabaseUrl
export const SUPABASE_ANON_KEY = supabaseAnonKey

export function getAuthToken(): string {
  let token = supabaseAnonKey
  try {
    const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.access_token) token = parsed.access_token
    }
  } catch { /* fall back to anon key */ }
  return token
}

/**
 * Read via raw fetch (bypassing the Supabase JS client to avoid deadlocks
 * with concurrent client calls — see CLAUDE.md Key Rule #8).
 *
 *   rawSelect('furniture_variants', 'id=in.(uuid1,uuid2)')
 *   rawSelect('rooms', 'project_id=eq.<id>', 'id,name,geometry')
 */
export async function rawSelect<T>(
  table: string,
  filter: string,
  columns: string = '*',
): Promise<{ data: T[] | null; error: string | null }> {
  const token = getAuthToken()
  try {
    const url = `${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(columns)}&${filter}`
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    })
    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[rawSelect] ${table} failed:`, resp.status, text)
      return { data: null, error: text || `HTTP ${resp.status}` }
    }
    const arr = await resp.json()
    return { data: arr as T[], error: null }
  } catch (err) {
    console.error(`[rawSelect] ${table} network error:`, err)
    return { data: null, error: String(err) }
  }
}

export async function rawInsert<T>(table: string, row: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const token = getAuthToken()
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    })
    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[rawInsert] ${table} failed:`, resp.status, text)
      return { data: null, error: text || `HTTP ${resp.status}` }
    }
    const arr = await resp.json()
    return { data: (Array.isArray(arr) ? arr[0] : arr) as T, error: null }
  } catch (err) {
    console.error(`[rawInsert] ${table} network error:`, err)
    return { data: null, error: String(err) }
  }
}

export async function rawUpdate(table: string, id: string, updates: Record<string, unknown>): Promise<{ error: string | null }> {
  return rawUpdateWhere(table, `id=eq.${id}`, updates)
}

/**
 * Update rows matching an arbitrary PostgREST filter string.
 * Example filter: `id=eq.abc-123` or `room_id=eq.xyz&furniture_item_id=eq.def`
 */
export async function rawUpdateWhere(table: string, filter: string, updates: Record<string, unknown>): Promise<{ error: string | null }> {
  const token = getAuthToken()
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(updates),
    })
    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[rawUpdateWhere] ${table} failed:`, resp.status, text)
      return { error: text || `HTTP ${resp.status}` }
    }
    return { error: null }
  } catch (err) {
    console.error(`[rawUpdateWhere] ${table} network error:`, err)
    return { error: String(err) }
  }
}

export async function rawDelete(table: string, id: string): Promise<{ error: string | null }> {
  return rawDeleteWhere(table, `id=eq.${id}`)
}

/**
 * Delete rows matching an arbitrary PostgREST filter string.
 * Example filter: `room_id=eq.xyz`
 */
export async function rawDeleteWhere(table: string, filter: string): Promise<{ error: string | null }> {
  const token = getAuthToken()
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    })
    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[rawDeleteWhere] ${table} failed:`, resp.status, text)
      return { error: text || `HTTP ${resp.status}` }
    }
    return { error: null }
  } catch (err) {
    console.error(`[rawDeleteWhere] ${table} network error:`, err)
    return { error: String(err) }
  }
}

/**
 * Insert multiple rows in one request.
 */
export async function rawInsertMany<T>(table: string, rows: Record<string, unknown>[]): Promise<{ data: T[] | null; error: string | null }> {
  const token = getAuthToken()
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(rows),
    })
    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[rawInsertMany] ${table} failed:`, resp.status, text)
      return { data: null, error: text || `HTTP ${resp.status}` }
    }
    const arr = await resp.json()
    return { data: arr as T[], error: null }
  } catch (err) {
    console.error(`[rawInsertMany] ${table} network error:`, err)
    return { data: null, error: String(err) }
  }
}

/**
 * Upload a file/blob to a Supabase Storage bucket via raw fetch.
 * Set `upsert: true` to overwrite existing files.
 * Returns the public URL (constructed from bucket + path — no extra round trip).
 */
export async function rawStorageUpload(bucket: string, path: string, body: Blob | File | ArrayBuffer, options?: { contentType?: string; upsert?: boolean }): Promise<{ publicUrl: string | null; error: string | null }> {
  const token = getAuthToken()
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
    }
    if (options?.contentType) headers['Content-Type'] = options.contentType
    if (options?.upsert) headers['x-upsert'] = 'true'

    const resp = await fetch(
      `${supabaseUrl}/storage/v1/object/${bucket}/${path}`,
      { method: 'POST', headers, body: body as BodyInit }
    )
    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[rawStorageUpload] ${bucket}/${path} failed:`, resp.status, text)
      return { publicUrl: null, error: text || `HTTP ${resp.status}` }
    }
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`
    return { publicUrl, error: null }
  } catch (err) {
    console.error(`[rawStorageUpload] ${bucket}/${path} network error:`, err)
    return { publicUrl: null, error: String(err) }
  }
}

/**
 * Download a file from a Supabase Storage bucket as a Blob via raw fetch.
 * Works for both public and authenticated buckets (auth header is always sent).
 */
export async function rawStorageDownload(bucket: string, path: string): Promise<{ blob: Blob | null; error: string | null }> {
  const token = getAuthToken()
  try {
    const resp = await fetch(
      `${supabaseUrl}/storage/v1/object/${bucket}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
        },
      }
    )
    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[rawStorageDownload] ${bucket}/${path} failed:`, resp.status, text)
      return { blob: null, error: text || `HTTP ${resp.status}` }
    }
    const blob = await resp.blob()
    return { blob, error: null }
  } catch (err) {
    console.error(`[rawStorageDownload] ${bucket}/${path} network error:`, err)
    return { blob: null, error: String(err) }
  }
}

/**
 * Build a public URL for a file in a Supabase Storage bucket.
 * Synchronous, no network call. Use for sprites, textures, etc.
 */
export function getPublicStorageUrl(bucket: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`
}
