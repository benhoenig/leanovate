/**
 * Visual block-size picker.
 *
 * Shows an interactive W×D grid where clicking a cell sets the footprint
 * in block units. Big block = 100 cm, small = 25 cm (the effective size for
 * the item — passed in via `stepCm`).
 *
 * Emits cm values so the parent can write to variant.width_cm / depth_cm.
 */

import { useTranslation } from 'react-i18next'

interface Props {
  /** Current width in cm. */
  widthCm: number
  /** Current depth in cm. */
  depthCm: number
  /** Block size in cm (100 for big, 25 for small). */
  stepCm: number
  /** Maximum blocks to show per axis. */
  maxBlocks?: number
  onChange: (widthCm: number, depthCm: number) => void
}

export default function BlockPicker({
  widthCm,
  depthCm,
  stepCm,
  maxBlocks = 6,
  onChange,
}: Props) {
  const { t } = useTranslation()
  const currentW = Math.max(1, Math.round(widthCm / stepCm))
  const currentD = Math.max(1, Math.round(depthCm / stepCm))
  const gridSize = Math.max(maxBlocks, currentW, currentD)

  const handleCellClick = (w: number, d: number) => {
    onChange(w * stepCm, d * stepCm)
  }

  return (
    <div className="block-picker">
      <div
        className="block-grid"
        style={{
          gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
          gridTemplateRows: `repeat(${gridSize}, 1fr)`,
        }}
      >
        {Array.from({ length: gridSize * gridSize }, (_, i) => {
          const col = i % gridSize
          const row = Math.floor(i / gridSize)
          const w = col + 1
          const d = row + 1
          const filled = w <= currentW && d <= currentD
          return (
            <button
              key={i}
              type="button"
              className={`block-cell ${filled ? 'filled' : ''}`}
              onClick={() => handleCellClick(w, d)}
              title={t('editor.canvas.blockDimensionTooltip', { w: w * stepCm, d: d * stepCm })}
            />
          )
        })}
      </div>
      <div className="block-picker-meta">
        <span>
          {currentW} × {currentD}
          <span className="block-picker-hint">
            {' '}({currentW * stepCm} × {currentD * stepCm} cm)
          </span>
        </span>
        <span className="block-picker-step">
          {t('editor.canvas.blockStepSuffix', { step: stepCm })}
        </span>
      </div>

      <style>{`
        .block-picker {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .block-grid {
          display: grid;
          gap: 2px;
          aspect-ratio: 1;
          width: 100%;
          max-width: 160px;
          padding: 3px;
          background: var(--color-input-bg);
          border: 1px solid var(--color-border-custom);
          border-radius: 6px;
        }
        .block-cell {
          border: none;
          border-radius: 2px;
          background: var(--color-hover-bg);
          cursor: pointer;
          transition: background 0.1s;
          padding: 0;
        }
        .block-cell:hover {
          background: var(--color-primary-brand-light);
        }
        .block-cell.filled {
          background: var(--color-primary-brand);
        }
        .block-cell.filled:hover {
          background: var(--color-primary-brand-hover);
        }
        .block-picker-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: var(--color-text-primary);
          font-weight: 600;
        }
        .block-picker-hint {
          font-weight: 400;
          color: var(--color-text-secondary);
        }
        .block-picker-step {
          font-weight: 500;
          color: var(--color-text-secondary);
          font-size: 10px;
        }
      `}</style>
    </div>
  )
}
