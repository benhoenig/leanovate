import { useTranslation } from 'react-i18next'
import type { RefObject } from 'react'
import { Link, Loader2, ChevronRight, Camera, ImageIcon } from 'lucide-react'
import type { FurnitureCategory, Style } from '@/types'
import type { ExtractedData } from './helpers'

/**
 * Step 1 — product details + optional screenshot extraction.
 *
 * Purely presentational: all state + handlers live in the parent
 * (AddFurnitureModal/index.tsx). Props mirror the parent's state slice for
 * step 1 so visual behaviour is unchanged from the pre-refactor monolith.
 */
export default function Step1Form(props: {
  isWallMode: boolean
  visibleCategories: FurnitureCategory[]
  styles: Style[]
  // Screenshot state
  screenshotPreview: string | null
  screenshotInputRef: RefObject<HTMLInputElement | null>
  isDragging: boolean
  isExtracting: boolean
  extracted: ExtractedData | null
  extractError: string | null
  handleScreenshotSelect: (file: File) => void
  handleDrop: (e: React.DragEvent) => void
  setIsDragging: (dragging: boolean) => void
  handleExtract: () => void
  // Field state
  url: string
  setUrl: (v: string) => void
  name: string
  setName: (v: string) => void
  categoryId: string
  setCategoryId: (v: string) => void
  description: string
  setDescription: (v: string) => void
  widthCm: string
  setWidthCm: (v: string) => void
  depthCm: string
  setDepthCm: (v: string) => void
  heightCm: string
  setHeightCm: (v: string) => void
  // Picture-frame fields — only shown when the selected category has accepts_art
  acceptsArt: boolean
  matOpeningWCm: string
  setMatOpeningWCm: (v: string) => void
  matOpeningHCm: string
  setMatOpeningHCm: (v: string) => void
  selectedStyles: string[]
  toggleStyle: (id: string) => void
  // Submit
  isSavingItem: boolean
  onCancel: () => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  const {
    isWallMode,
    visibleCategories,
    styles,
    screenshotPreview,
    screenshotInputRef,
    isDragging,
    isExtracting,
    extracted,
    extractError,
    handleScreenshotSelect,
    handleDrop,
    setIsDragging,
    handleExtract,
    url, setUrl,
    name, setName,
    categoryId, setCategoryId,
    description, setDescription,
    widthCm, setWidthCm,
    depthCm, setDepthCm,
    heightCm, setHeightCm,
    acceptsArt,
    matOpeningWCm, setMatOpeningWCm,
    matOpeningHCm, setMatOpeningHCm,
    selectedStyles, toggleStyle,
    isSavingItem,
    onCancel,
    onSubmit,
  } = props

  return (
    <div className="modal-body">
      {/* Screenshot drop zone — hidden for wall fixtures (admin-uploaded, no purchase link) */}
      {!isWallMode && (
        <div className="field-group">
          <label className="field-label">{t('addFurniture.screenshotLabel')}</label>
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
              <img src={screenshotPreview} alt={t('addFurniture.screenshotAlt')} className="screenshot-preview-img" />
              <div className="screenshot-preview-actions">
                <button
                  className="screenshot-change-btn"
                  onClick={() => screenshotInputRef.current?.click()}
                >
                  <ImageIcon size={12} />
                  {t('addFurniture.screenshotChange')}
                </button>
                <button
                  className="btn-primary extract-btn"
                  onClick={handleExtract}
                  disabled={isExtracting}
                >
                  {isExtracting ? <Loader2 size={13} className="spin" /> : <Camera size={13} />}
                  {isExtracting ? t('addFurniture.screenshotExtracting') : t('addFurniture.screenshotExtract')}
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
              <span className="screenshot-drop-title">{t('addFurniture.screenshotDropTitle')}</span>
              <span className="screenshot-drop-hint">{t('addFurniture.screenshotDropHintA')}</span>
              <span className="screenshot-drop-hint">{t('addFurniture.screenshotDropHintB')}</span>
            </div>
          )}
          {extractError && (
            <p className="field-hint error">{extractError}{t('addFurniture.extractErrorSuffix')}</p>
          )}
          {extracted && !extractError && (
            <p className="field-hint success">{t('addFurniture.extractSuccess')}</p>
          )}
        </div>
      )}

      {/* Product Link (reference for purchasing) — hidden for wall fixtures */}
      {!isWallMode && (
        <div className="field-group">
          <label className="field-label">{t('addFurniture.productLinkLabel')}</label>
          <div className="url-input-wrap">
            <Link size={13} className="url-icon" />
            <input
              className="url-input"
              placeholder={t('addFurniture.productLinkPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Name */}
      <div className="field-group">
        <label className="field-label">{t('addFurniture.productNameLabel')}</label>
        <input
          className="field-input"
          placeholder={t('addFurniture.productNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* Category */}
      <div className="field-group">
        <label className="field-label">{t('addFurniture.categoryLabel')}</label>
        <select
          className="field-input"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">{t('addFurniture.categoryOptionPlaceholder')}</option>
          {visibleCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Description */}
      <div className="field-group">
        <label className="field-label">{t('addFurniture.descriptionLabelStep1')}</label>
        <textarea
          className="field-input field-textarea"
          placeholder={t('addFurniture.descriptionFieldPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      {/* Dimensions */}
      <div className="field-row-3">
        <div className="field-group">
          <label className="field-label">{t('addFurniture.widthCmLabel')}</label>
          <input className="field-input" type="number" placeholder="—" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">{t('addFurniture.depthCmLabel')}</label>
          <input className="field-input" type="number" placeholder="—" value={depthCm} onChange={(e) => setDepthCm(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">{t('addFurniture.heightCmLabel')}</label>
          <input className="field-input" type="number" placeholder="—" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
        </div>
      </div>

      {/* Mat opening — only for picture-frame categories */}
      {acceptsArt && (
        <div className="field-group">
          <label className="field-label">
            {t('addFurniture.matOpeningLabel', { defaultValue: 'Mat opening (inner art area)' })}
          </label>
          <div className="field-row-2">
            <input
              className="field-input"
              type="number"
              placeholder={t('addFurniture.matOpeningWPlaceholder', { defaultValue: 'Width cm' })}
              value={matOpeningWCm}
              onChange={(e) => setMatOpeningWCm(e.target.value)}
            />
            <input
              className="field-input"
              type="number"
              placeholder={t('addFurniture.matOpeningHPlaceholder', { defaultValue: 'Height cm' })}
              value={matOpeningHCm}
              onChange={(e) => setMatOpeningHCm(e.target.value)}
            />
          </div>
          <p className="field-hint">
            {t('addFurniture.matOpeningHint', { defaultValue: 'The visible window inside the frame where uploaded art renders. Must fit inside the outer width × height.' })}
          </p>
        </div>
      )}

      {/* Style tags — wall fixtures aren't style-tagged (they're architectural) */}
      {!isWallMode && (
        <div className="field-group">
          <label className="field-label">{t('addFurniture.styleTagsLabel')}</label>
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
      )}

      {/* Footer */}
      <div className="modal-footer">
        <button className="btn-ghost" onClick={onCancel}>{t('addFurniture.cancel')}</button>
        <button
          className="btn-primary"
          onClick={onSubmit}
          disabled={!name.trim() || !categoryId || isSavingItem}
        >
          {isSavingItem ? <Loader2 size={13} className="spin" /> : null}
          {t('addFurniture.saveAndAddColors')}
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
