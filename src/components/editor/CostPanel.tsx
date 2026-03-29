import { useState } from 'react'
import { Plus, Trash2, AlertTriangle, Check } from 'lucide-react'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useProjectStore } from '@/stores/useProjectStore'

export default function CostPanel() {
  const placedFurniture = useCanvasStore((s) => s.placedFurniture)
  const switchVariant = useCanvasStore((s) => s.switchVariant)
  const { currentProject, updateProject } = useProjectStore()
  const catalogState = useCatalogStore()

  const [addingCost, setAddingCost] = useState(false)
  const [newCostLabel, setNewCostLabel] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // ── Compute furniture costs ────────────────────────────────────────────────
  const furnitureLines: Array<{
    placedId: string
    name: string
    color: string
    currentPrice: number | null
    placementPrice: number | null
    stale: boolean
  }> = []

  for (const pf of placedFurniture) {
    const item = catalogState.items.find((i) => i.id === pf.furniture_item_id)
    const variants = catalogState.getVariantsForItem(pf.furniture_item_id)
    const variant = variants.find((v) => v.id === pf.selected_variant_id)
    const currentPrice = variant?.price_thb ?? null
    const stale = pf.price_at_placement != null && currentPrice != null && pf.price_at_placement !== currentPrice
    furnitureLines.push({
      placedId: pf.id,
      name: item?.name ?? 'Unknown',
      color: variant?.color_name ?? '',
      currentPrice,
      placementPrice: pf.price_at_placement,
      stale,
    })
  }

  const furnitureTotal = furnitureLines.reduce((sum, l) => sum + (l.currentPrice ?? 0), 0)
  const staleCount = furnitureLines.filter((l) => l.stale).length

  // ── Manual costs ───────────────────────────────────────────────────────────
  const manualCosts = currentProject?.manual_costs ?? {}
  const manualEntries = Object.entries(manualCosts)
  const manualTotal = manualEntries.reduce((sum, [, val]) => sum + val, 0)
  const grandTotal = furnitureTotal + manualTotal

  const updateManualCosts = (updated: Record<string, number>) => {
    if (!currentProject) return
    updateProject(currentProject.id, { manual_costs: updated })
  }

  const handleAddCost = () => {
    if (!newCostLabel.trim()) return
    const updated = { ...manualCosts, [newCostLabel.trim()]: 0 }
    updateManualCosts(updated)
    setNewCostLabel('')
    setAddingCost(false)
  }

  const handleDeleteCost = (key: string) => {
    const updated = { ...manualCosts }
    delete updated[key]
    updateManualCosts(updated)
  }

  const handleCostValueBlur = (key: string) => {
    const val = parseFloat(editValue)
    if (!isNaN(val) && val !== manualCosts[key]) {
      updateManualCosts({ ...manualCosts, [key]: val })
    }
    setEditingKey(null)
  }

  const acknowledgeAll = () => {
    for (const line of furnitureLines) {
      if (line.stale && line.currentPrice != null) {
        const pf = placedFurniture.find((p) => p.id === line.placedId)
        if (pf) switchVariant(pf.id, pf.selected_variant_id, line.currentPrice)
      }
    }
  }

  const fmt = (n: number) => `฿${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  return (
    <div className="cost-panel">
      {/* Grand Total Card */}
      <div className="cost-grand-card">
        <span className="cost-grand-label">Grand Total</span>
        <span className="cost-grand-value">{fmt(grandTotal)}</span>
        <span className="cost-grand-sub">
          {furnitureLines.length} item{furnitureLines.length !== 1 ? 's' : ''} + {manualEntries.length} manual cost{manualEntries.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Staleness Alert */}
      {staleCount > 0 && (
        <div className="cost-stale-banner">
          <AlertTriangle size={14} />
          <span>{staleCount} item{staleCount !== 1 ? 's have' : ' has'} price changes</span>
          <button className="cost-stale-ack" onClick={acknowledgeAll}>
            <Check size={12} /> Acknowledge
          </button>
        </div>
      )}

      {/* Furniture Breakdown */}
      <div className="cost-section">
        <span className="cost-section-title">FURNITURE</span>
        {furnitureLines.length === 0 ? (
          <span className="cost-empty">No furniture placed</span>
        ) : (
          <div className="cost-lines">
            {furnitureLines.map((line) => (
              <div key={line.placedId} className="cost-line">
                <div className="cost-line-info">
                  <span className="cost-line-name">{line.name}</span>
                  {line.color && <span className="cost-line-color">{line.color}</span>}
                </div>
                <div className="cost-line-price">
                  {line.stale && line.placementPrice != null && (
                    <span className="cost-line-old">{fmt(line.placementPrice)}</span>
                  )}
                  {line.stale && <AlertTriangle size={10} className="cost-line-warn" />}
                  <span className={line.stale ? 'cost-line-new' : ''}>
                    {line.currentPrice != null ? fmt(line.currentPrice) : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="cost-subtotal-row">
          <span>Furniture Subtotal</span>
          <span className="cost-subtotal-value">{fmt(furnitureTotal)}</span>
        </div>
      </div>

      <div className="cost-divider" />

      {/* Manual Costs */}
      <div className="cost-section">
        <span className="cost-section-title">MANUAL COSTS</span>
        {manualEntries.length > 0 && (
          <div className="cost-lines">
            {manualEntries.map(([key, val]) => (
              <div key={key} className="cost-line">
                <span className="cost-line-name">{key}</span>
                <div className="cost-line-price">
                  {editingKey === key ? (
                    <input
                      className="cost-inline-input"
                      type="number"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleCostValueBlur(key)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="cost-line-editable"
                      onClick={() => { setEditingKey(key); setEditValue(String(val)) }}
                    >
                      {fmt(val)}
                    </span>
                  )}
                  <button className="cost-line-delete" onClick={() => handleDeleteCost(key)} title="Remove">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="cost-subtotal-row">
          <span>Manual Subtotal</span>
          <span className="cost-subtotal-value">{fmt(manualTotal)}</span>
        </div>

        {addingCost ? (
          <div className="cost-add-inline">
            <input
              className="cost-add-input"
              placeholder="Cost label (e.g. Renovation)"
              value={newCostLabel}
              onChange={(e) => setNewCostLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCost(); if (e.key === 'Escape') setAddingCost(false) }}
              autoFocus
            />
            <button className="cost-add-confirm" onClick={handleAddCost}>Add</button>
          </div>
        ) : (
          <button className="cost-add-btn" onClick={() => setAddingCost(true)}>
            <Plus size={13} /> Add Cost
          </button>
        )}
      </div>

      <style>{costStyle}</style>
    </div>
  )
}

const costStyle = `
  .cost-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cost-grand-card {
    background: linear-gradient(135deg, #2BA8A0, #238C85);
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cost-grand-label {
    font-size: 11px;
    font-weight: 500;
    color: rgba(255,255,255,0.8);
  }
  .cost-grand-value {
    font-size: 24px;
    font-weight: 800;
    color: white;
    letter-spacing: -0.5px;
  }
  .cost-grand-sub {
    font-size: 11px;
    color: rgba(255,255,255,0.7);
  }

  .cost-stale-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--color-warning-bg);
    border: 1px solid rgba(245, 166, 35, 0.25);
    color: var(--color-warning-text);
    font-size: 11px;
    font-weight: 500;
  }
  .cost-stale-ack {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px 8px;
    border-radius: 5px;
    border: 1px solid rgba(245, 166, 35, 0.3);
    background: white;
    color: var(--color-warning-text);
    font-size: 10px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .cost-stale-ack:hover {
    background: rgba(245, 166, 35, 0.1);
  }

  .cost-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cost-section-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--color-text-secondary);
  }
  .cost-empty {
    font-size: 11px;
    color: var(--color-text-secondary);
    opacity: 0.6;
  }
  .cost-divider {
    height: 1px;
    background: var(--color-border-custom);
  }

  .cost-lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cost-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 8px;
    border-radius: 6px;
    gap: 8px;
  }
  .cost-line:hover {
    background: var(--color-hover-bg);
  }
  .cost-line-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .cost-line-name {
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cost-line-color {
    font-size: 9px;
    color: var(--color-text-secondary);
  }
  .cost-line-price {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .cost-line-old {
    text-decoration: line-through;
    color: var(--color-text-secondary);
    font-weight: 400;
    font-size: 10px;
  }
  .cost-line-new {
    color: var(--color-error);
  }
  .cost-line-warn {
    color: var(--color-warning);
    flex-shrink: 0;
  }
  .cost-line-editable {
    cursor: pointer;
    border-bottom: 1px dashed var(--color-border-custom);
  }
  .cost-line-editable:hover {
    color: var(--color-primary-brand);
    border-color: var(--color-primary-brand);
  }
  .cost-line-delete {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 2px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: all 0.15s;
  }
  .cost-line:hover .cost-line-delete {
    opacity: 1;
  }
  .cost-line-delete:hover {
    color: var(--color-error);
  }
  .cost-inline-input {
    width: 70px;
    padding: 2px 5px;
    border: 1px solid var(--color-primary-brand);
    border-radius: 4px;
    font-size: 11px;
    font-family: inherit;
    font-weight: 600;
    color: var(--color-text-primary);
    background: var(--color-input-bg);
    outline: none;
    text-align: right;
  }

  .cost-subtotal-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--color-primary-brand-light);
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .cost-subtotal-value {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-primary-brand);
  }

  .cost-add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
    padding: 7px;
    border-radius: 8px;
    border: 1.5px dashed var(--color-primary-brand);
    background: var(--color-primary-brand-light);
    color: var(--color-primary-brand);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .cost-add-btn:hover {
    background: rgba(43, 168, 160, 0.12);
  }
  .cost-add-inline {
    display: flex;
    gap: 6px;
  }
  .cost-add-input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--color-border-custom);
    border-radius: 6px;
    font-size: 11px;
    font-family: inherit;
    background: var(--color-input-bg);
    color: var(--color-text-primary);
    outline: none;
  }
  .cost-add-input:focus {
    border-color: var(--color-primary-brand);
  }
  .cost-add-confirm {
    padding: 6px 12px;
    border-radius: 6px;
    border: none;
    background: var(--color-primary-brand);
    color: white;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
  .cost-add-confirm:hover {
    background: var(--color-primary-brand-hover);
  }
`
