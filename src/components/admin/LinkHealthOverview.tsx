import { useEffect, useState } from 'react'
import { Link2, AlertTriangle, CheckCircle, HelpCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { FurnitureVariant } from '@/types'

interface VariantWithItemName extends FurnitureVariant {
  item_name: string
}

export default function LinkHealthOverview() {
  const [variants, setVariants] = useState<VariantWithItemName[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      // Load all variants with their parent item name
      const { data, error } = await supabase
        .from('furniture_variants')
        .select('*, furniture_items!inner(name)')
        .order('last_checked_at', { ascending: true, nullsFirst: true })

      if (error) { console.error('LinkHealth load error:', error); setIsLoading(false); return }

      const mapped: VariantWithItemName[] = (data ?? []).map((row: Record<string, unknown>) => {
        const itemData = row.furniture_items as { name: string } | null
        return {
          ...row,
          item_name: itemData?.name ?? 'Unknown',
        } as VariantWithItemName
      })

      setVariants(mapped)
      setIsLoading(false)
    }
    load()
  }, [])

  const activeCount = variants.filter((v) => v.link_status === 'active').length
  const inactiveCount = variants.filter((v) => v.link_status === 'inactive').length
  const uncheckedCount = variants.filter((v) => v.link_status === 'unchecked').length
  const priceChangedCount = variants.filter((v) => v.price_changed).length

  const flaggedVariants = variants.filter(
    (v) => v.link_status === 'inactive' || v.price_changed
  )

  if (isLoading) {
    return <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, padding: 20 }}>Loading link health…</p>
  }

  return (
    <div className="link-health">
      {/* Summary cards */}
      <div className="link-summary">
        <div className="link-card link-card-active">
          <CheckCircle size={18} />
          <span className="link-card-value">{activeCount}</span>
          <span className="link-card-label">Active</span>
        </div>
        <div className="link-card link-card-inactive">
          <AlertTriangle size={18} />
          <span className="link-card-value">{inactiveCount}</span>
          <span className="link-card-label">Inactive</span>
        </div>
        <div className="link-card link-card-unchecked">
          <HelpCircle size={18} />
          <span className="link-card-value">{uncheckedCount}</span>
          <span className="link-card-label">Unchecked</span>
        </div>
        <div className="link-card link-card-price">
          <Link2 size={18} />
          <span className="link-card-value">{priceChangedCount}</span>
          <span className="link-card-label">Price Changed</span>
        </div>
      </div>

      {/* Flagged items */}
      <div className="link-flagged-section">
        <h3 className="link-section-title">
          Flagged Items
          {flaggedVariants.length > 0 && <span className="flagged-count">{flaggedVariants.length}</span>}
        </h3>

        {flaggedVariants.length === 0 ? (
          <div className="link-empty">
            <CheckCircle size={24} strokeWidth={1.5} />
            <p>No flagged items — all links healthy</p>
          </div>
        ) : (
          <div className="flagged-list">
            {flaggedVariants.map((v) => (
              <div key={v.id} className="flagged-row">
                <img
                  src={v.clean_image_url || v.original_image_url}
                  alt={v.color_name}
                  className="flagged-thumb"
                />
                <div className="flagged-info">
                  <span className="flagged-item-name">{v.item_name}</span>
                  <span className="flagged-color">{v.color_name}</span>
                </div>
                <div className="flagged-badges">
                  {v.link_status === 'inactive' && (
                    <span className="flagged-badge flagged-badge-inactive">
                      <AlertTriangle size={10} />
                      Inactive Link
                    </span>
                  )}
                  {v.price_changed && (
                    <span className="flagged-badge flagged-badge-price">
                      Price Changed
                    </span>
                  )}
                </div>
                <span className="flagged-checked">
                  {v.last_checked_at
                    ? new Date(v.last_checked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : 'Never'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .link-health {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .link-summary {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
        }
        .link-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 14px 10px;
          border-radius: 10px;
          border: 1px solid var(--color-border-custom);
          background: var(--color-card-bg);
        }
        .link-card-active { color: var(--color-success); }
        .link-card-inactive { color: var(--color-error); }
        .link-card-unchecked { color: var(--color-text-secondary); }
        .link-card-price { color: var(--color-warning); }
        .link-card-value {
          font-size: 24px;
          font-weight: 800;
        }
        .link-card-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }
        .link-section-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-text-primary);
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .flagged-count {
          font-size: 10px;
          font-weight: 700;
          background: var(--color-error);
          color: white;
          padding: 1px 6px;
          border-radius: 10px;
        }
        .link-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 40px 20px;
          color: var(--color-success);
          font-size: 13px;
        }
        .flagged-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .flagged-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 8px;
          background: var(--color-card-bg);
          border: 1px solid var(--color-border-custom);
        }
        .flagged-thumb {
          width: 36px;
          height: 36px;
          border-radius: 6px;
          object-fit: cover;
          border: 1px solid var(--color-border-custom);
          background: white;
          flex-shrink: 0;
        }
        .flagged-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }
        .flagged-item-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .flagged-color {
          font-size: 11px;
          color: var(--color-text-secondary);
        }
        .flagged-badges {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }
        .flagged-badge {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 10px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 6px;
        }
        .flagged-badge-inactive {
          background: rgba(229, 77, 66, 0.1);
          color: var(--color-error);
        }
        .flagged-badge-price {
          background: var(--color-warning-bg);
          color: var(--color-warning-text);
        }
        .flagged-checked {
          font-size: 10px;
          color: var(--color-text-secondary);
          width: 60px;
          text-align: right;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  )
}
