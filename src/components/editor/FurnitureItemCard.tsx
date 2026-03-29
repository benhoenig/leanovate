import type { FurnitureItem, FurnitureVariant, FurnitureCategory } from '@/types'

interface FurnitureItemCardProps {
  item: FurnitureItem
  variants: FurnitureVariant[]
  category: FurnitureCategory | undefined
  isSelected?: boolean
  onClick?: () => void
}

/** Status dot color per item status */
const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--color-text-secondary)',
  pending: 'var(--color-warning)',
  approved: 'var(--color-success)',
  rejected: 'var(--color-error)',
}

/** Returns the best display image for a variant: sprite > clean_image > original */
function variantThumbUrl(variant: FurnitureVariant): string | null {
  if (variant.original_image_url) {
    // original_image_url is stored as a full public URL
    return variant.original_image_url
  }
  return null
}

export default function FurnitureItemCard({
  item,
  variants,
  category,
  isSelected = false,
  onClick,
}: FurnitureItemCardProps) {
  // First variant that has an image to use as the card thumbnail
  const primaryVariant = variants[0] ?? null
  const thumbUrl = primaryVariant ? variantThumbUrl(primaryVariant) : null

  // Price from first variant that has one
  const price = variants.find((v) => v.price_thb != null)?.price_thb
  const formattedPrice = price != null
    ? `฿${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : null

  // Pending approval count
  const pendingCount = variants.filter((v) => v.image_status === 'pending_approval').length
  const processingCount = variants.filter((v) => v.image_status === 'processing').length
  const renderingCount = variants.filter((v) => v.render_status === 'processing').length

  return (
    <div
      className={`fi-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      {/* Thumbnail */}
      <div className="fi-thumb">
        {thumbUrl ? (
          <img src={thumbUrl} alt={item.name} className="fi-thumb-img" />
        ) : (
          <div className="fi-thumb-placeholder">
            <span className="fi-thumb-placeholder-text">No image</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="fi-info">
        <div className="fi-name-row">
          <span
            className="fi-status-dot"
            style={{ background: STATUS_COLOR[item.status] ?? STATUS_COLOR.draft }}
            title={item.status}
          />
          <span className="fi-name">{item.name}</span>
        </div>

        <div className="fi-meta-row">
          {category && (
            <span className="fi-category-pill">{category.name}</span>
          )}
          {formattedPrice && (
            <span className="fi-price">{formattedPrice}</span>
          )}
        </div>

        {/* Color swatches */}
        {variants.length > 0 && (
          <div className="fi-swatches">
            {variants.slice(0, 6).map((v) => (
              <div
                key={v.id}
                className={`fi-swatch ${v.image_status === 'pending_approval' ? 'needs-approval' : ''}`}
                title={v.color_name}
              />
            ))}
            {variants.length > 6 && (
              <span className="fi-swatch-more">+{variants.length - 6}</span>
            )}
          </div>
        )}

        {/* Processing badges */}
        {pendingCount > 0 && (
          <div className="fi-badge warning">
            {pendingCount} image{pendingCount > 1 ? 's' : ''} need approval
          </div>
        )}
        {processingCount > 0 && (
          <div className="fi-badge info">
            Removing bg…
          </div>
        )}
        {renderingCount > 0 && (
          <div className="fi-badge info">
            Generating 3D…
          </div>
        )}
      </div>

      <style>{`
        .fi-card {
          display: flex;
          gap: 10px;
          padding: 10px;
          border-radius: 10px;
          border: 1px solid var(--color-border-custom);
          background: var(--color-card-bg);
          cursor: pointer;
          transition: all 0.15s;
          margin-bottom: 6px;
        }
        .fi-card:hover {
          background: var(--color-hover-bg);
        }
        .fi-card.selected {
          background: var(--color-primary-brand-light);
          border-color: var(--color-primary-brand);
          border-width: 1.5px;
        }
        .fi-thumb {
          width: 52px;
          height: 52px;
          border-radius: 7px;
          overflow: hidden;
          flex-shrink: 0;
          background: var(--color-hover-bg);
        }
        .fi-thumb-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .fi-thumb-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .fi-thumb-placeholder-text {
          font-size: 9px;
          color: var(--color-text-secondary);
          text-align: center;
        }
        .fi-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .fi-name-row {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .fi-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .fi-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fi-meta-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .fi-category-pill {
          font-size: 10px;
          font-weight: 500;
          color: var(--color-text-secondary);
          background: var(--color-hover-bg);
          padding: 1px 6px;
          border-radius: 4px;
        }
        .fi-price {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-primary-brand);
        }
        .fi-swatches {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
        }
        .fi-swatch {
          width: 14px;
          height: 14px;
          border-radius: 4px;
          background: var(--color-border-custom);
          border: 1.5px solid var(--color-border-custom);
        }
        .fi-swatch.needs-approval {
          border-color: var(--color-warning);
          background: var(--color-warning-bg);
        }
        .fi-swatch-more {
          font-size: 9px;
          color: var(--color-text-secondary);
        }
        .fi-badge {
          font-size: 10px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 4px;
          align-self: flex-start;
        }
        .fi-badge.warning {
          background: var(--color-warning-bg);
          color: var(--color-warning-text);
        }
        .fi-badge.info {
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
        }
      `}</style>
    </div>
  )
}
