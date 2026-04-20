import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, DollarSign, Zap, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface UsageRow {
  id: string
  function_name: string
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  user_id: string | null
  user_name: string | null
  metadata: Record<string, unknown>
  created_at: string
}

interface UsageSummary {
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCostUsd: number
}

const EMPTY_SUMMARY: UsageSummary = {
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  totalCostUsd: 0,
}

export default function AIUsageOverview() {
  const { t, i18n } = useTranslation()
  const localeTag = i18n.resolvedLanguage === 'th' ? 'th-TH' : 'en-US'
  const [rows, setRows] = useState<UsageRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('30d')

  const formatTime = (iso: string): string => {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)

    if (diffMin < 1) return t('admin.aiUsage.justNow')
    if (diffMin < 60) return t('admin.aiUsage.minutesAgo', { count: diffMin })

    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return t('admin.aiUsage.hoursAgo', { count: diffHr })

    return d.toLocaleDateString(localeTag, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const loadUsage = useCallback(async () => {
    setIsLoading(true)

    let query = supabase
      .from('ai_usage_log')
      .select('*, profiles(display_name)')
      .order('created_at', { ascending: false })

    if (period === '7d') {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      query = query.gte('created_at', since)
    } else if (period === '30d') {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      query = query.gte('created_at', since)
    }

    const { data, error } = await query

    if (error) {
      console.error('AI usage load error:', error)
      setIsLoading(false)
      return
    }

    const mapped: UsageRow[] = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      function_name: row.function_name as string,
      model: row.model as string,
      input_tokens: row.input_tokens as number,
      output_tokens: row.output_tokens as number,
      total_tokens: row.total_tokens as number,
      cost_usd: Number(row.cost_usd) || 0,
      user_id: row.user_id as string | null,
      user_name: (row.profiles as Record<string, unknown>)?.display_name as string | null ?? null,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      created_at: row.created_at as string,
    }))

    setRows(mapped)
    setIsLoading(false)
  }, [period])

  useEffect(() => { loadUsage() }, [loadUsage])

  const summary = rows.reduce<UsageSummary>((acc, row) => ({
    totalCalls: acc.totalCalls + 1,
    totalInputTokens: acc.totalInputTokens + row.input_tokens,
    totalOutputTokens: acc.totalOutputTokens + row.output_tokens,
    totalTokens: acc.totalTokens + row.total_tokens,
    totalCostUsd: acc.totalCostUsd + row.cost_usd,
  }), { ...EMPTY_SUMMARY })

  const costThb = summary.totalCostUsd * 34

  return (
    <div className="ai-usage-overview">
      {/* Period pills */}
      <div className="period-pills">
        {(['7d', '30d', 'all'] as const).map((p) => (
          <button
            key={p}
            className={`period-pill ${period === p ? 'active' : ''}`}
            onClick={() => setPeriod(p)}
          >
            {p === '7d' ? t('admin.aiUsage.period7d') : p === '30d' ? t('admin.aiUsage.period30d') : t('admin.aiUsage.periodAll')}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="usage-summary-grid">
        <div className="usage-card">
          <div className="usage-card-icon calls"><Zap size={16} /></div>
          <div className="usage-card-body">
            <span className="usage-card-value">{summary.totalCalls.toLocaleString(localeTag)}</span>
            <span className="usage-card-label">{t('admin.aiUsage.apiCalls')}</span>
          </div>
        </div>
        <div className="usage-card">
          <div className="usage-card-icon tokens"><Cpu size={16} /></div>
          <div className="usage-card-body">
            <span className="usage-card-value">{summary.totalTokens.toLocaleString(localeTag)}</span>
            <span className="usage-card-label">{t('admin.aiUsage.totalTokens')}</span>
          </div>
        </div>
        <div className="usage-card">
          <div className="usage-card-icon cost"><DollarSign size={16} /></div>
          <div className="usage-card-body">
            <span className="usage-card-value">${summary.totalCostUsd.toFixed(4)}</span>
            <span className="usage-card-label">{t('admin.aiUsage.costUsd')}</span>
          </div>
        </div>
        <div className="usage-card">
          <div className="usage-card-icon thb"><TrendingUp size={16} /></div>
          <div className="usage-card-body">
            <span className="usage-card-value">฿{costThb.toFixed(2)}</span>
            <span className="usage-card-label">{t('admin.aiUsage.costThb')}</span>
          </div>
        </div>
      </div>

      {/* Usage log table */}
      <div className="usage-table-wrap">
        <div className="usage-table-header">
          <span className="usage-table-title">{t('admin.aiUsage.usageLog')}</span>
          <span className="usage-table-count">{t('admin.aiUsage.entriesCount', { count: rows.length })}</span>
        </div>
        {isLoading ? (
          <div className="usage-loading">{t('admin.aiUsage.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="usage-empty">{t('admin.aiUsage.noData')}</div>
        ) : (
          <div className="usage-table-scroll">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{t('admin.aiUsage.colTime')}</th>
                  <th>{t('admin.aiUsage.colUser')}</th>
                  <th>{t('admin.aiUsage.colFunction')}</th>
                  <th className="right">{t('admin.aiUsage.colInput')}</th>
                  <th className="right">{t('admin.aiUsage.colOutput')}</th>
                  <th className="right">{t('admin.aiUsage.colCost')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-time">{formatTime(row.created_at)}</td>
                    <td>{row.user_name || '—'}</td>
                    <td><span className="fn-badge">{row.function_name}</span></td>
                    <td className="right mono">{row.input_tokens.toLocaleString(localeTag)}</td>
                    <td className="right mono">{row.output_tokens.toLocaleString(localeTag)}</td>
                    <td className="right mono">${row.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        .ai-usage-overview {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .period-pills {
          display: flex;
          gap: 6px;
        }
        .period-pill {
          padding: 5px 14px;
          border-radius: 6px;
          border: 1.5px solid var(--color-border-custom);
          background: transparent;
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          color: var(--color-text-secondary);
          transition: all 0.15s;
        }
        .period-pill.active {
          border-color: var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
        }
        .usage-summary-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .usage-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px;
          border-radius: 10px;
          background: var(--color-panel-bg);
          border: 1px solid var(--color-border-custom);
        }
        .usage-card-icon {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .usage-card-icon.calls { background: rgba(43,168,160,0.1); color: var(--color-primary-brand); }
        .usage-card-icon.tokens { background: rgba(99,102,241,0.1); color: #6366f1; }
        .usage-card-icon.cost { background: rgba(245,166,35,0.1); color: #f5a623; }
        .usage-card-icon.thb { background: rgba(76,175,130,0.1); color: #4caf82; }
        .usage-card-body {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .usage-card-value {
          font-size: 18px;
          font-weight: 700;
          color: var(--color-text-primary);
          letter-spacing: -0.3px;
        }
        .usage-card-label {
          font-size: 11px;
          font-weight: 500;
          color: var(--color-text-secondary);
        }
        .usage-table-wrap {
          background: var(--color-panel-bg);
          border: 1px solid var(--color-border-custom);
          border-radius: 10px;
          overflow: hidden;
        }
        .usage-table-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border-custom);
        }
        .usage-table-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-text-primary);
        }
        .usage-table-count {
          font-size: 11px;
          color: var(--color-text-secondary);
        }
        .usage-loading, .usage-empty {
          padding: 32px;
          text-align: center;
          font-size: 12px;
          color: var(--color-text-secondary);
        }
        .usage-table-scroll {
          overflow-x: auto;
        }
        .usage-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .usage-table th {
          text-align: left;
          padding: 8px 14px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--color-text-secondary);
          border-bottom: 1px solid var(--color-border-custom);
          background: var(--color-card-bg);
        }
        .usage-table td {
          padding: 8px 14px;
          color: var(--color-text-primary);
          border-bottom: 1px solid var(--color-border-custom);
        }
        .usage-table tr:last-child td {
          border-bottom: none;
        }
        .usage-table tr:hover td {
          background: var(--color-hover-bg);
        }
        .usage-table .right { text-align: right; }
        .usage-table .mono { font-variant-numeric: tabular-nums; }
        .cell-time {
          color: var(--color-text-secondary);
          white-space: nowrap;
          font-size: 11px;
        }
        .fn-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          background: rgba(99,102,241,0.08);
          color: #6366f1;
          font-size: 10px;
          font-weight: 600;
        }

        @media (max-width: 768px) {
          .usage-summary-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </div>
  )
}

