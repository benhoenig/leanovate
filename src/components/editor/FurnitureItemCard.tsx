import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, MoreHorizontal } from 'lucide-react'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { getPublicStorageUrl } from '@/lib/supabase'
import type { FurnitureItem, FurnitureVariant, FurnitureCategory } from '@/types'

interface FurnitureItemCardProps {
  item: FurnitureItem
  variants: FurnitureVariant[]
  category: FurnitureCategory | undefined
  isFlat: boolean
  /** Fires when the designer clicks the tile body — should enter placement mode. */
  onPlace: () => void
  /** Fires when the designer clicks the ⋯ icon — should open the detail drawer. */
  onOpenDetails: () => void
}

/** Status dot color per catalog item status (only shown for non-approved items). */
const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--color-text-secondary)',
  pending: 'var(--color-warning)',
  rejected: 'var(--color-error)',
}

/**
 * Picks the best available image for the tile:
 *   1. The cached `.glb` isometric snapshot (thumbnail_path) — real Sims-style tile
 *   2. For flat items, the first uploaded product photo (no .glb exists)
 *   3. Otherwise fall back to the first uploaded photo while the snapshot backfills
 */
function pickTileImage(variants: FurnitureVariant[], isFlat: boolean): string | null {
  // Prefer an approved variant's snapshot; fall back to any variant with one.
  const approvedWithThumb = variants.find(
    (v) => v.render_approval_status === 'approved' && v.thumbnail_path,
  )
  const anyWithThumb = variants.find((v) => v.thumbnail_path)
  const thumbSource = approvedWithThumb ?? anyWithThumb
  if (thumbSource?.thumbnail_path) {
    const url = getPublicStorageUrl('thumbnails', thumbSource.thumbnail_path)
    // Cache-bust on updated_at so re-rendered thumbnails at the same path
    // aren't masked by browser/CDN cache.
    return `${url}?v=${encodeURIComponent(thumbSource.updated_at)}`
  }

  const firstVariant = variants[0]
  if (!firstVariant) return null

  // Flat items never get a .glb snapshot — the uploaded photo IS the asset.
  if (isFlat) return firstVariant.original_image_urls[0] ?? null

  // Non-flat item waiting on snapshot backfill — show the uploaded photo
  // temporarily so the tile isn't blank.
  return firstVariant.original_image_urls[0] ?? null
}

export default function FurnitureItemCard({
  item,
  variants,
  category,
  isFlat,
  onPlace,
  onOpenDetails,
}: FurnitureItemCardProps) {
  const { t, i18n } = useTranslation()
  const { ensureVariantThumbnail } = useCatalogStore()

  const tileImage = pickTileImage(variants, isFlat)

  // Lazily backfill catalog tile thumbnails for legacy/approved variants that
  // predate thumbnail_path or whose fire-and-forget snapshot never landed.
  // Deduplicated per variant inside the store — safe to call on every render.
  useEffect(() => {
    if (isFlat) return
    for (const v of variants) {
      if (v.glb_path && !v.thumbnail_path) {
        ensureVariantThumbnail(v.id)
      }
    }
  }, [variants, isFlat, ensureVariantThumbnail])

  const price = variants.find((v) => v.price_thb != null)?.price_thb
  const localeTag = i18n.resolvedLanguage === 'th' ? 'th-TH' : 'en-US'
  const formattedPrice = price != null
    ? `฿${price.toLocaleString(localeTag, { maximumFractionDigits: 0 })}`
    : null

  const pendingApproval = variants.some(
    (v) => v.render_approval_status === 'pending' && v.glb_path,
  )
  const isProcessing = variants.some(
    (v) => v.render_status === 'processing' || v.render_status === 'waiting',
  )

  const showStatusDot = item.status !== 'approved' && STATUS_COLOR[item.status]

  const handleOpenDetails = (e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenDetails()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPlace()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="fi-tile"
      onClick={onPlace}
      onKeyDown={handleKeyDown}
      title={`${item.name}${category ? ` · ${category.name}` : ''}`}
    >
      {/* Thumbnail (square) */}
      <div className="fi-tile-thumb">
        {tileImage ? (
          <img
            src={tileImage}
            alt={item.name}
            className={`fi-tile-img ${isProcessing ? 'processing' : ''}`}
            loading="lazy"
          />
        ) : (
          <div className="fi-tile-placeholder">
            <span>{t('catalog.noImage')}</span>
          </div>
        )}

        {isProcessing && (
          <div className="fi-tile-overlay">
            <Loader2 size={18} className="spin" />
            <span>{t('catalog.generating3D')}</span>
          </div>
        )}

        {pendingApproval && !isProcessing && (
          <span className="fi-tile-badge warning" title={t('catalog.renderApproval.pending')}>
            !
          </span>
        )}

        {showStatusDot && (
          <span
            className="fi-tile-status"
            style={{ background: STATUS_COLOR[item.status] }}
            title={item.status}
          />
        )}

        <button
          type="button"
          className="fi-tile-more"
          onClick={handleOpenDetails}
          title={t('catalog.catalogApproval')}
          aria-label="Details"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* Name + price */}
      <div className="fi-tile-info">
        <span className="fi-tile-name">{item.name}</span>
        {formattedPrice && <span className="fi-tile-price">{formattedPrice}</span>}
      </div>

      <style>{`
        .fi-tile {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 0;
          border: 1px solid var(--color-border-custom);
          background: var(--color-card-bg);
          border-radius: 10px;
          overflow: hidden;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
        }
        .fi-tile:hover {
          border-color: var(--color-primary-brand);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }
        .fi-tile:focus-visible {
          outline: 2px solid var(--color-primary-brand);
          outline-offset: 2px;
        }
        .fi-tile-thumb {
          position: relative;
          aspect-ratio: 1;
          width: 100%;
          background:
            radial-gradient(circle at 30% 20%, rgba(255,255,255,0.9), rgba(240, 237, 234, 1) 70%);
          overflow: hidden;
        }
        .fi-tile-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          transition: filter 0.2s;
        }
        .fi-tile-img.processing {
          filter: grayscale(0.8) opacity(0.55);
        }
        .fi-tile-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-secondary);
          font-size: 10px;
        }
        .fi-tile-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: rgba(255, 255, 255, 0.45);
          font-size: 10px;
          font-weight: 600;
          color: var(--color-primary-brand);
        }
        .fi-tile-badge {
          position: absolute;
          top: 6px;
          left: 6px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          color: white;
          box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }
        .fi-tile-badge.warning {
          background: var(--color-warning);
        }
        .fi-tile-status {
          position: absolute;
          top: 8px;
          right: 32px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          box-shadow: 0 0 0 1.5px white;
        }
        .fi-tile-more {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 22px;
          height: 22px;
          border-radius: 6px;
          border: none;
          background: rgba(255,255,255,0.85);
          color: var(--color-text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .fi-tile-more:hover {
          background: white;
          color: var(--color-primary-brand);
        }
        .fi-tile-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 7px 9px 9px;
          min-width: 0;
        }
        .fi-tile-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-primary);
          line-height: 1.25;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-word;
        }
        .fi-tile-price {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-primary-brand);
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  )
}
