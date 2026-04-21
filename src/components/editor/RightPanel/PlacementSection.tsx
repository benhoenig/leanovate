import { useTranslation } from 'react-i18next'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { blockStepCm } from '@/lib/blockGrid'
import BlockPicker from '../BlockPicker'
import type { FurnitureItem, FurnitureVariant, BlockSize } from '@/types'

export default function PlacementSection({
  item,
  variant,
  categoryDefaultBlock,
  categoryIsFlat,
}: {
  item: FurnitureItem
  variant: FurnitureVariant
  categoryDefaultBlock: BlockSize
  categoryIsFlat: boolean
}) {
  const { t } = useTranslation()
  const { updateItem, updateVariant } = useCatalogStore()

  const effectiveBlock = item.block_size_override ?? categoryDefaultBlock
  const effectiveIsFlat = item.is_flat_override ?? categoryIsFlat
  const stepCm = blockStepCm(effectiveBlock)

  const widthCm = variant.width_cm ?? item.width_cm ?? stepCm
  const depthCm = variant.depth_cm ?? item.depth_cm ?? stepCm
  const heightCm = variant.height_cm ?? item.height_cm ?? stepCm

  const setBlockOverride = (size: BlockSize | null) => {
    void updateItem(item.id, { block_size_override: size })
  }
  const setFlatOverride = (flat: boolean | null) => {
    void updateItem(item.id, { is_flat_override: flat })
  }
  const setDims = (w: number, d: number) => {
    void updateVariant(variant.id, { width_cm: w, depth_cm: d })
  }
  const setHeight = (h: number) => {
    void updateVariant(variant.id, { height_cm: h })
  }

  return (
    <div className="panel-section">
      <span className="section-title">{t('editor.properties.placement')}</span>

      {/* Block size — category default + override */}
      <div className="pc-row">
        <label className="pc-label">{t('editor.properties.blockSize')}</label>
        <div className="pc-segmented">
          <button
            type="button"
            className={`pc-seg ${item.block_size_override === null || item.block_size_override === undefined ? 'active' : ''}`}
            onClick={() => setBlockOverride(null)}
            title={t('editor.properties.inheritFromCategory', { value: categoryDefaultBlock === 'small' ? t('editor.properties.small') : t('editor.properties.big') })}
          >
            {t('editor.properties.auto')}
          </button>
          <button
            type="button"
            className={`pc-seg ${item.block_size_override === 'big' ? 'active' : ''}`}
            onClick={() => setBlockOverride('big')}
          >
            {t('editor.properties.big')}
          </button>
          <button
            type="button"
            className={`pc-seg ${item.block_size_override === 'small' ? 'active' : ''}`}
            onClick={() => setBlockOverride('small')}
          >
            {t('editor.properties.small')}
          </button>
        </div>
      </div>
      <span
        className="pc-hint"
        dangerouslySetInnerHTML={{
          __html: t('editor.properties.usingBlockHint', {
            block: effectiveBlock === 'small' ? t('editor.properties.small') : t('editor.properties.big'),
            step: stepCm,
            suffix: item.block_size_override === null || item.block_size_override === undefined
              ? t('editor.properties.usingBlockSuffixDefault')
              : t('editor.properties.usingBlockSuffixOverride'),
          }),
        }}
      />

      {/* Flat-item toggle */}
      <div className="pc-row">
        <label className="pc-label">{t('editor.properties.flatItem')}</label>
        <div className="pc-segmented">
          <button
            type="button"
            className={`pc-seg ${item.is_flat_override === null || item.is_flat_override === undefined ? 'active' : ''}`}
            onClick={() => setFlatOverride(null)}
            title={t('editor.properties.inheritFromCategoryFlat', { value: categoryIsFlat ? t('editor.properties.flat') : t('editor.properties.standard') })}
          >
            {t('editor.properties.auto')}
          </button>
          <button
            type="button"
            className={`pc-seg ${item.is_flat_override === false ? 'active' : ''}`}
            onClick={() => setFlatOverride(false)}
          >
            {t('editor.properties.standard')}
          </button>
          <button
            type="button"
            className={`pc-seg ${item.is_flat_override === true ? 'active' : ''}`}
            onClick={() => setFlatOverride(true)}
          >
            {t('editor.properties.flat')}
          </button>
        </div>
      </div>
      <span
        className="pc-hint"
        dangerouslySetInnerHTML={{
          __html: t('editor.properties.usingFlatHint', {
            value: effectiveIsFlat ? t('editor.properties.flat') : t('editor.properties.standard'),
            suffix: effectiveIsFlat ? t('editor.properties.usingFlatSuffixFlat') : t('editor.properties.usingFlatSuffixStandard'),
          }),
        }}
      />

      {/* Dimensions */}
      <div className="pc-dims-row">
        <div className="pc-dims-col">
          <span className="pc-dims-label">{t('editor.properties.footprint')}</span>
          <BlockPicker
            widthCm={widthCm}
            depthCm={depthCm}
            stepCm={stepCm}
            onChange={setDims}
          />
        </div>
        <div className="pc-dims-col pc-dims-col--narrow">
          <span className="pc-dims-label">{t('editor.properties.fineTune')}</span>
          <div className="pc-cm-row">
            <label className="pc-cm-label">{t('editor.properties.widthShort')}</label>
            <input
              type="number"
              className="pc-cm-input"
              min={1}
              value={widthCm}
              onChange={(e) => setDims(Math.max(1, parseInt(e.target.value) || 0), depthCm)}
            />
          </div>
          <div className="pc-cm-row">
            <label className="pc-cm-label">{t('editor.properties.depthShort')}</label>
            <input
              type="number"
              className="pc-cm-input"
              min={1}
              value={depthCm}
              onChange={(e) => setDims(widthCm, Math.max(1, parseInt(e.target.value) || 0))}
            />
          </div>
          <div className="pc-cm-row">
            <label className="pc-cm-label">{t('editor.properties.heightShort')}</label>
            <input
              type="number"
              className="pc-cm-input"
              min={1}
              value={heightCm}
              onChange={(e) => setHeight(Math.max(1, parseInt(e.target.value) || 0))}
              disabled={effectiveIsFlat}
            />
          </div>
        </div>
      </div>

      <style>{`
        .pc-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-top: 8px;
        }
        .pc-label {
          font-size: 11px;
          font-weight: 500;
          color: var(--color-text-secondary);
        }
        .pc-segmented {
          display: flex;
          border: 1px solid var(--color-border-custom);
          border-radius: 6px;
          overflow: hidden;
        }
        .pc-seg {
          padding: 3px 8px;
          border: none;
          border-right: 1px solid var(--color-border-custom);
          background: transparent;
          color: var(--color-text-secondary);
          font-size: 10px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.1s;
        }
        .pc-seg:last-child {
          border-right: none;
        }
        .pc-seg:hover {
          background: var(--color-hover-bg);
        }
        .pc-seg.active {
          background: var(--color-primary-brand);
          color: white;
        }
        .pc-hint {
          font-size: 10px;
          color: var(--color-text-secondary);
          margin-top: 3px;
          display: block;
        }
        .pc-dims-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          margin-top: 10px;
          align-items: start;
        }
        .pc-dims-col {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .pc-dims-col--narrow {
          width: 70px;
        }
        .pc-dims-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .pc-cm-row {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .pc-cm-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--color-text-secondary);
          width: 12px;
        }
        .pc-cm-input {
          flex: 1;
          padding: 3px 5px;
          border: 1px solid var(--color-border-custom);
          border-radius: 4px;
          background: var(--color-input-bg);
          font-size: 11px;
          font-family: inherit;
          outline: none;
          width: 100%;
        }
        .pc-cm-input:focus {
          border-color: var(--color-primary-brand);
        }
        .pc-cm-input:disabled {
          opacity: 0.4;
        }
      `}</style>
    </div>
  )
}
