import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, X, Upload, Box, Cpu } from 'lucide-react'
import { useRenderQueueStore, type QueueEntry, type QueueStage } from '@/stores/useRenderQueueStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useUIStore } from '@/stores/useUIStore'
import ModelApprovalModal from '@/components/editor/ModelApprovalModal'
import type { FurnitureItem, FurnitureVariant } from '@/types'

const STAGE_ORDER: QueueStage[] = ['uploading', 'creating', 'trellis', 'ready', 'failed']

function stageLabel(t: (k: string) => string, stage: QueueStage): string {
  const map: Record<QueueStage, string> = {
    uploading: t('renderQueue.stageUploading'),
    creating: t('renderQueue.stageCreating'),
    trellis: t('renderQueue.stageTrellis'),
    ready: t('renderQueue.stageReady'),
    failed: t('renderQueue.stageFailed'),
  }
  return map[stage]
}

function StageIcon({ stage }: { stage: QueueStage }) {
  if (stage === 'ready') return <CheckCircle2 size={13} color="var(--color-success)" />
  if (stage === 'failed') return <XCircle size={13} color="var(--color-error)" />
  if (stage === 'uploading') return <Upload size={13} className="spin-slow" color="var(--color-primary-brand)" />
  if (stage === 'creating') return <Box size={13} className="spin-slow" color="var(--color-primary-brand)" />
  return <Cpu size={13} className="spin-slow" color="var(--color-primary-brand)" />
}

function elapsed(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function RenderQueueTray() {
  const { t } = useTranslation()
  const entries = useRenderQueueStore((s) => s.entries)
  const dismiss = useRenderQueueStore((s) => s.dismiss)
  const showToast = useUIStore((s) => s.showToast)

  const [collapsed, setCollapsed] = useState(false)
  const [approvalTarget, setApprovalTarget] = useState<{ item: FurnitureItem; variant: FurnitureVariant } | null>(null)

  // ── Toast on transition to 'ready' ─────────────────────────────────────────
  // Track the set of ids we've already toasted for so we fire exactly once.
  const toastedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const entry of Object.values(entries)) {
      if (entry.stage === 'ready' && !toastedRef.current.has(entry.id)) {
        toastedRef.current.add(entry.id)
        showToast(
          t('renderQueue.toastReady', { name: `${entry.itemName} · ${entry.colorName}` }),
          'success',
        )
      }
    }
  }, [entries, showToast, t])

  // ── Auto-dismiss ready entries after designer approves or rejects ──────────
  // Watches each ready entry's variant in the catalog store and drops the
  // entry the moment render_approval_status leaves 'pending'. Retry keeps the
  // entry since retryRender flips it back to pending.
  useEffect(() => {
    const readyIds = Object.values(entries)
      .filter((e) => e.stage === 'ready' && e.variantId)
      .map((e) => ({ entryId: e.id, variantId: e.variantId! }))
    if (readyIds.length === 0) return

    const check = () => {
      const st = useCatalogStore.getState()
      for (const { entryId, variantId } of readyIds) {
        for (const list of Object.values(st.variants)) {
          const v = list.find((x) => x.id === variantId)
          if (v && v.render_approval_status !== 'pending') {
            dismiss(entryId)
            break
          }
        }
      }
    }
    check()
    const unsub = useCatalogStore.subscribe((s, prev) => {
      if (s.variants !== prev.variants) check()
    })
    return () => unsub()
  }, [entries, dismiss])

  // ── Tick for elapsed-time refresh (1s) ─────────────────────────────────────
  const [, setTick] = useState(0)
  useEffect(() => {
    const hasActive = Object.values(entries).some(
      (e) => e.stage !== 'ready' && e.stage !== 'failed',
    )
    if (!hasActive) return
    const id = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [entries])

  const list = Object.values(entries).sort((a, b) => {
    // Ready/failed to the top so the CTA is prominent
    const aStage = STAGE_ORDER.indexOf(a.stage)
    const bStage = STAGE_ORDER.indexOf(b.stage)
    const aDone = a.stage === 'ready' || a.stage === 'failed' ? 0 : 1
    const bDone = b.stage === 'ready' || b.stage === 'failed' ? 0 : 1
    if (aDone !== bDone) return aDone - bDone
    if (aStage !== bStage) return aStage - bStage
    return b.startedAt - a.startedAt
  })

  if (list.length === 0) return null

  const activeCount = list.filter(
    (e) => e.stage === 'uploading' || e.stage === 'creating' || e.stage === 'trellis',
  ).length
  const readyCount = list.filter((e) => e.stage === 'ready').length

  const openReview = async (entry: QueueEntry) => {
    if (!entry.variantId) return
    const state = useCatalogStore.getState()

    // Ensure the variant + item are loaded (designer may have navigated away
    // from the editor by the time TRELLIS completes).
    let variant: FurnitureVariant | null = null
    for (const list of Object.values(state.variants)) {
      const v = list.find((x) => x.id === entry.variantId)
      if (v) { variant = v; break }
    }
    if (!variant) {
      await state.loadVariantsByIds([entry.variantId])
      const refreshed = useCatalogStore.getState()
      for (const list of Object.values(refreshed.variants)) {
        const v = list.find((x) => x.id === entry.variantId)
        if (v) { variant = v; break }
      }
    }
    if (!variant) {
      showToast(t('renderQueue.errorVariantMissing'), 'error')
      return
    }

    let item = useCatalogStore.getState().items.find((i) => i.id === entry.itemId) ?? null
    if (!item) {
      await useCatalogStore.getState().loadItems()
      item = useCatalogStore.getState().items.find((i) => i.id === entry.itemId) ?? null
    }
    if (!item) {
      showToast(t('renderQueue.errorItemMissing'), 'error')
      return
    }

    setApprovalTarget({ item, variant })
  }

  return (
    <>
      <div className="rq-tray">
        {/* Header */}
        <button className="rq-header" onClick={() => setCollapsed((c) => !c)}>
          <div className="rq-header-main">
            <span className="rq-header-title">{t('renderQueue.title')}</span>
            {activeCount > 0 && (
              <span className="rq-pill in-progress">
                <Loader2 size={10} className="spin" />
                {t('renderQueue.inProgress', { count: activeCount })}
              </span>
            )}
            {readyCount > 0 && (
              <span className="rq-pill ready">
                <CheckCircle2 size={10} />
                {t('renderQueue.ready', { count: readyCount })}
              </span>
            )}
          </div>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Body */}
        {!collapsed && (
          <div className="rq-body">
            {list.map((entry) => (
              <div key={entry.id} className={`rq-row stage-${entry.stage}`}>
                <div className="rq-thumb">
                  {entry.thumbUrl ? (
                    <img src={entry.thumbUrl} alt="" />
                  ) : (
                    <div className="rq-thumb-placeholder" />
                  )}
                </div>
                <div className="rq-row-main">
                  <div className="rq-row-name" title={`${entry.itemName} · ${entry.colorName}`}>
                    {entry.itemName}
                    <span className="rq-color-name"> · {entry.colorName}</span>
                  </div>
                  <div className="rq-row-meta">
                    <StageIcon stage={entry.stage} />
                    <span>{stageLabel(t, entry.stage)}</span>
                    {entry.stage === 'uploading' && (
                      <span className="rq-progress-text">
                        {entry.uploadedCount}/{entry.totalImages}
                      </span>
                    )}
                    {(entry.stage === 'uploading' ||
                      entry.stage === 'creating' ||
                      entry.stage === 'trellis') && (
                      <span className="rq-elapsed">· {elapsed(entry.startedAt)}</span>
                    )}
                    {entry.stage === 'failed' && entry.error && (
                      <span className="rq-error" title={entry.error}>
                        {entry.error}
                      </span>
                    )}
                  </div>
                  {entry.stage === 'uploading' && entry.totalImages > 0 && (
                    <div className="rq-progress-bar">
                      <div
                        className="rq-progress-fill"
                        style={{
                          width: `${(entry.uploadedCount / entry.totalImages) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="rq-actions">
                  {entry.stage === 'ready' && !entry.isFlat && (
                    <button className="rq-btn primary" onClick={() => openReview(entry)}>
                      {t('renderQueue.review')}
                    </button>
                  )}
                  {(entry.stage === 'ready' || entry.stage === 'failed') && (
                    <button
                      className="rq-btn ghost"
                      onClick={() => dismiss(entry.id)}
                      title={t('renderQueue.dismiss')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {approvalTarget && (
        <ModelApprovalModal
          item={approvalTarget.item}
          variant={approvalTarget.variant}
          onClose={() => setApprovalTarget(null)}
        />
      )}

      <style>{`
        .rq-tray {
          position: fixed;
          bottom: 16px;
          right: 16px;
          width: 340px;
          max-height: 60vh;
          display: flex;
          flex-direction: column;
          background: var(--color-panel-bg, #ffffff);
          border: 1px solid var(--color-border-custom, #E8E5E0);
          border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.12);
          z-index: 8000;
          font-family: inherit;
          overflow: hidden;
        }
        .rq-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--color-border-custom, #E8E5E0);
          cursor: pointer;
          font-family: inherit;
          color: var(--color-text-primary, #2D2D2D);
        }
        .rq-header:hover {
          background: var(--color-card-bg, #FAFAF8);
        }
        .rq-header-main {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .rq-header-title {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }
        .rq-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 7px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 600;
        }
        .rq-pill.in-progress {
          background: var(--color-primary-light, #F0FAF9);
          color: var(--color-primary-brand, #2BA8A0);
        }
        .rq-pill.ready {
          background: rgba(76, 175, 130, 0.15);
          color: var(--color-success, #4CAF82);
        }
        .rq-body {
          overflow-y: auto;
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .rq-row {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px;
          border-radius: 8px;
          background: var(--color-card-bg, #FAFAF8);
          border: 1px solid var(--color-border-custom, #E8E5E0);
        }
        .rq-row.stage-ready {
          border-color: rgba(76, 175, 130, 0.5);
          background: rgba(76, 175, 130, 0.06);
        }
        .rq-row.stage-failed {
          border-color: rgba(229, 77, 66, 0.5);
          background: rgba(229, 77, 66, 0.06);
        }
        .rq-thumb {
          width: 36px;
          height: 36px;
          border-radius: 6px;
          overflow: hidden;
          flex-shrink: 0;
          background: var(--color-hover-bg, #F0EDEA);
        }
        .rq-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .rq-thumb-placeholder {
          width: 100%;
          height: 100%;
        }
        .rq-row-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .rq-row-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-primary, #2D2D2D);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rq-color-name {
          font-weight: 500;
          color: var(--color-text-secondary, #7A7A7A);
        }
        .rq-row-meta {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          color: var(--color-text-secondary, #7A7A7A);
          min-width: 0;
        }
        .rq-progress-text {
          font-weight: 600;
          color: var(--color-primary-brand, #2BA8A0);
        }
        .rq-elapsed {
          color: var(--color-text-secondary, #7A7A7A);
        }
        .rq-error {
          color: var(--color-error, #E54D42);
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 140px;
        }
        .rq-progress-bar {
          height: 3px;
          width: 100%;
          background: var(--color-hover-bg, #F0EDEA);
          border-radius: 2px;
          overflow: hidden;
        }
        .rq-progress-fill {
          height: 100%;
          background: var(--color-primary-brand, #2BA8A0);
          transition: width 0.25s ease;
        }
        .rq-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        .rq-btn {
          border: none;
          font-family: inherit;
          cursor: pointer;
          border-radius: 6px;
          transition: background 0.15s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .rq-btn.primary {
          background: var(--color-primary-brand, #2BA8A0);
          color: white;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
        }
        .rq-btn.primary:hover {
          background: var(--color-primary-hover, #238C85);
        }
        .rq-btn.ghost {
          background: transparent;
          color: var(--color-text-secondary, #7A7A7A);
          padding: 4px;
        }
        .rq-btn.ghost:hover {
          background: var(--color-hover-bg, #F0EDEA);
        }
        @keyframes rq-spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin-slow {
          animation: rq-spin-slow 1.8s linear infinite;
        }
      `}</style>
    </>
  )
}
