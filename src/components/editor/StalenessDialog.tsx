import { AlertTriangle, LinkIcon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import type { StalenessAlert } from '@/types'

interface Props {
  alerts: StalenessAlert[]
  onConfirm: () => void
  onCancel: () => void
}

export default function StalenessDialog({ alerts, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  const priceChanges = alerts.filter((a) => a.old_price != null && a.new_price != null && a.old_price !== a.new_price)
  const linkIssues = alerts.filter((a) => a.link_inactive)

  const locale = i18n.resolvedLanguage === 'th' ? 'th-TH' : 'en-US'
  const fmt = (n: number) => `฿${n.toLocaleString(locale, { maximumFractionDigits: 0 })}`

  return (
    <div className="sd-overlay" onClick={onCancel}>
      <div className="sd-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sd-header">
          <AlertTriangle size={16} className="sd-header-icon" />
          <span className="sd-title">{t('templates.staleness.title')}</span>
          <button className="sd-close" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <div className="sd-summary">
          {priceChanges.length > 0 && (
            <span>{t('templates.staleness.priceChanges', { count: priceChanges.length })}</span>
          )}
          {priceChanges.length > 0 && linkIssues.length > 0 && <span>, </span>}
          {linkIssues.length > 0 && (
            <span>{t('templates.staleness.linkIssues', { count: linkIssues.length })}</span>
          )}
        </div>

        <div className="sd-list">
          {alerts.map((alert, i) => (
            <div key={i} className="sd-item">
              <div className="sd-item-info">
                <span className="sd-item-name">{alert.furniture_item_name}</span>
                {alert.variant_color_name && (
                  <span className="sd-item-color">{alert.variant_color_name}</span>
                )}
              </div>
              <div className="sd-item-detail">
                {alert.old_price != null && alert.new_price != null && alert.old_price !== alert.new_price && (
                  <span className="sd-price-change">
                    <AlertTriangle size={10} />
                    <span className="sd-old-price">{fmt(alert.old_price)}</span>
                    <span className="sd-arrow">&rarr;</span>
                    <span className="sd-new-price">{fmt(alert.new_price)}</span>
                  </span>
                )}
                {alert.link_inactive && (
                  <span className="sd-link-inactive">
                    <LinkIcon size={10} /> {t('templates.staleness.inactiveLink')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sd-actions">
          <button className="sd-cancel-btn" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="sd-confirm-btn" onClick={onConfirm}>{t('templates.staleness.applyAnyway')}</button>
        </div>
      </div>

      <style>{stalenessStyle}</style>
    </div>
  )
}

const stalenessStyle = `
  .sd-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .sd-dialog {
    background: var(--color-panel-bg);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    width: 380px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sd-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--color-border-custom);
  }
  .sd-header-icon {
    color: var(--color-warning);
    flex-shrink: 0;
  }
  .sd-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
    flex: 1;
  }
  .sd-close {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 5px;
    display: flex;
    align-items: center;
  }
  .sd-close:hover {
    background: var(--color-hover-bg);
    color: var(--color-text-primary);
  }
  .sd-summary {
    padding: 10px 16px;
    font-size: 11px;
    color: var(--color-warning-text);
    background: var(--color-warning-bg);
  }
  .sd-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 300px;
  }
  .sd-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--color-card-bg);
    border: 1px solid var(--color-border-custom);
    gap: 8px;
  }
  .sd-item-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sd-item-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sd-item-color {
    font-size: 9px;
    color: var(--color-text-secondary);
  }
  .sd-item-detail {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }
  .sd-price-change {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: var(--color-warning);
  }
  .sd-old-price {
    text-decoration: line-through;
    color: var(--color-text-secondary);
  }
  .sd-arrow {
    color: var(--color-text-secondary);
  }
  .sd-new-price {
    font-weight: 600;
    color: var(--color-error);
  }
  .sd-link-inactive {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--color-error);
    font-weight: 500;
  }
  .sd-actions {
    display: flex;
    gap: 8px;
    padding: 14px 16px;
    border-top: 1px solid var(--color-border-custom);
  }
  .sd-cancel-btn {
    flex: 1;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid var(--color-border-custom);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .sd-cancel-btn:hover {
    background: var(--color-hover-bg);
    color: var(--color-text-primary);
  }
  .sd-confirm-btn {
    flex: 1;
    padding: 8px;
    border-radius: 8px;
    border: none;
    background: var(--color-primary-brand);
    color: white;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .sd-confirm-btn:hover {
    background: var(--color-primary-brand-hover);
  }
`
