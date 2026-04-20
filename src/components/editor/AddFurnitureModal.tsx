import { useState, useRef, useCallback, useEffect } from 'react'
import { X, Link, Loader2, Upload, Plus, Trash2, ChevronRight, Camera, ImageIcon } from 'lucide-react'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useUIStore } from '@/stores/useUIStore'

interface Props {
  onClose: () => void
}

// ── Extracted data shape (matches edge function response) ─────────────────────
interface ExtractedData {
  name: string
  description: string
  price_thb: number | null
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  source_domain: string
}

// ── Variant form state ────────────────────────────────────────────────────────

interface ImageDraft {
  id: string                  // local draft id for list keys
  file: File
  previewUrl: string
}

interface VariantDraft {
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

function newVariantDraft(): VariantDraft {
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

function newImageDraft(file: File): ImageDraft {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AddFurnitureModal({ onClose }: Props) {
  const { categories, styles, createItem, createVariant, loadCategories, loadStyles } = useCatalogStore()

  // Ensure categories and styles are loaded (in case modal opens before CatalogPanel mounts)
  useEffect(() => {
    if (categories.length === 0) loadCategories()
    if (styles.length === 0) loadStyles()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const { showToast } = useUIStore()

  // ── Step 1 state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1)
  const [url, setUrl] = useState('')
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null)
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedData | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const screenshotInputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Editable fields (pre-filled from scrape)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [selectedStyles, setSelectedStyles] = useState<string[]>([])
  const [widthCm, setWidthCm] = useState('')
  const [depthCm, setDepthCm] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [isSavingItem, setIsSavingItem] = useState(false)
  const [createdItemId, setCreatedItemId] = useState<string | null>(null)

  // ── Step 2 state ────────────────────────────────────────────────────────────
  const [variants, setVariants] = useState<VariantDraft[]>([newVariantDraft()])
  const [isSavingVariants, setIsSavingVariants] = useState(false)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Revoke object URLs when drafts are removed/replaced
  useEffect(() => {
    return () => {
      for (const v of variants) {
        for (const img of v.images) URL.revokeObjectURL(img.previewUrl)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Step 1: Screenshot extraction ──────────────────────────────────────────

  const handleScreenshotSelect = (file: File) => {
    setScreenshotFile(file)
    setScreenshotPreview(URL.createObjectURL(file))
    setExtracted(null)
    setExtractError(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      handleScreenshotSelect(file)
    }
  }

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          handleScreenshotSelect(file)
          break
        }
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  const handleExtract = async () => {
    if (!screenshotFile) return
    setExtractError(null)
    setIsExtracting(true)
    console.log('[Extract] Starting extraction from screenshot…')
    try {
      // Convert file to base64
      const buffer = await screenshotFile.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )

      const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
      const SUPA_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
      let token = SUPA_ANON
      try {
        const storageKey = `sb-${new URL(SUPA_URL).hostname.split('.')[0]}-auth-token`
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          const accessToken = parsed?.access_token ?? parsed?.currentSession?.access_token ?? parsed?.session?.access_token
          const expiresAt = parsed?.expires_at ?? 0
          const now = Math.floor(Date.now() / 1000)
          if (accessToken && expiresAt > now + 30) {
            token = accessToken
          }
        }
      } catch { /* fall back to anon key */ }

      const resp = await fetch(`${SUPA_URL}/functions/v1/extract-from-screenshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SUPA_ANON,
        },
        body: JSON.stringify({
          image_base64: base64,
          media_type: screenshotFile.type || 'image/png',
        }),
      })

      console.log('[Extract] Response status:', resp.status)
      if (!resp.ok) {
        const text = await resp.text()
        console.error('[Extract] HTTP error:', resp.status, text)
        setExtractError(`Extraction failed (HTTP ${resp.status})`)
        return
      }

      const data = await resp.json()
      console.log('[Extract] Response data:', data)

      if (data?.error) {
        console.warn('[Extract] Server returned error:', data.error)
        setExtractError(data.error)
      } else {
        const result = data as ExtractedData
        console.log('[Extract] Success — name:', result.name, '| price:', result.price_thb, '| dims:', result.width_cm, '×', result.depth_cm, '×', result.height_cm)
        setExtracted(result)
        if (result.name) setName(result.name)
        if (result.description) setDescription(result.description)
        if (result.price_thb != null) {
          setVariants((prev) => {
            const updated = [...prev]
            updated[0] = { ...updated[0], price_thb: String(result.price_thb ?? '') }
            return updated
          })
        }
        if (result.width_cm != null) setWidthCm(String(result.width_cm))
        if (result.depth_cm != null) setDepthCm(String(result.depth_cm))
        if (result.height_cm != null) setHeightCm(String(result.height_cm))
      }
    } catch (err) {
      console.error('[Extract] Network/fetch error:', err)
      setExtractError('Could not reach the extraction service. Fill in details manually.')
    } finally {
      setIsExtracting(false)
      console.log('[Extract] Done')
    }
  }

  const handleStep1Submit = async () => {
    if (!name.trim() || !categoryId) return
    setIsSavingItem(true)
    try {
      const domain = url.trim() ? extractDomain(url) : 'manual'
      console.log('[AddFurniture] Creating item…', { name: name.trim(), categoryId, domain })
      const { id, error } = await createItem({
        name: name.trim(),
        category_id: categoryId,
        source_url: url.trim(),
        source_domain: domain,
        description: description.trim() || undefined,
        width_cm: widthCm ? Number(widthCm) : undefined,
        depth_cm: depthCm ? Number(depthCm) : undefined,
        height_cm: heightCm ? Number(heightCm) : undefined,
      })
      console.log('[AddFurniture] createItem result:', { id, error })
      if (error || !id) {
        showToast(error ?? 'Failed to save item', 'error')
        return
      }
      // Set style tags
      if (selectedStyles.length > 0) {
        await useCatalogStore.getState().setItemStyles(id, selectedStyles)
      }
      setCreatedItemId(id)
      setStep(2)
    } catch (err) {
      console.error('[AddFurniture] Unexpected error:', err)
      showToast('Something went wrong: ' + String(err), 'error')
    } finally {
      setIsSavingItem(false)
    }
  }

  // ─── Step 2: Variants ───────────────────────────────────────────────────────

  const handleVariantImagesAdd = useCallback((draftId: string, files: FileList) => {
    const newImages: ImageDraft[] = []
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) newImages.push(newImageDraft(f))
    }
    if (newImages.length === 0) return
    setVariants((prev) =>
      prev.map((v) =>
        v.id === draftId
          ? { ...v, images: [...v.images, ...newImages], error: null }
          : v
      )
    )
  }, [])

  const handleVariantImageRemove = (draftId: string, imageId: string) => {
    setVariants((prev) =>
      prev.map((v) => {
        if (v.id !== draftId) return v
        const removed = v.images.find((img) => img.id === imageId)
        if (removed) URL.revokeObjectURL(removed.previewUrl)
        return { ...v, images: v.images.filter((img) => img.id !== imageId) }
      })
    )
  }

  const handleVariantImageReorder = (draftId: string, imageId: string, dir: 'left' | 'right') => {
    setVariants((prev) =>
      prev.map((v) => {
        if (v.id !== draftId) return v
        const idx = v.images.findIndex((img) => img.id === imageId)
        if (idx === -1) return v
        const target = dir === 'left' ? idx - 1 : idx + 1
        if (target < 0 || target >= v.images.length) return v
        const images = [...v.images]
        ;[images[idx], images[target]] = [images[target], images[idx]]
        return { ...v, images }
      })
    )
  }

  const handleAddVariant = () => {
    setVariants((prev) => [...prev, newVariantDraft()])
  }

  const handleRemoveVariant = (draftId: string) => {
    setVariants((prev) => {
      const target = prev.find((v) => v.id === draftId)
      if (target) for (const img of target.images) URL.revokeObjectURL(img.previewUrl)
      return prev.filter((v) => v.id !== draftId)
    })
  }

  const handleSaveVariants = async () => {
    if (!createdItemId) return
    const validVariants = variants.filter((v) => v.color_name.trim() && v.images.length > 0)
    if (validVariants.length === 0) {
      showToast('Add at least one color variant with an image', 'warning')
      return
    }

    setIsSavingVariants(true)
    try {
      for (let i = 0; i < validVariants.length; i++) {
        const draft = validVariants[i]

        setVariants((prev) =>
          prev.map((v) => (v.id === draft.id ? { ...v, uploading: true, uploadedCount: 0 } : v))
        )

        // Upload all images for this variant (sequential — avoids Supabase rate limits on shared anon token)
        const imageUrls: string[] = []
        let uploadError: string | null = null
        for (let j = 0; j < draft.images.length; j++) {
          const img = draft.images[j]
          const { url: imageUrl, error } = await useCatalogStore.getState().uploadVariantImage(
            `${createdItemId}_${draft.id}`,
            img.file
          )
          if (error || !imageUrl) {
            uploadError = error ?? 'Upload failed'
            break
          }
          imageUrls.push(imageUrl)
          setVariants((prev) =>
            prev.map((v) => (v.id === draft.id ? { ...v, uploadedCount: j + 1 } : v))
          )
        }

        if (uploadError) {
          setVariants((prev) =>
            prev.map((v) => (v.id === draft.id ? { ...v, uploading: false, error: uploadError } : v))
          )
          continue
        }

        // Create variant row — this also kicks off the TRELLIS pipeline
        // (unless the item is flat, in which case the catalog store skips it).
        const { id: variantId, error: createError } = await createVariant({
          furniture_item_id: createdItemId,
          color_name: draft.color_name.trim(),
          original_image_urls: imageUrls,
          price_thb: draft.price_thb ? Number(draft.price_thb) : undefined,
          source_url: draft.source_url.trim() || undefined,
          sort_order: i,
        })

        if (createError || !variantId) {
          setVariants((prev) =>
            prev.map((v) => (v.id === draft.id ? { ...v, uploading: false, error: createError ?? 'Failed' } : v))
          )
          continue
        }

        setVariants((prev) =>
          prev.map((v) => (v.id === draft.id ? { ...v, uploading: false, done: true } : v))
        )
      }

      const isFlat = useCatalogStore.getState().isItemFlat(createdItemId)
      showToast(
        isFlat
          ? 'Flat item added — ready to place on canvas.'
          : 'Furniture added! Generating 3D models…',
        'success'
      )
      onClose()
    } catch (err) {
      console.error('[SaveVariants] Unexpected error:', err)
      showToast('Something went wrong: ' + String(err), 'error')
    } finally {
      setIsSavingVariants(false)
    }
  }

  // ─── Toggle style ──────────────────────────────────────────────────────────
  const toggleStyle = (styleId: string) => {
    setSelectedStyles((prev) =>
      prev.includes(styleId) ? prev.filter((s) => s !== styleId) : [...prev, styleId]
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-step-badge">Step {step} of 2</span>
            <h2 className="modal-title">
              {step === 1 ? 'Add Furniture — Product Details' : 'Add Color Variants'}
            </h2>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div className="modal-body">
            {/* Screenshot drop zone */}
            <div className="field-group">
              <label className="field-label">Product Screenshot</label>
              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleScreenshotSelect(file)
                  e.target.value = ''
                }}
              />
              {screenshotPreview ? (
                <div className="screenshot-preview-wrap">
                  <img src={screenshotPreview} alt="Product screenshot" className="screenshot-preview-img" />
                  <div className="screenshot-preview-actions">
                    <button
                      className="screenshot-change-btn"
                      onClick={() => screenshotInputRef.current?.click()}
                    >
                      <ImageIcon size={12} />
                      Change
                    </button>
                    <button
                      className="btn-primary extract-btn"
                      onClick={handleExtract}
                      disabled={isExtracting}
                    >
                      {isExtracting ? <Loader2 size={13} className="spin" /> : <Camera size={13} />}
                      {isExtracting ? 'Extracting…' : 'Extract Details'}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`screenshot-drop-zone ${isDragging ? 'dragging' : ''}`}
                  onClick={() => screenshotInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <Camera size={24} />
                  <span className="screenshot-drop-title">Drop product screenshot here</span>
                  <span className="screenshot-drop-hint">or click to upload — also supports Ctrl+V paste</span>
                  <span className="screenshot-drop-hint">Works with Shopee, IKEA, or any furniture site</span>
                </div>
              )}
              {extractError && (
                <p className="field-hint error">{extractError} — fill in details manually below.</p>
              )}
              {extracted && !extractError && (
                <p className="field-hint success">Details extracted from screenshot. Review and edit below.</p>
              )}
            </div>

            {/* Product Link (reference for purchasing) */}
            <div className="field-group">
              <label className="field-label">Product Link (for purchasing reference)</label>
              <div className="url-input-wrap">
                <Link size={13} className="url-icon" />
                <input
                  className="url-input"
                  placeholder="https://shopee.co.th/… or https://ikea.com/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            </div>

            {/* Name */}
            <div className="field-group">
              <label className="field-label">Product Name *</label>
              <input
                className="field-input"
                placeholder="e.g. KIVIK Sofa"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Category */}
            <div className="field-group">
              <label className="field-label">Category *</label>
              <select
                className="field-input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Select category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div className="field-group">
              <label className="field-label">Description</label>
              <textarea
                className="field-input field-textarea"
                placeholder="Product description…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            {/* Dimensions */}
            <div className="field-row-3">
              <div className="field-group">
                <label className="field-label">Width (cm)</label>
                <input className="field-input" type="number" placeholder="—" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">Depth (cm)</label>
                <input className="field-input" type="number" placeholder="—" value={depthCm} onChange={(e) => setDepthCm(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">Height (cm)</label>
                <input className="field-input" type="number" placeholder="—" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
              </div>
            </div>

            {/* Style tags */}
            <div className="field-group">
              <label className="field-label">Style Tags</label>
              <div className="style-pills-wrap">
                {styles.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`style-pill ${selectedStyles.includes(s.id) ? 'active' : ''}`}
                    onClick={() => toggleStyle(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="modal-footer">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn-primary"
                onClick={handleStep1Submit}
                disabled={!name.trim() || !categoryId || isSavingItem}
              >
                {isSavingItem ? <Loader2 size={13} className="spin" /> : null}
                Save & Add Colors
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="modal-body">
            <p className="step2-hint">
              Add one or more color variants. For each variant, upload 2–4 clean product shots from different angles — this
              is the biggest quality lever for 3D generation. The first image is used as the placeholder until the 3D
              model is ready.
            </p>

            <div className="variants-list">
              {variants.map((draft, idx) => (
                <div key={draft.id} className="variant-card">
                  <div className="variant-header">
                    <span className="variant-num">Variant {idx + 1}</span>
                    {variants.length > 1 && (
                      <button className="variant-remove-btn" onClick={() => handleRemoveVariant(draft.id)}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  {/* Images row */}
                  <div className="field-group">
                    <label className="field-label">Product Images ({draft.images.length})</label>
                    <input
                      ref={(el) => { fileInputRefs.current[draft.id] = el }}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleVariantImagesAdd(draft.id, e.target.files)
                        }
                        e.target.value = ''
                      }}
                    />
                    <div className="variant-images-row">
                      {draft.images.map((img, imgIdx) => (
                        <div key={img.id} className="variant-image-thumb">
                          <img src={img.previewUrl} alt={`img ${imgIdx + 1}`} />
                          {imgIdx === 0 && <span className="variant-image-primary">1st</span>}
                          <div className="variant-image-thumb-actions">
                            {imgIdx > 0 && (
                              <button
                                className="variant-image-reorder-btn"
                                title="Move left"
                                onClick={() => handleVariantImageReorder(draft.id, img.id, 'left')}
                              >
                                ◀
                              </button>
                            )}
                            {imgIdx < draft.images.length - 1 && (
                              <button
                                className="variant-image-reorder-btn"
                                title="Move right"
                                onClick={() => handleVariantImageReorder(draft.id, img.id, 'right')}
                              >
                                ▶
                              </button>
                            )}
                            <button
                              className="variant-image-remove-btn"
                              title="Remove"
                              onClick={() => handleVariantImageRemove(draft.id, img.id)}
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                          {draft.uploading && imgIdx < draft.uploadedCount && (
                            <div className="variant-image-overlay success-overlay">✓</div>
                          )}
                          {draft.uploading && imgIdx === draft.uploadedCount && (
                            <div className="variant-image-overlay">
                              <Loader2 size={14} className="spin" />
                            </div>
                          )}
                        </div>
                      ))}
                      <button
                        className="variant-image-add-btn"
                        onClick={() => fileInputRefs.current[draft.id]?.click()}
                        disabled={draft.uploading}
                      >
                        <Upload size={16} />
                        <span>Add images</span>
                      </button>
                    </div>
                    {draft.images.length === 0 && (
                      <span className="field-hint">
                        Upload clean product shots (front, 3/4 angle, side) for best results.
                      </span>
                    )}
                  </div>

                  {/* Text fields */}
                  <div className="field-group">
                    <label className="field-label">Color Name *</label>
                    <input
                      className="field-input"
                      placeholder="e.g. Navy Blue, Oak Natural…"
                      value={draft.color_name}
                      onChange={(e) =>
                        setVariants((prev) =>
                          prev.map((v) => (v.id === draft.id ? { ...v, color_name: e.target.value } : v))
                        )
                      }
                    />
                  </div>
                  <div className="field-row-2">
                    <div className="field-group">
                      <label className="field-label">Price (฿)</label>
                      <input
                        className="field-input"
                        type="number"
                        placeholder="Optional"
                        value={draft.price_thb}
                        onChange={(e) =>
                          setVariants((prev) =>
                            prev.map((v) => (v.id === draft.id ? { ...v, price_thb: e.target.value } : v))
                          )
                        }
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label">Variant Link</label>
                      <input
                        className="field-input"
                        placeholder="Optional"
                        value={draft.source_url}
                        onChange={(e) =>
                          setVariants((prev) =>
                            prev.map((v) => (v.id === draft.id ? { ...v, source_url: e.target.value } : v))
                          )
                        }
                      />
                    </div>
                  </div>

                  {draft.error && <p className="variant-error">{draft.error}</p>}
                </div>
              ))}

              <button className="add-variant-btn" onClick={handleAddVariant}>
                <Plus size={14} />
                Add Another Color
              </button>
            </div>

            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
              <button
                className="btn-primary"
                onClick={handleSaveVariants}
                disabled={isSavingVariants || variants.every((v) => !v.color_name.trim() || v.images.length === 0)}
              >
                {isSavingVariants ? <Loader2 size={13} className="spin" /> : null}
                Save Variants
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
        }
        .modal-box {
          background: var(--color-panel-bg);
          border-radius: 14px;
          width: 100%;
          max-width: 520px;
          max-height: 90dvh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 8px 32px rgba(0,0,0,0.2);
          overflow: hidden;
        }
        .modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 16px 18px 12px;
          border-bottom: 1px solid var(--color-border-custom);
          flex-shrink: 0;
        }
        .modal-title-wrap {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .modal-step-badge {
          font-size: 10px;
          font-weight: 600;
          color: var(--color-primary-brand);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .modal-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--color-text-primary);
          margin: 0;
        }
        .modal-close-btn {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
        }
        .modal-close-btn:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }
        .modal-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .field-group {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .field-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .field-input {
          padding: 8px 10px;
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
          background: var(--color-input-bg);
          font-size: 13px;
          font-family: inherit;
          color: var(--color-text-primary);
          outline: none;
          transition: border-color 0.15s;
          width: 100%;
          box-sizing: border-box;
        }
        .field-input:focus {
          border-color: var(--color-primary-brand);
        }
        .field-textarea {
          resize: vertical;
          min-height: 72px;
        }
        .field-row-3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
        }
        .field-row-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .field-hint {
          font-size: 11px;
          margin: 0;
        }
        .field-hint.error { color: var(--color-error); }
        .field-hint.success { color: var(--color-success); }

        .screenshot-drop-zone {
          border: 2px dashed var(--color-border-custom);
          border-radius: 10px;
          padding: 24px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          color: var(--color-text-secondary);
          background: var(--color-input-bg);
          transition: all 0.15s;
        }
        .screenshot-drop-zone:hover, .screenshot-drop-zone.dragging {
          border-color: var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
        }
        .screenshot-drop-title {
          font-size: 13px;
          font-weight: 600;
          margin-top: 4px;
        }
        .screenshot-drop-hint {
          font-size: 11px;
          opacity: 0.7;
        }
        .screenshot-preview-wrap {
          border: 1px solid var(--color-border-custom);
          border-radius: 10px;
          overflow: hidden;
          background: var(--color-card-bg);
        }
        .screenshot-preview-img {
          width: 100%;
          max-height: 180px;
          object-fit: contain;
          display: block;
          background: var(--color-input-bg);
        }
        .screenshot-preview-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          border-top: 1px solid var(--color-border-custom);
        }
        .screenshot-change-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid var(--color-border-custom);
          background: none;
          color: var(--color-text-secondary);
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
        }
        .screenshot-change-btn:hover {
          border-color: var(--color-primary-brand);
          color: var(--color-primary-brand);
        }
        .extract-btn {
          padding: 6px 14px;
          font-size: 12px;
        }

        .url-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .url-icon {
          position: absolute;
          left: 9px;
          color: var(--color-text-secondary);
          pointer-events: none;
        }
        .url-input {
          width: 100%;
          padding: 8px 10px 8px 30px;
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
          background: var(--color-input-bg);
          font-size: 12px;
          font-family: inherit;
          color: var(--color-text-primary);
          outline: none;
        }
        .url-input:focus { border-color: var(--color-primary-brand); }

        .style-pills-wrap {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .style-pill {
          padding: 4px 12px;
          border-radius: 6px;
          border: 1.5px solid var(--color-border-custom);
          background: transparent;
          font-size: 11px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          color: var(--color-text-secondary);
          transition: all 0.15s;
        }
        .style-pill.active {
          border-color: var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 4px;
        }
        .btn-ghost {
          padding: 8px 16px;
          border-radius: 8px;
          border: none;
          background: none;
          color: var(--color-text-secondary);
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
        }
        .btn-ghost:hover { background: var(--color-hover-bg); }
        .btn-primary {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 8px 18px;
          border-radius: 8px;
          border: none;
          background: var(--color-primary-brand);
          color: white;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-primary:hover:not(:disabled) { background: var(--color-primary-brand-hover); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Step 2 */
        .step2-hint {
          font-size: 12px;
          color: var(--color-text-secondary);
          line-height: 1.5;
          margin: 0;
        }
        .variants-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .variant-card {
          border: 1px solid var(--color-border-custom);
          border-radius: 10px;
          padding: 12px;
          background: var(--color-card-bg);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .variant-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .variant-num {
          font-size: 11px;
          font-weight: 700;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .variant-remove-btn {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 3px;
          border-radius: 4px;
          display: flex;
        }
        .variant-remove-btn:hover {
          color: var(--color-error);
          background: rgba(229,77,66,0.08);
        }
        .variant-fields {
          display: flex;
          gap: 12px;
        }
        .variant-images-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .variant-image-thumb {
          position: relative;
          width: 72px;
          height: 72px;
          border-radius: 8px;
          overflow: hidden;
          background: var(--color-hover-bg);
          border: 1px solid var(--color-border-custom);
        }
        .variant-image-thumb img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .variant-image-primary {
          position: absolute;
          top: 3px;
          left: 3px;
          background: var(--color-primary-brand);
          color: white;
          font-size: 8px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 3px;
          letter-spacing: 0.3px;
        }
        .variant-image-thumb-actions {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 2px;
          background: rgba(0,0,0,0.55);
          opacity: 0;
          transition: opacity 0.15s;
        }
        .variant-image-thumb:hover .variant-image-thumb-actions {
          opacity: 1;
        }
        .variant-image-reorder-btn,
        .variant-image-remove-btn {
          background: rgba(255,255,255,0.9);
          border: none;
          border-radius: 3px;
          font-size: 9px;
          color: var(--color-text-primary);
          cursor: pointer;
          padding: 2px 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: inherit;
        }
        .variant-image-remove-btn:hover {
          background: var(--color-error);
          color: white;
        }
        .variant-image-add-btn {
          width: 72px;
          height: 72px;
          border-radius: 8px;
          border: 1.5px dashed var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          cursor: pointer;
          font-family: inherit;
          font-size: 9px;
          font-weight: 600;
          transition: all 0.15s;
        }
        .variant-image-add-btn:hover:not(:disabled) {
          background: rgba(43, 168, 160, 0.12);
        }
        .variant-image-add-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .variant-image-slot {
          width: 90px;
          flex-shrink: 0;
        }
        .variant-image-upload-btn {
          width: 90px;
          height: 90px;
          border-radius: 8px;
          border: 1.5px dashed var(--color-border-custom);
          background: var(--color-hover-bg);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          cursor: pointer;
          color: var(--color-text-secondary);
          font-family: inherit;
          transition: all 0.15s;
        }
        .variant-image-upload-btn:hover {
          border-color: var(--color-primary-brand);
          color: var(--color-primary-brand);
          background: var(--color-primary-brand-light);
        }
        .variant-image-upload-btn span {
          font-size: 11px;
          font-weight: 600;
        }
        .variant-image-hint {
          font-size: 9px !important;
          font-weight: 400 !important;
          color: var(--color-text-secondary);
          text-align: center;
        }
        .variant-image-preview {
          width: 90px;
          height: 90px;
          border-radius: 8px;
          overflow: hidden;
          position: relative;
          cursor: pointer;
          background: var(--color-hover-bg);
        }
        .variant-image-preview img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .variant-image-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }
        .success-overlay {
          background: rgba(76, 175, 130, 0.7);
          font-size: 24px;
          font-weight: 700;
        }
        .variant-text-fields {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .variant-error {
          font-size: 11px;
          color: var(--color-error);
          margin: 0;
        }
        .add-variant-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px;
          border-radius: 10px;
          border: 1.5px dashed var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
          width: 100%;
        }
        .add-variant-btn:hover {
          background: rgba(43, 168, 160, 0.12);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 0.8s linear infinite;
        }
      `}</style>
    </div>
  )
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}
