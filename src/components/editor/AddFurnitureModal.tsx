import { useState, useRef, useCallback, useEffect } from 'react'
import { X, Link, Loader2, Upload, Plus, Trash2, ChevronRight } from 'lucide-react'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useUIStore } from '@/stores/useUIStore'
import { supabase } from '@/lib/supabase'

interface Props {
  onClose: () => void
}

// ── Scraped data shape (matches edge function response) ───────────────────────
interface ScrapedData {
  name: string
  description: string
  price_thb: number | null
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  source_domain: string
}

// ── Variant form state ────────────────────────────────────────────────────────
interface VariantDraft {
  id: string // local draft id
  color_name: string
  price_thb: string
  source_url: string
  file: File | null
  previewUrl: string | null
  uploading: boolean
  uploadedUrl: string | null
  error: string | null
}

function newVariantDraft(): VariantDraft {
  return {
    id: crypto.randomUUID(),
    color_name: '',
    price_thb: '',
    source_url: '',
    file: null,
    previewUrl: null,
    uploading: false,
    uploadedUrl: null,
    error: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AddFurnitureModal({ onClose }: Props) {
  const { categories, styles, createItem, createVariant, triggerBackgroundRemoval, loadVariantsForItem, loadCategories, loadStyles } = useCatalogStore()

  // Ensure categories and styles are loaded (in case modal opens before CatalogPanel mounts)
  useEffect(() => {
    if (categories.length === 0) loadCategories()
    if (styles.length === 0) loadStyles()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const { showToast } = useUIStore()

  // ── Step 1 state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1)
  const [url, setUrl] = useState('')
  const [isScraping, setIsScraping] = useState(false)
  const [scraped, setScraped] = useState<ScrapedData | null>(null)
  const [scrapeError, setScrapeError] = useState<string | null>(null)

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

  // ─── Step 1: Scrape ─────────────────────────────────────────────────────────

  const handleScrape = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    setScrapeError(null)
    setIsScraping(true)
    try {
      const { data, error } = await supabase.functions.invoke('scrape-product', {
        body: { url: trimmed },
      })
      if (error || data?.error) {
        setScrapeError(data?.error ?? error?.message ?? 'Scrape failed')
        // Still let designer proceed with manual entry
        const domain = extractDomain(trimmed)
        setScraped({ name: '', description: '', price_thb: null, width_cm: null, depth_cm: null, height_cm: null, source_domain: domain })
      } else {
        const result = data as ScrapedData
        setScraped(result)
        setName(result.name || '')
        setDescription(result.description || '')
        if (result.price_thb != null) {
          // Pre-fill in first variant
          setVariants((prev) => {
            const updated = [...prev]
            updated[0] = { ...updated[0], price_thb: String(result.price_thb) }
            return updated
          })
        }
        if (result.width_cm != null) setWidthCm(String(result.width_cm))
        if (result.depth_cm != null) setDepthCm(String(result.depth_cm))
        if (result.height_cm != null) setHeightCm(String(result.height_cm))
      }
    } catch (err) {
      setScrapeError('Could not reach the scraper. Fill in details manually.')
      const domain = extractDomain(trimmed)
      setScraped({ name: '', description: '', price_thb: null, width_cm: null, depth_cm: null, height_cm: null, source_domain: domain })
    } finally {
      setIsScraping(false)
    }
  }

  const handleStep1Submit = async () => {
    if (!name.trim() || !categoryId) return
    setIsSavingItem(true)
    try {
      const domain = scraped?.source_domain ?? extractDomain(url)
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

  const handleVariantImageSelect = useCallback((draftId: string, file: File) => {
    const previewUrl = URL.createObjectURL(file)
    setVariants((prev) =>
      prev.map((v) => (v.id === draftId ? { ...v, file, previewUrl, uploadedUrl: null, error: null } : v))
    )
  }, [])

  const handleAddVariant = () => {
    setVariants((prev) => [...prev, newVariantDraft()])
  }

  const handleRemoveVariant = (draftId: string) => {
    setVariants((prev) => prev.filter((v) => v.id !== draftId))
  }

  const handleSaveVariants = async () => {
    if (!createdItemId) return
    const validVariants = variants.filter((v) => v.color_name.trim() && v.file)
    if (validVariants.length === 0) {
      showToast('Add at least one color variant with an image', 'warning')
      return
    }

    setIsSavingVariants(true)
    const createdVariantIds: string[] = []
    try {
      for (let i = 0; i < validVariants.length; i++) {
        const draft = validVariants[i]

        // Mark as uploading
        setVariants((prev) =>
          prev.map((v) => (v.id === draft.id ? { ...v, uploading: true } : v))
        )

        // Upload image
        console.log(`[SaveVariants] Uploading image for variant ${i + 1}…`)
        const { url: imageUrl, error: uploadError } = await useCatalogStore.getState().uploadVariantImage(
          `${createdItemId}_${draft.id}`,
          draft.file!
        )
        console.log(`[SaveVariants] Upload result:`, { imageUrl: !!imageUrl, uploadError })
        if (uploadError || !imageUrl) {
          setVariants((prev) =>
            prev.map((v) => (v.id === draft.id ? { ...v, uploading: false, error: uploadError ?? 'Upload failed' } : v))
          )
          continue
        }

        // Create variant row
        console.log(`[SaveVariants] Creating variant row…`)
        const { id: variantId, error: createError } = await createVariant({
          furniture_item_id: createdItemId,
          color_name: draft.color_name.trim(),
          original_image_url: imageUrl,
          price_thb: draft.price_thb ? Number(draft.price_thb) : undefined,
          source_url: draft.source_url.trim() || undefined,
          sort_order: i,
        })
        console.log(`[SaveVariants] Variant created:`, { variantId, createError })

        if (createError || !variantId) {
          setVariants((prev) =>
            prev.map((v) => (v.id === draft.id ? { ...v, uploading: false, error: createError ?? 'Failed' } : v))
          )
          continue
        }

        createdVariantIds.push(variantId)
        setVariants((prev) =>
          prev.map((v) => (v.id === draft.id ? { ...v, uploading: false, uploadedUrl: imageUrl } : v))
        )
      }

      // 1. Load variants first (no concurrent ops)
      console.log('[SaveVariants] Loading variants…')
      await loadVariantsForItem(createdItemId)
      console.log('[SaveVariants] Variants loaded, closing modal')
      showToast('Furniture added! Background removal running…', 'success')
      onClose()

      // 2. THEN trigger background removal (after modal closed, no concurrency)
      for (const vid of createdVariantIds) {
        triggerBackgroundRemoval(vid).catch(console.warn)
      }
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
            {/* URL + Scrape */}
            <div className="field-group">
              <label className="field-label">Product Link (optional)</label>
              <div className="url-row">
                <div className="url-input-wrap">
                  <Link size={13} className="url-icon" />
                  <input
                    className="url-input"
                    placeholder="https://shopee.co.th/… or https://ikea.com/…"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setScraped(null); setScrapeError(null) }}
                    onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
                  />
                </div>
                <button
                  className="scrape-btn"
                  onClick={handleScrape}
                  disabled={!url.trim() || isScraping}
                >
                  {isScraping ? <Loader2 size={13} className="spin" /> : 'Scrape Details'}
                </button>
              </div>
              {scrapeError && (
                <p className="field-hint error">{scrapeError} — fill in details manually below.</p>
              )}
              {scraped && !scrapeError && (
                <p className="field-hint success">Details scraped from {scraped.source_domain}. Review and edit below.</p>
              )}
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
              Add one or more color variants. Each variant gets its own image, and will go through background removal automatically.
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

                  <div className="variant-fields">
                    {/* Image upload */}
                    <div className="variant-image-slot">
                      <input
                        ref={(el) => { fileInputRefs.current[draft.id] = el }}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleVariantImageSelect(draft.id, file)
                          e.target.value = ''
                        }}
                      />
                      {draft.previewUrl ? (
                        <div
                          className="variant-image-preview"
                          onClick={() => fileInputRefs.current[draft.id]?.click()}
                        >
                          <img src={draft.previewUrl} alt="variant" />
                          {draft.uploading && (
                            <div className="variant-image-overlay">
                              <Loader2 size={16} className="spin" />
                            </div>
                          )}
                          {draft.uploadedUrl && (
                            <div className="variant-image-overlay success-overlay">✓</div>
                          )}
                        </div>
                      ) : (
                        <button
                          className="variant-image-upload-btn"
                          onClick={() => fileInputRefs.current[draft.id]?.click()}
                        >
                          <Upload size={18} />
                          <span>Upload image</span>
                          <span className="variant-image-hint">Crop to product only</span>
                        </button>
                      )}
                    </div>

                    {/* Text fields */}
                    <div className="variant-text-fields">
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
                disabled={isSavingVariants || variants.every((v) => !v.color_name.trim() || !v.file)}
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

        .url-row {
          display: flex;
          gap: 8px;
        }
        .url-input-wrap {
          flex: 1;
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
        .scrape-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 8px 14px;
          border-radius: 8px;
          background: var(--color-primary-brand);
          color: white;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          border: none;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s;
        }
        .scrape-btn:hover:not(:disabled) { background: var(--color-primary-brand-hover); }
        .scrape-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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
