import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCw, FlipHorizontal, Trash2, ExternalLink, ImageIcon, Shuffle } from 'lucide-react'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useArtStore } from '@/stores/useArtStore'
import { useTemplateStore } from '@/stores/useTemplateStore'
import { useUIStore } from '@/stores/useUIStore'
import PlacementSection from './PlacementSection'
import PlacedLightingSection from './PlacedLightingSection'
import ArtPickerModal from '../ArtPickerModal'
import type { PlacedLightSettings } from '@/types'

export default function FurnitureProperties({ placed }: { placed: { id: string; furniture_item_id: string; selected_variant_id: string; rotation_deg: number; price_at_placement: number | null; scale_factor: number; art_id: string | null; y_cm: number; light_settings: PlacedLightSettings | null; mirrored: boolean } }) {
  const { t } = useTranslation()
  const { rotateItem, toggleItemMirror, setItemRotation, commitRotation, scaleItem, commitScale, switchVariant, removeItem, setArt, setItemHeight } = useCanvasStore()
  const { getArtById, getArtUrl } = useArtStore()
  const [artPickerOpen, setArtPickerOpen] = useState(false)
  const scaleBeforeRef = useRef(placed.scale_factor ?? 1)
  const rotBeforeRef = useRef(placed.rotation_deg)
  const catalogState = useCatalogStore()
  const item = catalogState.items.find((i) => i.id === placed.furniture_item_id)
  const variants = catalogState.getVariantsForItem(placed.furniture_item_id)
  const currentVariant = variants.find((v) => v.id === placed.selected_variant_id)
  const category = catalogState.categories.find((c) => c.id === item?.category_id)

  // Load variants if not loaded
  useEffect(() => {
    if (variants.length === 0) {
      catalogState.loadVariantsForItem(placed.furniture_item_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed.furniture_item_id])

  const price = currentVariant?.price_thb ?? placed.price_at_placement
  const formattedPrice = price != null
    ? `฿${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : null

  const dimW = currentVariant?.width_cm ?? item?.width_cm
  const dimD = currentVariant?.depth_cm ?? item?.depth_cm
  const dimH = currentVariant?.height_cm ?? item?.height_cm
  const dims = [dimW, dimD, dimH].filter(Boolean).join(' × ')

  const sourceUrl = currentVariant?.source_url ?? item?.source_url

  return (
    <>
      <div className="panel-section">
        <span className="section-title">{t('editor.properties.furniture')}</span>
        <span className="fp-name">{item?.name ?? t('editor.properties.unknown')}</span>
        {category && <span className="fp-category">{category.name}</span>}
      </div>

      <div className="panel-divider" />

      {/* Variant swatches */}
      {variants.length > 0 && (
        <div className="panel-section">
          <span className="section-title">{t('editor.properties.color')}</span>
          <div className="fp-swatch-grid">
            {variants.map((v) => (
              <button
                key={v.id}
                className={`fp-swatch ${v.id === placed.selected_variant_id ? 'selected' : ''}`}
                onClick={() => switchVariant(placed.id, v.id, v.price_thb)}
                title={v.color_name}
              >
                {v.original_image_urls[0] ? (
                  <img src={v.original_image_urls[0]} alt={v.color_name} className="fp-swatch-img" />
                ) : (
                  <span className="fp-swatch-text">{v.color_name.slice(0, 2)}</span>
                )}
              </button>
            ))}
          </div>
          {currentVariant && (
            <span className="fp-variant-name">{currentVariant.color_name}</span>
          )}
        </div>
      )}

      <div className="panel-divider" />

      {/* Details */}
      <div className="panel-section">
        <span className="section-title">{t('editor.properties.details')}</span>
        {formattedPrice && <div className="fp-price">{formattedPrice}</div>}
        {dims && <div className="fp-dims">{dims} cm</div>}
        <div className="fp-scale-row">
          <label className="fp-scale-label">{t('editor.properties.size')}</label>
          <input
            type="range"
            min={50}
            max={200}
            step={5}
            value={Math.round((placed.scale_factor ?? 1) * 100)}
            onChange={(e) => scaleItem(placed.id, parseInt(e.target.value) / 100)}
            onPointerDown={() => { scaleBeforeRef.current = placed.scale_factor ?? 1 }}
            onPointerUp={() => { commitScale(placed.id, scaleBeforeRef.current) }}
            className="fp-scale-slider"
          />
          <div className="fp-scale-input-wrap">
            <input
              type="number"
              min={50}
              max={200}
              step={5}
              value={Math.round((placed.scale_factor ?? 1) * 100)}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (!isNaN(v) && v >= 50 && v <= 200) scaleItem(placed.id, v / 100)
              }}
              className="fp-scale-input"
            />
            <span className="fp-scale-pct">%</span>
          </div>
        </div>
        <div className="fp-scale-row">
          <label className="fp-scale-label">{t('editor.properties.rotation')}</label>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={Math.round(placed.rotation_deg)}
            onPointerDown={() => { rotBeforeRef.current = placed.rotation_deg }}
            onChange={(e) => setItemRotation(placed.id, parseInt(e.target.value))}
            onPointerUp={() => commitRotation(placed.id, rotBeforeRef.current)}
            className="fp-scale-slider"
          />
          <div className="fp-scale-input-wrap">
            <input
              type="number"
              min={0}
              max={360}
              step={1}
              value={Math.round(placed.rotation_deg)}
              onFocus={() => { rotBeforeRef.current = placed.rotation_deg }}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v)) setItemRotation(placed.id, v)
              }}
              onBlur={() => commitRotation(placed.id, rotBeforeRef.current)}
              className="fp-scale-input"
            />
            <span className="fp-scale-pct">°</span>
          </div>
        </div>
        {category?.flat_orientation === 'vertical' && (
          <div className="fp-scale-row">
            <label className="fp-scale-label">
              {t('editor.properties.heightAboveFloor', { defaultValue: 'Height above floor' })}
            </label>
            <input
              type="range"
              min={0}
              max={240}
              step={1}
              value={Math.round(placed.y_cm)}
              onChange={(e) => setItemHeight(placed.id, parseInt(e.target.value))}
              className="fp-scale-slider"
            />
            <div className="fp-scale-input-wrap">
              <input
                type="number"
                min={0}
                max={240}
                step={1}
                value={Math.round(placed.y_cm)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) setItemHeight(placed.id, v)
                }}
                className="fp-scale-input"
              />
              <span className="fp-scale-pct">cm</span>
            </div>
          </div>
        )}
        {sourceUrl && sourceUrl !== 'manual' && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="fp-link">
            <ExternalLink size={11} /> {t('editor.properties.viewProduct')}
          </a>
        )}
      </div>

      <div className="panel-divider" />

      {/* Picture frame — art picker */}
      {category?.accepts_art && item?.mat_opening_cm && (
        <>
          <div className="panel-section">
            <span className="section-title">{t('editor.properties.artwork')}</span>
            {(() => {
              const art = getArtById(placed.art_id)
              if (art) {
                const scopeLabel = art.scope === 'team'
                  ? t('editor.properties.artScopeTeam')
                  : t('editor.properties.artScopePrivate')
                return (
                  <div className="fp-art-row">
                    <img src={getArtUrl(art)} alt={art.name} className="fp-art-thumb" />
                    <div className="fp-art-meta">
                      <div className="fp-art-name">{art.name}</div>
                      <div className="fp-art-sub">{scopeLabel} · {art.aspect_ratio.toFixed(2)}:1</div>
                    </div>
                  </div>
                )
              }
              return <div className="fp-art-empty">{t('editor.properties.noArt')}</div>
            })()}
            <div className="fp-art-actions">
              <button className="fp-action-btn" onClick={() => setArtPickerOpen(true)}>
                <ImageIcon size={13} /> {placed.art_id ? t('editor.properties.changeArt') : t('editor.properties.chooseArt')}
              </button>
              {placed.art_id && (
                <button className="fp-action-btn fp-action-btn--ghost" onClick={() => setArt(placed.id, null)}>
                  {t('editor.properties.removeArt')}
                </button>
              )}
            </div>
          </div>
          <div className="panel-divider" />
        </>
      )}

      {/* Light-emitting fixture (ceiling downlight / lamp) — per-instance settings */}
      {category?.emits_light && (
        <PlacedLightingSection
          placedId={placed.id}
          settings={placed.light_settings}
        />
      )}

      {/* Placement controls — edit the master item/variant, not just this instance */}
      {item && currentVariant && (
        <PlacementSection
          item={item}
          variant={currentVariant}
          categoryDefaultBlock={category?.default_block_size ?? 'big'}
          categoryIsFlat={category?.is_flat ?? false}
        />
      )}

      {artPickerOpen && item?.mat_opening_cm && (
        <ArtPickerModal
          frameAspectRatio={item.mat_opening_cm.w / item.mat_opening_cm.h}
          currentArtId={placed.art_id}
          onClose={() => setArtPickerOpen(false)}
          onPick={(artId) => setArt(placed.id, artId)}
        />
      )}

      <div className="panel-divider" />

      {/* Actions */}
      <div className="panel-section">
        <button className="fp-action-btn" onClick={() => rotateItem(placed.id)}>
          <RotateCw size={13} /> {t('editor.properties.rotateAction')}
        </button>
        <button
          className={`fp-action-btn ${placed.mirrored ? 'fp-action-btn--on' : ''}`}
          onClick={() => toggleItemMirror(placed.id)}
          title={t('editor.properties.flipTitle')}
        >
          <FlipHorizontal size={13} /> {t('editor.properties.flipAction')}
        </button>
        <ShuffleThisButton placedId={placed.id} />
        <button className="fp-action-btn fp-action-btn--danger" onClick={() => removeItem(placed.id)}>
          <Trash2 size={13} /> {t('editor.properties.removeAction')}
        </button>
      </div>
    </>
  )
}

/**
 * Per-item shuffle: swaps this placed item for a random alternate that
 * matches the same category × effective block size × (optional) price cap.
 * Style scope is 'any' for v1 — if designers later ask for style-scoped
 * shuffle, surface the applied-template's styleId and pass it through.
 */
function ShuffleThisButton({ placedId }: { placedId: string }) {
  const { t } = useTranslation()
  const shuffleSlot = useTemplateStore((s) => s.shuffleSlot)
  const capEnabled = useUIStore((s) => s.shufflePriceCapEnabled)
  const cap = useUIStore((s) => s.shufflePriceCap)
  const showToast = useUIStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    const filters = capEnabled
      ? { maxPricePerItem: cap, includeNullPrice: true }
      : undefined
    const result = await shuffleSlot(placedId, null, filters)
    setBusy(false)
    if (result.swapped) {
      showToast(t('editor.properties.shuffleSuccess'), 'success')
    } else if (result.reason === 'pool-size-1') {
      showToast(t('editor.properties.shufflePoolOne'), 'warning')
    } else if (result.reason === 'no-matches') {
      showToast(t('editor.properties.shuffleNoMatches'), 'warning')
    } else {
      showToast(t('editor.properties.shuffleUnavailable'), 'warning')
    }
  }

  return (
    <button
      className="fp-action-btn"
      onClick={handleClick}
      disabled={busy}
      title={t('editor.properties.shuffleTitle')}
    >
      <Shuffle size={13} /> {t('editor.properties.shuffleAction')}
    </button>
  )
}
