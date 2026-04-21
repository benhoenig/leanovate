import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Plus, CheckCircle, Clock, X, MousePointerClick } from 'lucide-react'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { getPublicStorageUrl } from '@/lib/supabase'
import FurnitureItemCard from './FurnitureItemCard'
import AddFurnitureModal from './AddFurnitureModal'
import ModelApprovalModal from './ModelApprovalModal'
import type { FurnitureItem, FurnitureVariant } from '@/types'

export default function CatalogPanel() {
  const { t } = useTranslation()
  const {
    categories,
    searchQuery,
    selectedCategoryId,
    isLoading,
    loadCategories,
    loadStyles,
    loadItems,
    loadVariantsForItem,
    getFilteredItems,
    getVariantsForItem,
    setSearchQuery,
    setSelectedCategory,
    approveItem,
    rejectItem,
    isItemFlat,
    getPendingRenderApprovalVariants,
  } = useCatalogStore()
  const { profile } = useAuthStore()

  const [detailItemId, setDetailItemId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [approvalTarget, setApprovalTarget] = useState<{
    item: FurnitureItem
    variant: FurnitureVariant
  } | null>(null)
  const [adminFilter, setAdminFilter] = useState<'all' | 'pending'>('all')

  // ─── Load on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    loadCategories()
    loadStyles()
    loadItems()
  }, [loadCategories, loadStyles, loadItems])

  const filteredItems = getFilteredItems()

  useEffect(() => {
    for (const item of filteredItems) {
      if (!useCatalogStore.getState().variants[item.id]) {
        loadVariantsForItem(item.id)
      }
    }
  }, [filteredItems.length, loadVariantsForItem])

  // Poll for variant status updates (3D generation in progress). Gated on
  // `isLoading` so the poll never fires while the initial `loadItems` or
  // `loadVariantsForItem` reads are in flight (those use the Supabase client
  // and would deadlock against a concurrent poll).
  useEffect(() => {
    if (isLoading) return
    const interval = setInterval(() => {
      const state = useCatalogStore.getState()
      for (const item of filteredItems) {
        const variants = state.variants[item.id] ?? []
        const hasProcessing = variants.some(
          (v) => v.render_status === 'processing' || v.render_status === 'waiting',
        )
        if (hasProcessing) {
          loadVariantsForItem(item.id)
        }
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [filteredItems, isLoading, loadVariantsForItem])

  // ─── Visible items (hide wall-mount categories — they live in Fixtures tab) ─

  const floorCategoryIds = new Set(
    categories.filter((c) => (c.mount_type ?? 'floor') === 'floor').map((c) => c.id),
  )
  const floorFilteredItems = filteredItems.filter((i) => floorCategoryIds.has(i.category_id))

  const displayItems =
    adminFilter === 'pending' && profile?.role === 'admin'
      ? floorFilteredItems.filter((i) => i.status === 'pending')
      : floorFilteredItems

  const visibleCategories = categories.filter((c) => (c.mount_type ?? 'floor') === 'floor')
  const pendingApprovalVariants = getPendingRenderApprovalVariants()

  // ─── Handlers ─────────────────────────────────────────────────────────────

  /** Click a tile → enter placement mode with the item's first usable variant. */
  const handlePlaceItem = (item: FurnitureItem) => {
    const variants = getVariantsForItem(item.id)
    const withGlb = variants.find((v) => v.render_status === 'completed')
    const firstVariant = withGlb ?? variants[0]
    if (!firstVariant) {
      // No variants uploaded yet — open details so the user can see the state.
      setDetailItemId(item.id)
      return
    }
    useCanvasStore.getState().setPlacementMode(true, item.id, firstVariant.id)
  }

  const detailItem = detailItemId ? displayItems.find((i) => i.id === detailItemId) ?? null : null

  return (
    <div className="catalog-panel">
      {/* Search */}
      <div className="catalog-search-row">
        <div className="catalog-search-wrap">
          <Search size={13} className="catalog-search-icon" />
          <input
            className="catalog-search-input"
            placeholder={t('catalog.searchPlaceholderLong')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Category pills */}
      <div className="catalog-category-row">
        <button
          className={`category-pill ${selectedCategoryId === null ? 'active' : ''}`}
          onClick={() => setSelectedCategory(null)}
        >
          {t('catalog.categoryAll')}
        </button>
        {visibleCategories.map((cat) => (
          <button
            key={cat.id}
            className={`category-pill ${selectedCategoryId === cat.id ? 'active' : ''}`}
            onClick={() => setSelectedCategory(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Admin filter */}
      {profile?.role === 'admin' && (
        <div className="catalog-admin-row">
          <button
            className={`admin-filter-btn ${adminFilter === 'all' ? 'active' : ''}`}
            onClick={() => setAdminFilter('all')}
          >
            {t('catalog.categoryAll')}
          </button>
          <button
            className={`admin-filter-btn ${adminFilter === 'pending' ? 'active' : ''}`}
            onClick={() => setAdminFilter('pending')}
          >
            <Clock size={11} />
            {t('catalog.pendingTab')}
            {filteredItems.filter((i) => i.status === 'pending').length > 0 && (
              <span className="admin-pending-count">
                {filteredItems.filter((i) => i.status === 'pending').length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Render approval banner */}
      {pendingApprovalVariants.length > 0 && (
        <div className="approval-banner">
          <CheckCircle size={13} />
          <span>
            {t('catalog.approvalNeedsReview', { count: pendingApprovalVariants.length })}
          </span>
          <button
            className="approval-banner-btn"
            onClick={() => setApprovalTarget(pendingApprovalVariants[0])}
          >
            {t('catalog.review')}
          </button>
        </div>
      )}

      {/* Tile grid */}
      <div className="catalog-grid-wrap">
        {isLoading && displayItems.length === 0 && (
          <div className="catalog-empty">{t('catalog.loading')}</div>
        )}

        {!isLoading && displayItems.length === 0 && (
          <div className="catalog-empty">
            {searchQuery || selectedCategoryId
              ? t('catalog.noMatch')
              : t('catalog.noItemsCTA')}
          </div>
        )}

        <div className="catalog-grid">
          {displayItems.map((item) => {
            const variants = getVariantsForItem(item.id)
            const category = categories.find((c) => c.id === item.category_id)
            const flat = isItemFlat(item.id)
            return (
              <FurnitureItemCard
                key={item.id}
                item={item}
                variants={variants}
                category={category}
                isFlat={flat}
                onPlace={() => handlePlaceItem(item)}
                onOpenDetails={() => setDetailItemId(item.id)}
              />
            )
          })}
        </div>
      </div>

      {/* Add Furniture button */}
      <div className="catalog-footer">
        <button className="add-furniture-btn" onClick={() => setShowAddModal(true)}>
          <Plus size={14} />
          {t('catalog.addFurniture')}
        </button>
      </div>

      {/* Modals */}
      {showAddModal && <AddFurnitureModal onClose={() => setShowAddModal(false)} />}
      {approvalTarget && (
        <ModelApprovalModal
          item={approvalTarget.item}
          variant={approvalTarget.variant}
          onClose={() => setApprovalTarget(null)}
          onNext={() => {
            const pending = getPendingRenderApprovalVariants()
            const nextIdx = pending.findIndex((p) => p.variant.id !== approvalTarget.variant.id)
            setApprovalTarget(nextIdx >= 0 ? pending[nextIdx] : null)
          }}
        />
      )}
      {detailItem && (
        <ItemDetailDrawer
          item={detailItem}
          variants={getVariantsForItem(detailItem.id)}
          isAdmin={profile?.role === 'admin'}
          onClose={() => setDetailItemId(null)}
          onPlaceVariant={(variant) => {
            useCanvasStore.getState().setPlacementMode(true, detailItem.id, variant.id)
            setDetailItemId(null)
          }}
          onReviewVariant={(variant) => {
            setApprovalTarget({ item: detailItem, variant })
          }}
          onApproveItem={() => approveItem(detailItem.id)}
          onRejectItem={() => rejectItem(detailItem.id)}
          onSubmitForReview={() =>
            useCatalogStore.getState().submitItemForReview(detailItem.id)
          }
        />
      )}

      <style>{`
        .catalog-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .catalog-search-row {
          padding: 10px 12px 6px;
          flex-shrink: 0;
        }
        .catalog-search-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .catalog-search-icon {
          position: absolute;
          left: 8px;
          color: var(--color-text-secondary);
          pointer-events: none;
        }
        .catalog-search-input {
          width: 100%;
          padding: 7px 8px 7px 28px;
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
          background: var(--color-input-bg);
          font-size: 12px;
          font-family: inherit;
          color: var(--color-text-primary);
          outline: none;
        }
        .catalog-search-input:focus {
          border-color: var(--color-primary-brand);
        }
        .catalog-category-row {
          display: flex;
          gap: 4px;
          padding: 0 12px 8px;
          overflow-x: auto;
          flex-shrink: 0;
          scrollbar-width: none;
        }
        .catalog-category-row::-webkit-scrollbar { display: none; }
        .category-pill {
          padding: 4px 10px;
          border-radius: 6px;
          border: none;
          font-size: 11px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s;
          background: var(--color-hover-bg);
          color: var(--color-text-secondary);
          flex-shrink: 0;
        }
        .category-pill.active {
          background: var(--color-primary-brand);
          color: white;
        }
        .catalog-admin-row {
          display: flex;
          gap: 4px;
          padding: 0 12px 8px;
          flex-shrink: 0;
        }
        .admin-filter-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 6px;
          border: none;
          font-size: 11px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          background: var(--color-hover-bg);
          color: var(--color-text-secondary);
          transition: all 0.15s;
        }
        .admin-filter-btn.active {
          background: var(--color-primary-brand);
          color: white;
        }
        .admin-pending-count {
          background: white;
          color: var(--color-primary-brand);
          border-radius: 10px;
          padding: 0 5px;
          font-size: 10px;
          font-weight: 700;
          min-width: 16px;
          text-align: center;
        }
        .approval-banner {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 0 12px 8px;
          padding: 8px 10px;
          background: var(--color-warning-bg);
          border: 1px solid rgba(245, 166, 35, 0.25);
          border-radius: 8px;
          font-size: 11px;
          font-weight: 500;
          color: var(--color-warning-text);
          flex-shrink: 0;
        }
        .approval-banner svg {
          flex-shrink: 0;
          color: var(--color-warning);
        }
        .approval-banner span {
          flex: 1;
        }
        .approval-banner-btn {
          background: var(--color-warning);
          color: white;
          border: none;
          border-radius: 5px;
          padding: 3px 8px;
          font-size: 10px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
        }
        .catalog-grid-wrap {
          flex: 1;
          overflow-y: auto;
          padding: 2px 12px 12px;
        }
        .catalog-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .catalog-empty {
          font-size: 12px;
          color: var(--color-text-secondary);
          text-align: center;
          padding: 24px 0;
        }
        .catalog-footer {
          padding: 10px 12px;
          border-top: 1px solid var(--color-border-custom);
          flex-shrink: 0;
        }
        .add-furniture-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px;
          border-radius: 10px;
          border: 1.5px dashed var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
        }
        .add-furniture-btn:hover {
          background: rgba(43, 168, 160, 0.12);
        }
      `}</style>
    </div>
  )
}

// ── Detail drawer ───────────────────────────────────────────────────────────
// Side drawer for the per-item actions that used to live inline in the old
// stacked list view: per-variant placement, per-variant render review, admin
// catalog approve/reject, designer submit-for-review. Rendered as a modal
// overlay (simpler than a sliding panel — the left sidebar is too narrow).

interface ItemDetailDrawerProps {
  item: FurnitureItem
  variants: FurnitureVariant[]
  isAdmin: boolean
  onClose: () => void
  onPlaceVariant: (variant: FurnitureVariant) => void
  onReviewVariant: (variant: FurnitureVariant) => void
  onApproveItem: () => void
  onRejectItem: () => void
  onSubmitForReview: () => void
}

function ItemDetailDrawer({
  item,
  variants,
  isAdmin,
  onClose,
  onPlaceVariant,
  onReviewVariant,
  onApproveItem,
  onRejectItem,
  onSubmitForReview,
}: ItemDetailDrawerProps) {
  const { t, i18n } = useTranslation()
  const localeTag = i18n.resolvedLanguage === 'th' ? 'th-TH' : 'en-US'

  const formatPrice = (p: number | null) =>
    p != null ? `฿${p.toLocaleString(localeTag, { maximumFractionDigits: 0 })}` : '—'

  const variantThumb = (v: FurnitureVariant): string | null => {
    if (v.thumbnail_path) {
      return getPublicStorageUrl('thumbnails', v.thumbnail_path)
    }
    return v.original_image_urls[0] ?? null
  }

  return (
    <div className="detail-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="detail-box">
        <div className="detail-header">
          <div>
            <p className="detail-eyebrow">{item.status.toUpperCase()}</p>
            <h2 className="detail-title">{item.name}</h2>
          </div>
          <button className="detail-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="detail-variants">
          {variants.length === 0 && (
            <div className="detail-empty">{t('catalog.noImage')}</div>
          )}
          {variants.map((v) => {
            const thumb = variantThumb(v)
            const needsReview = v.render_approval_status === 'pending' && !!v.glb_path
            const isProcessing =
              v.render_status === 'processing' || v.render_status === 'waiting'
            return (
              <div key={v.id} className="detail-variant">
                <div className="detail-variant-thumb">
                  {thumb ? (
                    <img src={thumb} alt={v.color_name} />
                  ) : (
                    <div className="detail-variant-placeholder" />
                  )}
                </div>
                <div className="detail-variant-info">
                  <span className="detail-variant-name">{v.color_name}</span>
                  <span className="detail-variant-price">{formatPrice(v.price_thb)}</span>
                  {isProcessing && (
                    <span className="detail-variant-tag info">{t('catalog.generating3D')}</span>
                  )}
                  {needsReview && (
                    <span className="detail-variant-tag warning">
                      {t('catalog.renderApproval.pending')}
                    </span>
                  )}
                </div>
                <div className="detail-variant-actions">
                  {needsReview && (
                    <button className="detail-btn warn" onClick={() => onReviewVariant(v)}>
                      <CheckCircle size={12} />
                      {t('catalog.review')}
                    </button>
                  )}
                  <button
                    className="detail-btn primary"
                    onClick={() => onPlaceVariant(v)}
                    disabled={v.render_status === 'failed'}
                  >
                    <MousePointerClick size={12} />
                    {t('catalog.placeOnCanvas')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Admin catalog gate */}
        {isAdmin && item.status === 'pending' && (
          <div className="detail-admin">
            <span className="detail-admin-label">{t('catalog.catalogApproval')}</span>
            <div className="detail-admin-btns">
              <button className="detail-btn success" onClick={onApproveItem}>
                {t('catalog.approveItem')}
              </button>
              <button className="detail-btn danger" onClick={onRejectItem}>
                {t('catalog.rejectItem')}
              </button>
            </div>
          </div>
        )}

        {/* Designer submit-for-review */}
        {!isAdmin && item.status === 'draft' && (
          <button className="detail-btn primary wide" onClick={onSubmitForReview}>
            {t('catalog.submitReview')}
          </button>
        )}
      </div>

      <style>{`
        .detail-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1005;
          padding: 16px;
        }
        .detail-box {
          background: var(--color-panel-bg);
          border-radius: 14px;
          width: 100%;
          max-width: 520px;
          max-height: 88dvh;
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 18px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
          overflow-y: auto;
        }
        .detail-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
        }
        .detail-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
          margin: 0 0 2px;
        }
        .detail-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--color-text-primary);
          margin: 0;
        }
        .detail-close {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
        }
        .detail-close:hover {
          background: var(--color-hover-bg);
        }
        .detail-variants {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .detail-empty {
          font-size: 12px;
          color: var(--color-text-secondary);
          text-align: center;
          padding: 16px;
        }
        .detail-variant {
          display: flex;
          gap: 10px;
          align-items: center;
          padding: 8px;
          border: 1px solid var(--color-border-custom);
          border-radius: 10px;
          background: var(--color-card-bg);
        }
        .detail-variant-thumb {
          width: 56px;
          height: 56px;
          border-radius: 8px;
          overflow: hidden;
          flex-shrink: 0;
          background: var(--color-hover-bg);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .detail-variant-thumb img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .detail-variant-placeholder {
          width: 100%;
          height: 100%;
          background: var(--color-border-custom);
        }
        .detail-variant-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .detail-variant-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-primary);
        }
        .detail-variant-price {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-primary-brand);
        }
        .detail-variant-tag {
          align-self: flex-start;
          font-size: 10px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 4px;
          margin-top: 2px;
        }
        .detail-variant-tag.warning {
          background: var(--color-warning-bg);
          color: var(--color-warning-text);
        }
        .detail-variant-tag.info {
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
        }
        .detail-variant-actions {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .detail-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 6px 10px;
          border-radius: 6px;
          border: 1.5px solid transparent;
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .detail-btn.primary {
          background: var(--color-primary-brand);
          color: white;
        }
        .detail-btn.primary:hover:not(:disabled) {
          background: var(--color-primary-brand-hover);
        }
        .detail-btn.primary:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .detail-btn.primary.wide {
          width: 100%;
          padding: 9px;
          font-size: 12px;
        }
        .detail-btn.warn {
          background: transparent;
          color: var(--color-warning-text);
          border-color: var(--color-warning);
        }
        .detail-btn.warn:hover {
          background: var(--color-warning-bg);
        }
        .detail-btn.success {
          flex: 1;
          background: var(--color-success);
          color: white;
        }
        .detail-btn.danger {
          flex: 1;
          background: var(--color-error);
          color: white;
        }
        .detail-admin {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-top: 10px;
          border-top: 1px solid var(--color-border-custom);
        }
        .detail-admin-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.4px;
          color: var(--color-text-secondary);
          text-transform: uppercase;
        }
        .detail-admin-btns {
          display: flex;
          gap: 8px;
        }
      `}</style>
    </div>
  )
}
