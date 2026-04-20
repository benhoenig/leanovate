import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCatalogStore } from '@/stores/useCatalogStore'
import type { FurnitureItem, FurnitureVariant } from '@/types'

interface PendingItemWithDetails {
  item: FurnitureItem
  variants: FurnitureVariant[]
  submitterName: string
  categoryName: string
}

export default function PendingApprovalQueue() {
  const { t, i18n } = useTranslation()
  const [pendingItems, setPendingItems] = useState<PendingItemWithDetails[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { approveItem, rejectItem } = useCatalogStore()
  const localeTag = i18n.resolvedLanguage === 'th' ? 'th-TH' : 'en-US'

  const loadPending = async () => {
    setIsLoading(true)
    try {
      // Load pending items
      const { data: items, error: itemsErr } = await supabase
        .from('furniture_items')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (itemsErr || !items) { setIsLoading(false); return }

      if (items.length === 0) {
        setPendingItems([])
        setIsLoading(false)
        return
      }

      // Load submitter names
      const submitterIds = [...new Set(items.map((i) => i.submitted_by))]
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', submitterIds)
      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))

      // Load categories
      const categoryIds = [...new Set(items.map((i) => i.category_id))]
      const { data: categories } = await supabase
        .from('furniture_categories')
        .select('id, name')
        .in('id', categoryIds)
      const catMap = new Map((categories ?? []).map((c: { id: string; name: string }) => [c.id, c.name]))

      // Load variants for each item
      const itemIds = items.map((i) => i.id)
      const { data: allVariants } = await supabase
        .from('furniture_variants')
        .select('*')
        .in('furniture_item_id', itemIds)
        .order('sort_order', { ascending: true })

      const variantsByItem = new Map<string, FurnitureVariant[]>()
      for (const v of (allVariants ?? []) as FurnitureVariant[]) {
        const list = variantsByItem.get(v.furniture_item_id) ?? []
        list.push(v)
        variantsByItem.set(v.furniture_item_id, list)
      }

      const result: PendingItemWithDetails[] = (items as FurnitureItem[]).map((item) => ({
        item,
        variants: variantsByItem.get(item.id) ?? [],
        submitterName: profileMap.get(item.submitted_by) ?? t('admin.pending.unknownSubmitter'),
        categoryName: catMap.get(item.category_id) ?? t('admin.pending.uncategorized'),
      }))

      setPendingItems(result)
    } catch (err) {
      console.error('loadPending:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadPending() }, [])

  const handleApprove = async (itemId: string) => {
    await approveItem(itemId)
    setPendingItems((prev) => prev.filter((p) => p.item.id !== itemId))
  }

  const handleReject = async (itemId: string) => {
    await rejectItem(itemId)
    setPendingItems((prev) => prev.filter((p) => p.item.id !== itemId))
  }

  const statusDot = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'var(--color-warning)',
      approved: 'var(--color-success)',
      rejected: 'var(--color-error)',
      waiting: 'var(--color-text-secondary)',
      processing: 'var(--color-warning)',
      completed: 'var(--color-success)',
      failed: 'var(--color-error)',
    }
    return colors[status] ?? 'var(--color-text-secondary)'
  }

  if (isLoading) {
    return <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, padding: 20 }}>{t('admin.pending.loading')}</p>
  }

  if (pendingItems.length === 0) {
    return (
      <div className="pending-empty">
        <Check size={32} strokeWidth={1.5} />
        <p>{t('admin.pending.emptyDetailed')}</p>
        <style>{`
          .pending-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 60px 20px;
            color: var(--color-text-secondary);
            font-size: 14px;
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="pending-queue">
      <p className="pending-count">{t('admin.pending.countPending', { count: pendingItems.length })}</p>

      {pendingItems.map(({ item, variants, submitterName, categoryName }) => {
        const isExpanded = expandedId === item.id
        return (
          <div key={item.id} className="pending-card">
            <div className="pending-card-header" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
              <div className="pending-card-info">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="pending-item-name">{item.name}</span>
                <span className="pending-category-pill">{categoryName}</span>
              </div>
              <div className="pending-card-meta">
                <span className="pending-submitter">{t('admin.pending.submittedByShort', { name: submitterName })}</span>
                <div className="pending-actions">
                  <button
                    className="pending-approve-btn"
                    onClick={(e) => { e.stopPropagation(); handleApprove(item.id) }}
                    title={t('admin.pending.approve')}
                  >
                    <Check size={14} />
                    {t('admin.pending.approve')}
                  </button>
                  <button
                    className="pending-reject-btn"
                    onClick={(e) => { e.stopPropagation(); handleReject(item.id) }}
                    title={t('admin.pending.reject')}
                  >
                    <X size={14} />
                    {t('admin.pending.reject')}
                  </button>
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="pending-card-body">
                {item.description && <p className="pending-description">{item.description}</p>}
                <div className="pending-details-row">
                  {item.source_url && item.source_url !== 'manual' && (
                    <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="pending-source-link">
                      <ExternalLink size={11} />
                      {item.source_domain}
                    </a>
                  )}
                  {item.width_cm && item.depth_cm && (
                    <span className="pending-dims">{item.width_cm} × {item.depth_cm}{item.height_cm ? ` × ${item.height_cm}` : ''} cm</span>
                  )}
                </div>

                {variants.length > 0 && (
                  <div className="pending-variants">
                    <p className="pending-variants-label">{t('admin.pending.variantCount', { count: variants.length })}</p>
                    {variants.map((v) => (
                      <div key={v.id} className="pending-variant-row">
                        <img
                          src={v.original_image_urls[0]}
                          alt={v.color_name}
                          className="pending-variant-thumb"
                        />
                        <span className="pending-variant-color">{v.color_name}</span>
                        {v.price_thb != null && <span className="pending-variant-price">฿{v.price_thb.toLocaleString(localeTag)}</span>}
                        <span className="pending-variant-status" style={{ color: statusDot(v.render_approval_status) }}>
                          {t('admin.pending.threeDStatus', { status: t(`catalog.renderApproval.${v.render_approval_status}`, v.render_approval_status) })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      <style>{`
        .pending-queue {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .pending-count {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-secondary);
          margin-bottom: 4px;
        }
        .pending-card {
          background: var(--color-card-bg);
          border: 1px solid var(--color-border-custom);
          border-radius: 10px;
          overflow: hidden;
        }
        .pending-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          cursor: pointer;
          gap: 8px;
        }
        .pending-card-header:hover {
          background: var(--color-hover-bg);
        }
        .pending-card-info {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
          color: var(--color-text-secondary);
        }
        .pending-item-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pending-category-pill {
          font-size: 10px;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 6px;
          background: var(--color-hover-bg);
          color: var(--color-text-secondary);
          white-space: nowrap;
        }
        .pending-card-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }
        .pending-submitter {
          font-size: 11px;
          color: var(--color-text-secondary);
          white-space: nowrap;
        }
        .pending-actions {
          display: flex;
          gap: 6px;
        }
        .pending-approve-btn,
        .pending-reject-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 6px;
          border: none;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .pending-approve-btn {
          background: var(--color-success);
          color: white;
        }
        .pending-approve-btn:hover {
          filter: brightness(1.1);
        }
        .pending-reject-btn {
          background: none;
          border: 1.5px solid var(--color-error);
          color: var(--color-error);
        }
        .pending-reject-btn:hover {
          background: var(--color-error);
          color: white;
        }
        .pending-card-body {
          padding: 0 12px 12px;
          border-top: 1px solid var(--color-border-custom);
        }
        .pending-description {
          font-size: 12px;
          color: var(--color-text-secondary);
          margin-top: 10px;
          line-height: 1.4;
        }
        .pending-details-row {
          display: flex;
          gap: 12px;
          margin-top: 8px;
          font-size: 11px;
          color: var(--color-text-secondary);
        }
        .pending-source-link {
          display: flex;
          align-items: center;
          gap: 4px;
          color: var(--color-primary-brand);
          text-decoration: none;
        }
        .pending-source-link:hover {
          text-decoration: underline;
        }
        .pending-dims {
          color: var(--color-text-secondary);
        }
        .pending-variants {
          margin-top: 10px;
        }
        .pending-variants-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
        }
        .pending-variant-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
        }
        .pending-variant-thumb {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          object-fit: cover;
          border: 1px solid var(--color-border-custom);
          background: white;
        }
        .pending-variant-color {
          font-size: 12px;
          font-weight: 500;
          color: var(--color-text-primary);
          flex: 1;
        }
        .pending-variant-price {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-primary-brand);
        }
        .pending-variant-status {
          font-size: 10px;
          font-weight: 500;
          text-transform: capitalize;
        }
      `}</style>
    </div>
  )
}
