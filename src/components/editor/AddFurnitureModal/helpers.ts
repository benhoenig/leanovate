// ── Extracted data shape (matches edge function response) ─────────────────────
export interface ExtractedData {
  name: string
  description: string
  price_thb: number | null
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  source_domain: string
}

// ── Variant form state ────────────────────────────────────────────────────────

export interface ImageDraft {
  id: string                  // local draft id for list keys
  file: File
  previewUrl: string
}

export interface VariantDraft {
  id: string // local draft id
  color_name: string
  price_thb: string
  source_url: string
  images: ImageDraft[]        // 1+ images; order matters — first is the primary/fallback
  uploading: boolean
  uploadedCount: number       // how many images finished uploading (UI progress)
  done: boolean               // true once variant row was created
  error: string | null
}

export function newVariantDraft(): VariantDraft {
  return {
    id: crypto.randomUUID(),
    color_name: '',
    price_thb: '',
    source_url: '',
    images: [],
    uploading: false,
    uploadedCount: 0,
    done: false,
    error: null,
  }
}

export function newImageDraft(file: File): ImageDraft {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}
