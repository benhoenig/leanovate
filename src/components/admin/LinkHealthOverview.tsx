import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, AlertTriangle, CheckCircle, HelpCircle, RefreshCw, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import AdminListSkeleton from './AdminListSkeleton'
import type { FurnitureVariant } from '@/types'

interface VariantWithItemName extends FurnitureVariant {
  item_name: string
}

interface RecheckResult {
  success: boolean
  checked: number
  updated: number
  newly_inactive: number
  price_changes: number
  errors: number
}

async function invokeEdgeFunction(fnName: string, body: Record<string, unknown> = {}): Promise<{ data: unknown; error: string | null }> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`
  const token = localStorage.getItem('sb-auth-token')
  let bearerToken = ''
  if (token) {
    try { bearerToken = JSON.parse(token).access_token } catch { bearerToken = token }
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    if (!resp.ok) return { data: null, error: data.error || `HTTP ${resp.status}` }
    return { data, error: null }
  } catch (err) {
    return { data: null, error: String(err) }
  }
}

export default function LinkHealthOverview() {
  const { t, i18n } = useTranslation()
  const localeTag = i18n.resolvedLanguage === 'th' ? 'th-TH' : 'en-US'
  const [variants, setVariants] = useState<VariantWithItemName[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRechecking, setIsRechecking] = useState(false)
  const [recheckResult, setRecheckResult] = useState<RecheckResult | null>(null)
  const [recheckError, setRecheckError] = useState<string | null>(null)

  const loadVariants = useCallback(async () => {
    setIsLoading(true)
    const { data, error } = await supabase
      .from('furniture_variants')
      .select('*, furniture_items!inner(name)')
      .order('last_checked_at', { ascending: true, nullsFirst: true })

    if (error) { console.error('LinkHealth load error:', error); setIsLoading(false); return }

    const mapped: VariantWithItemName[] = (data ?? []).map((row: Record<string, unknown>) => {
      const itemData = row.furniture_items as { name: string } | null
      return {
        ...row,
        item_name: itemData?.name ?? t('common.unknown'),
      } as VariantWithItemName
    })

    setVariants(mapped)
    setIsLoading(false)
  }, [])

  useEffect(() => { loadVariants() }, [loadVariants])

  const handleRecheck = async () => {
    setIsRechecking(true)
    setRecheckResult(null)
    setRecheckError(null)

    const { data, error } = await invokeEdgeFunction('recheck-links', { batch_size: 50 })
    setIsRechecking(false)

    if (error) {
      setRecheckError(error)
      return
    }

    setRecheckResult(data as RecheckResult)
    // Reload variant data to refresh summary cards
    loadVariants()
  }

  const activeCount = variants.filter((v) => v.link_status === 'active').length
  const inactiveCount = variants.filter((v) => v.link_status === 'inactive').length
  const uncheckedCount = variants.filter((v) => v.link_status === 'unchecked').length
  const priceChangedCount = variants.filter((v) => v.price_changed).length

  const flaggedVariants = variants.filter(
    (v) => v.link_status === 'inactive' || v.price_changed
  )

  if (isLoading) {
    return <AdminListSkeleton rows={4} />
  }

  return (
    <div className="link-health">
      {/* Summary cards */}
      <div className="link-summary">
        <div className="link-card link-card-active">
          <CheckCircle size={18} />
          <span className="link-card-value">{activeCount}</span>
          <span className="link-card-label">{t('admin.linkHealth.active')}</span>
        </div>
        <div className="link-card link-card-inactive">
          <AlertTriangle size={18} />
          <span className="link-card-value">{inactiveCount}</span>
          <span className="link-card-label">{t('admin.linkHealth.inactive')}</span>
        </div>
        <div className="link-card link-card-unchecked">
          <HelpCircle size={18} />
          <span className="link-card-value">{uncheckedCount}</span>
          <span className="link-card-label">{t('admin.linkHealth.unchecked')}</span>
        </div>
        <div className="link-card link-card-price">
          <Link2 size={18} />
          <span className="link-card-value">{priceChangedCount}</span>
          <span className="link-card-label">{t('admin.linkHealth.priceChanged')}</span>
        </div>
      </div>

      {/* Recheck action */}
      <div className="recheck-section">
        <button
          className="recheck-btn"
          onClick={handleRecheck}
          disabled={isRechecking}
        >
          {isRechecking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          {isRechecking ? t('admin.linkHealth.checking') : t('admin.linkHealth.runRecheck')}
        </button>

        {recheckResult && (
          <div className="recheck-result">
            <CheckCircle size={14} />
            <span>
              {t('admin.linkHealth.recheckSummary', { checked: recheckResult.checked, updated: recheckResult.updated })}
              {recheckResult.newly_inactive > 0 && ` · ${t('admin.linkHealth.recheckNewlyInactive', { count: recheckResult.newly_inactive })}`}
              {recheckResult.price_changes > 0 && ` · ${t('admin.linkHealth.recheckPriceChanges', { count: recheckResult.price_changes })}`}
              {recheckResult.errors > 0 && ` · ${t('admin.linkHealth.recheckErrors', { count: recheckResult.errors })}`}
            </span>
          </div>
        )}

        {recheckError && (
          <div className="recheck-error">
            <AlertTriangle size={14} />
            <span>{recheckError}</span>
          </div>
        )}
      </div>

      {/* Flagged items */}
      <div className="link-flagged-section">
        <h3 className="link-section-title">
          {t('admin.linkHealth.flaggedItems')}
          {flaggedVariants.length > 0 && <span className="flagged-count">{flaggedVariants.length}</span>}
        </h3>

        {flaggedVariants.length === 0 ? (
          <div className="link-empty">
            <CheckCircle size={24} strokeWidth={1.5} />
            <p>{t('admin.linkHealth.noFlaggedHealthy')}</p>
          </div>
        ) : (
          <div className="flagged-list">
            {flaggedVariants.map((v) => (
              <div key={v.id} className="flagged-row">
                <img
                  src={v.original_image_urls[0]}
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
                      {t('admin.linkHealth.inactiveLink')}
                    </span>
                  )}
                  {v.price_changed && (
                    <span className="flagged-badge flagged-badge-price">
                      {t('admin.linkHealth.priceChangedBadge')}
                    </span>
                  )}
                </div>
                <span className="flagged-checked">
                  {v.last_checked_at
                    ? new Date(v.last_checked_at).toLocaleDateString(localeTag, { month: 'short', day: 'numeric' })
                    : t('admin.linkHealth.never')}
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
        .recheck-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .recheck-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 8px;
          border: 1.5px solid var(--color-primary-brand);
          background: transparent;
          color: var(--color-primary-brand);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          align-self: flex-start;
        }
        .recheck-btn:hover:not(:disabled) {
          background: var(--color-primary-brand);
          color: white;
        }
        .recheck-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .recheck-result {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 500;
          color: var(--color-success);
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(76, 175, 130, 0.08);
        }
        .recheck-error {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 500;
          color: var(--color-error);
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(229, 77, 66, 0.08);
        }
        @keyframes spin { to { transform: rotate(360deg) } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
