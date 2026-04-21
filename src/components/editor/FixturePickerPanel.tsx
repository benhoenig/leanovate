/**
 * Fixture Picker — the door/window counterpart to CatalogPanel.
 *
 * Shows admin-curated wall-mount items (Door, Window categories). Clicking a
 * variant enters fixture placement mode so the user can click a wall in the
 * canvas to drop it. Admins see an "Add Fixture" button that opens the
 * existing AddFurnitureModal filtered to wall-mount categories.
 *
 * Designers only see approved variants. Admins see all (same pattern as
 * CatalogPanel).
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, DoorOpen, PanelTop, MousePointerClick, Clock, Trash2 } from 'lucide-react'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAuthStore } from '@/stores/useAuthStore'
import AddFurnitureModal from './AddFurnitureModal'
import type { FurnitureItem, FurnitureVariant, FurnitureCategory } from '@/types'

export default function FixturePickerPanel() {
  const { t } = useTranslation()
  const {
    categories,
    loadCategories,
    loadItems,
    loadVariantsForItem,
    getVariantsForItem,
    deleteItem,
  } = useCatalogStore()
  const items = useCatalogStore((s) => s.items)
  const variantsMap = useCatalogStore((s) => s.variants)
  const { profile } = useAuthStore()
  const fixturePlacementVariantId = useCanvasStore((s) => s.fixturePlacementVariantId)

  const [showAddModal, setShowAddModal] = useState(false)

  // Ensure categories + items are loaded (same side-effect as CatalogPanel)
  useEffect(() => {
    loadCategories()
    loadItems()
  }, [loadCategories, loadItems])

  const wallCategories = categories.filter((c) => c.mount_type === 'wall')
  const wallCategoryIds = new Set(wallCategories.map((c) => c.id))

  // Items belonging to a wall category. Non-admins only see approved items.
  const visibleItems = items.filter((i) => {
    if (!wallCategoryIds.has(i.category_id)) return false
    if (profile?.role === 'admin') return true
    return i.status === 'approved'
  })

  // Load variants for each visible item
  useEffect(() => {
    for (const item of visibleItems) {
      if (!variantsMap[item.id]) loadVariantsForItem(item.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems.length])

  // Poll for in-flight renders
  useEffect(() => {
    const interval = setInterval(() => {
      const state = useCatalogStore.getState()
      for (const item of visibleItems) {
        const variants = state.variants[item.id] ?? []
        const hasProcessing = variants.some(
          (v) => v.render_status === 'processing' || v.render_status === 'waiting'
        )
        if (hasProcessing) loadVariantsForItem(item.id)
      }
    }, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems.length])

  const handleDeleteItem = async (item: FurnitureItem) => {
    if (!window.confirm(t('fixtures.deleteConfirm', { name: item.name }))) return
    const { error } = await deleteItem(item.id)
    if (error) {
      window.alert(error)
    }
  }

  const handleVariantPick = (item: FurnitureItem, variant: FurnitureVariant) => {
    const category = categories.find((c) => c.id === item.category_id)
    const type: 'door' | 'window' | null = category?.name === 'Door' ? 'door'
      : category?.name === 'Window' ? 'window'
      : null
    if (!type) return
    // Toggle: clicking the active variant cancels placement
    if (fixturePlacementVariantId === variant.id) {
      useCanvasStore.getState().setFixturePlacementMode(null)
      return
    }
    useCanvasStore.getState().setFixturePlacementMode(type, variant.id, item.id)
  }

  // Group items by category (Door / Window)
  const grouped: Array<{ category: FurnitureCategory; items: FurnitureItem[] }> = wallCategories
    .map((category) => ({
      category,
      items: visibleItems.filter((i) => i.category_id === category.id),
    }))

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="fixture-panel">
      {isAdmin && (
        <div className="fixture-admin-row">
          <button className="fixture-add-top-btn" onClick={() => setShowAddModal(true)}>
            <Plus size={13} />
            {t('fixtures.addFixture')}
          </button>
        </div>
      )}

      {grouped.every((g) => g.items.length === 0) && (
        <p className="fixture-empty">
          {isAdmin ? t('fixtures.emptyAdmin') : t('fixtures.emptyDesigner')}
        </p>
      )}

      {grouped.map(({ category, items: catItems }) => (
        <div key={category.id} className="fixture-group">
          <div className="fixture-group-header">
            {category.name === 'Door' ? <DoorOpen size={13} /> : <PanelTop size={13} />}
            <span className="fixture-group-title">{category.name}</span>
          </div>
          {catItems.length === 0 && (
            <p className="fixture-group-empty">{t('fixtures.groupEmpty')}</p>
          )}
          {catItems.map((item) => {
            const variants = getVariantsForItem(item.id)
            // Designers see only variants with a .glb (or flat bypass); admins see all
            const visibleVariants = isAdmin
              ? variants
              : variants.filter((v) => v.render_status === 'completed')
            return (
              <div key={item.id} className="fixture-item">
                <div className="fixture-item-header">
                  <div className="fixture-item-name">{item.name}</div>
                  {isAdmin && (
                    <button
                      className="fixture-item-delete"
                      onClick={() => handleDeleteItem(item)}
                      title={t('fixtures.deleteItem')}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className="fixture-variants-row">
                  {visibleVariants.map((v) => {
                    const isActive = fixturePlacementVariantId === v.id
                    const isProcessing = v.render_status === 'processing' || v.render_status === 'waiting'
                    const thumb = v.original_image_urls?.[0]
                    return (
                      <button
                        key={v.id}
                        className={`fixture-variant-btn ${isActive ? 'active' : ''}`}
                        onClick={() => handleVariantPick(item, v)}
                        disabled={isProcessing}
                        title={v.color_name}
                      >
                        {thumb ? (
                          <img src={thumb} alt={v.color_name} className="fixture-variant-img" />
                        ) : (
                          <div className="fixture-variant-placeholder">
                            {v.color_name.slice(0, 2)}
                          </div>
                        )}
                        {isProcessing && (
                          <div className="fixture-variant-overlay">
                            <Clock size={12} />
                          </div>
                        )}
                        {isActive && (
                          <div className="fixture-variant-active-badge">
                            <MousePointerClick size={10} />
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {showAddModal && (
        <AddFurnitureModal
          onClose={() => setShowAddModal(false)}
          mountTypeFilter="wall"
        />
      )}

      <style>{`
        .fixture-panel {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .fixture-admin-row {
          display: flex;
          justify-content: flex-end;
        }
        .fixture-add-top-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 6px 10px;
          border-radius: 7px;
          border: 1.5px dashed var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
        }
        .fixture-add-top-btn:hover {
          background: rgba(43, 168, 160, 0.12);
        }
        .fixture-empty {
          font-size: 12px;
          color: var(--color-text-secondary);
          text-align: center;
          padding: 24px 12px 0;
          line-height: 1.5;
        }
        .fixture-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .fixture-group-header {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--color-text-secondary);
        }
        .fixture-group-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .fixture-group-empty {
          font-size: 11px;
          color: var(--color-text-secondary);
          opacity: 0.6;
          margin: 0;
          padding: 4px 0 4px 19px;
        }
        .fixture-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px 10px;
          background: var(--color-card-bg);
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
        }
        .fixture-item-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .fixture-item-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-primary);
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fixture-item-delete {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 5px;
          border: 1px solid var(--color-border-custom);
          background: transparent;
          color: var(--color-text-secondary);
          padding: 0;
          cursor: pointer;
          transition: all 0.15s;
          flex-shrink: 0;
        }
        .fixture-item-delete:hover {
          background: var(--color-error);
          border-color: var(--color-error);
          color: white;
        }
        .fixture-variants-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .fixture-variant-btn {
          position: relative;
          width: 42px;
          height: 42px;
          border-radius: 6px;
          border: 2px solid var(--color-border-custom);
          background: var(--color-hover-bg);
          padding: 0;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.15s;
        }
        .fixture-variant-btn:hover:not(:disabled) {
          transform: scale(1.06);
          border-color: var(--color-primary-brand);
        }
        .fixture-variant-btn.active {
          border-color: var(--color-primary-brand);
          box-shadow: 0 0 0 2px var(--color-primary-brand);
        }
        .fixture-variant-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .fixture-variant-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .fixture-variant-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          color: var(--color-text-secondary);
          text-transform: uppercase;
        }
        .fixture-variant-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.45);
          color: white;
        }
        .fixture-variant-active-badge {
          position: absolute;
          top: 2px;
          right: 2px;
          background: var(--color-primary-brand);
          color: white;
          border-radius: 3px;
          padding: 1px 2px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
      `}</style>
    </div>
  )
}
