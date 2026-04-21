import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Upload, Plus, Trash2, Info } from 'lucide-react'
import type { FurnitureCategory } from '@/types'
import type { VariantDraft } from './helpers'

/**
 * Step 2 — per-variant image upload + color/price/link fields.
 *
 * Presentational: state and persistence handlers live in the parent
 * (AddFurnitureModal/index.tsx). Props mirror the step-2 state slice.
 */
export default function Step2Variants(props: {
  isWallMode: boolean
  selectedCategory: FurnitureCategory | undefined
  isFlat: boolean
  variants: VariantDraft[]
  fileInputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>
  setVariants: React.Dispatch<React.SetStateAction<VariantDraft[]>>
  handleVariantImagesAdd: (draftId: string, files: FileList) => void
  handleVariantImageRemove: (draftId: string, imageId: string) => void
  handleVariantImageReorder: (draftId: string, imageId: string, dir: 'left' | 'right') => void
  handleAddVariant: () => void
  handleRemoveVariant: (draftId: string) => void
  isSavingVariants: boolean
  onBack: () => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  const {
    isWallMode,
    selectedCategory,
    isFlat,
    variants,
    fileInputRefs,
    setVariants,
    handleVariantImagesAdd,
    handleVariantImageRemove,
    handleVariantImageReorder,
    handleAddVariant,
    handleRemoveVariant,
    isSavingVariants,
    onBack,
    onSave,
  } = props

  return (
    <div className="modal-body">
      {isFlat && (
        <div className="flat-banner">
          <Info size={16} className="flat-banner-icon" />
          <div className="flat-banner-body">
            <div className="flat-banner-title">
              {t('addFurniture.flatBannerTitle', { category: selectedCategory?.name ?? '' })}
            </div>
            <div className="flat-banner-text">{t('addFurniture.flatBannerIntro')}</div>
            <ul className="flat-banner-list">
              <li>{t('addFurniture.flatBannerRulePng')}</li>
              <li>{t('addFurniture.flatBannerRuleTopDown')}</li>
              <li>{t('addFurniture.flatBannerRuleSingle')}</li>
            </ul>
            <div className="flat-banner-prompt-label">
              {t('addFurniture.flatBannerPromptLabel')}
            </div>
            <code className="flat-banner-prompt">
              {t('addFurniture.flatBannerPrompt', { category: selectedCategory?.name ?? 'item' })}
            </code>
          </div>
        </div>
      )}
      <p className="step2-hint">
        {isFlat ? t('addFurniture.step2HintFlat') : t('addFurniture.step2Hint')}
      </p>

      <div className="variants-list">
        {variants.map((draft, idx) => (
          <div key={draft.id} className="variant-card">
            <div className="variant-header">
              <span className="variant-num">{t('addFurniture.variantNumber', { num: idx + 1 })}</span>
              {variants.length > 1 && (
                <button className="variant-remove-btn" onClick={() => handleRemoveVariant(draft.id)}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            {/* Images row */}
            <div className="field-group">
              <label className="field-label">{t('addFurniture.productImagesCount', { count: draft.images.length })}</label>
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
                    <img src={img.previewUrl} alt={t('addFurniture.imageAlt', { num: imgIdx + 1 })} />
                    {imgIdx === 0 && <span className="variant-image-primary">{t('addFurniture.firstImageBadge')}</span>}
                    <div className="variant-image-thumb-actions">
                      {imgIdx > 0 && (
                        <button
                          className="variant-image-reorder-btn"
                          title={t('addFurniture.moveLeft')}
                          onClick={() => handleVariantImageReorder(draft.id, img.id, 'left')}
                        >
                          ◀
                        </button>
                      )}
                      {imgIdx < draft.images.length - 1 && (
                        <button
                          className="variant-image-reorder-btn"
                          title={t('addFurniture.moveRight')}
                          onClick={() => handleVariantImageReorder(draft.id, img.id, 'right')}
                        >
                          ▶
                        </button>
                      )}
                      <button
                        className="variant-image-remove-btn"
                        title={t('addFurniture.removeAction')}
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
                  <span>{t('addFurniture.addImages')}</span>
                </button>
              </div>
              {draft.images.length === 0 && (
                <span className="field-hint">
                  {t('addFurniture.emptyImageHint')}
                </span>
              )}
            </div>

            {/* Text fields */}
            <div className="field-group">
              <label className="field-label">{t('addFurniture.colorNameLabel')}</label>
              <input
                className="field-input"
                placeholder={t('addFurniture.colorNamePlaceholderLong')}
                value={draft.color_name}
                onChange={(e) =>
                  setVariants((prev) =>
                    prev.map((v) => (v.id === draft.id ? { ...v, color_name: e.target.value } : v))
                  )
                }
              />
            </div>
            <div className={isWallMode ? 'field-group' : 'field-row-2'}>
              <div className="field-group">
                <label className="field-label">{t('addFurniture.priceLabel')}</label>
                <input
                  className="field-input"
                  type="number"
                  placeholder={t('addFurniture.priceOptional')}
                  value={draft.price_thb}
                  onChange={(e) =>
                    setVariants((prev) =>
                      prev.map((v) => (v.id === draft.id ? { ...v, price_thb: e.target.value } : v))
                    )
                  }
                />
              </div>
              {!isWallMode && (
                <div className="field-group">
                  <label className="field-label">{t('addFurniture.variantLinkLabel')}</label>
                  <input
                    className="field-input"
                    placeholder={t('addFurniture.variantLinkOptional')}
                    value={draft.source_url}
                    onChange={(e) =>
                      setVariants((prev) =>
                        prev.map((v) => (v.id === draft.id ? { ...v, source_url: e.target.value } : v))
                      )
                    }
                  />
                </div>
              )}
            </div>

            {draft.error && <p className="variant-error">{draft.error}</p>}
          </div>
        ))}

        <button className="add-variant-btn" onClick={handleAddVariant}>
          <Plus size={14} />
          {t('addFurniture.addAnotherColor')}
        </button>
      </div>

      <div className="modal-footer">
        <button className="btn-ghost" onClick={onBack}>{t('addFurniture.backButton')}</button>
        <button
          className="btn-primary"
          onClick={onSave}
          disabled={isSavingVariants || variants.every((v) => !v.color_name.trim() || v.images.length === 0)}
        >
          {isSavingVariants ? <Loader2 size={13} className="spin" /> : null}
          {t('addFurniture.saveVariants')}
        </button>
      </div>
    </div>
  )
}
