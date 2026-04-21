import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useRenderQueueStore } from '@/stores/useRenderQueueStore'
import { useUIStore } from '@/stores/useUIStore'
import Step1Form from './Step1Form'
import Step2Variants from './Step2Variants'
import type { ExtractedData, ImageDraft, VariantDraft } from './helpers'
import { newVariantDraft, newImageDraft, extractDomain } from './helpers'
import { modalStyle } from './styles'

interface Props {
  onClose: () => void
  /**
   * Optional category filter. When 'wall', only wall-mount categories are shown
   * and the screenshot/link-scrape flow is skipped. Used by FixturePickerPanel
   * to open the modal pre-configured for door/window uploads.
   */
  mountTypeFilter?: 'floor' | 'wall'
}

export default function AddFurnitureModal({ onClose, mountTypeFilter = 'floor' }: Props) {
  const { t } = useTranslation()
  const { categories, styles, createItem, loadCategories, loadStyles } = useCatalogStore()
  const enqueueVariant = useRenderQueueStore((s) => s.enqueueVariant)

  const isWallMode = mountTypeFilter === 'wall'
  const visibleCategories = categories.filter((c) => (c.mount_type ?? 'floor') === mountTypeFilter)

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
  const [matOpeningWCm, setMatOpeningWCm] = useState('')
  const [matOpeningHCm, setMatOpeningHCm] = useState('')
  const [isSavingItem, setIsSavingItem] = useState(false)
  const [createdItemId, setCreatedItemId] = useState<string | null>(null)

  // ── Step 2 state ────────────────────────────────────────────────────────────
  const [variants, setVariants] = useState<VariantDraft[]>([newVariantDraft()])
  const [isSavingVariants] = useState(false)
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
  }, [])

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
        setExtractError(t('addFurniture.extractErrorHttp', { status: resp.status }))
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
      setExtractError(t('addFurniture.extractErrorNetwork'))
    } finally {
      setIsExtracting(false)
      console.log('[Extract] Done')
    }
  }

  const handleStep1Submit = async () => {
    if (!name.trim() || !categoryId) return
    const category = categories.find((c) => c.id === categoryId)
    // Frame-style items need a mat opening — refuse to save without one
    // so the art overlay renders in the correct spot. Must fit within the
    // frame's outer dimensions.
    let matOpening: { w: number; h: number } | null = null
    if (category?.accepts_art) {
      const mw = Number(matOpeningWCm)
      const mh = Number(matOpeningHCm)
      if (!mw || !mh || mw <= 0 || mh <= 0) {
        showToast(t('addFurniture.errorMatOpeningRequired', { defaultValue: 'Mat opening width + height are required for picture frames.' }), 'warning')
        return
      }
      const outerW = Number(widthCm)
      const outerH = Number(heightCm)
      if (outerW && mw > outerW) {
        showToast(t('addFurniture.errorMatOpeningTooWide', { defaultValue: 'Mat opening width exceeds the frame width.' }), 'warning')
        return
      }
      if (outerH && mh > outerH) {
        showToast(t('addFurniture.errorMatOpeningTooTall', { defaultValue: 'Mat opening height exceeds the frame height.' }), 'warning')
        return
      }
      matOpening = { w: mw, h: mh }
    }
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
        mat_opening_cm: matOpening,
      })
      console.log('[AddFurniture] createItem result:', { id, error })
      if (error || !id) {
        showToast(error ?? t('addFurniture.errorSaveItem'), 'error')
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
      showToast(t('addFurniture.errorGeneric', { detail: String(err) }), 'error')
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
      showToast(t('addFurniture.errorNeedVariantImage'), 'warning')
      return
    }

    // Enqueue each variant into the background render queue and close
    // immediately. Uploads, createVariant, and TRELLIS all run in the queue
    // worker — progress surfaces in the RenderQueueTray (Phase C).
    const itemName = name.trim() || t('addFurniture.unnamedItem', { defaultValue: 'Untitled' })
    for (let i = 0; i < validVariants.length; i++) {
      const draft = validVariants[i]
      enqueueVariant(createdItemId, itemName, {
        draftId: draft.id,
        colorName: draft.color_name.trim(),
        images: draft.images.map((img) => img.file),
        price_thb: draft.price_thb ? Number(draft.price_thb) : undefined,
        source_url: draft.source_url.trim() || undefined,
        sort_order: i,
      })
    }

    const isFlat = useCatalogStore.getState().isItemFlat(createdItemId)
    showToast(
      isFlat ? t('addFurniture.toastFlatReady') : t('addFurniture.toastGenerating'),
      'success'
    )
    onClose()
  }

  // ─── Toggle style ──────────────────────────────────────────────────────────
  const toggleStyle = (styleId: string) => {
    setSelectedStyles((prev) =>
      prev.includes(styleId) ? prev.filter((s) => s !== styleId) : [...prev, styleId]
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const selectedCategory = categories.find((c) => c.id === categoryId)
  const isFlat = selectedCategory?.is_flat === true

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-step-badge">{t('addFurniture.stepOfTwo', { step })}</span>
            <h2 className="modal-title">
              {step === 1 ? t('addFurniture.step1Heading') : t('addFurniture.step2Heading')}
            </h2>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {step === 1 ? (
          <Step1Form
            isWallMode={isWallMode}
            visibleCategories={visibleCategories}
            styles={styles}
            screenshotPreview={screenshotPreview}
            screenshotInputRef={screenshotInputRef}
            isDragging={isDragging}
            isExtracting={isExtracting}
            extracted={extracted}
            extractError={extractError}
            handleScreenshotSelect={handleScreenshotSelect}
            handleDrop={handleDrop}
            setIsDragging={setIsDragging}
            handleExtract={handleExtract}
            url={url}
            setUrl={setUrl}
            name={name}
            setName={setName}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            description={description}
            setDescription={setDescription}
            widthCm={widthCm}
            setWidthCm={setWidthCm}
            depthCm={depthCm}
            setDepthCm={setDepthCm}
            heightCm={heightCm}
            setHeightCm={setHeightCm}
            acceptsArt={selectedCategory?.accepts_art === true}
            matOpeningWCm={matOpeningWCm}
            setMatOpeningWCm={setMatOpeningWCm}
            matOpeningHCm={matOpeningHCm}
            setMatOpeningHCm={setMatOpeningHCm}
            selectedStyles={selectedStyles}
            toggleStyle={toggleStyle}
            isSavingItem={isSavingItem}
            onCancel={onClose}
            onSubmit={handleStep1Submit}
          />
        ) : (
          <Step2Variants
            isWallMode={isWallMode}
            selectedCategory={selectedCategory}
            isFlat={isFlat}
            variants={variants}
            fileInputRefs={fileInputRefs}
            setVariants={setVariants}
            handleVariantImagesAdd={handleVariantImagesAdd}
            handleVariantImageRemove={handleVariantImageRemove}
            handleVariantImageReorder={handleVariantImageReorder}
            handleAddVariant={handleAddVariant}
            handleRemoveVariant={handleRemoveVariant}
            isSavingVariants={isSavingVariants}
            onBack={() => setStep(1)}
            onSave={handleSaveVariants}
          />
        )}
      </div>

      <style>{modalStyle}</style>
    </div>
  )
}
