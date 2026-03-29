import { useEffect, useState } from 'react'
import { Search, Plus, CheckCircle, Clock } from 'lucide-react'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useAuthStore } from '@/stores/useAuthStore'
import FurnitureItemCard from './FurnitureItemCard'
import AddFurnitureModal from './AddFurnitureModal'
import ImageApprovalModal from './ImageApprovalModal'
import type { FurnitureItem, FurnitureVariant } from '@/types'

export default function CatalogPanel() {
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
    getPendingApprovalVariants,
  } = useCatalogStore()
  const { profile } = useAuthStore()

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [approvalTarget, setApprovalTarget] = useState<{
    item: FurnitureItem
    variant: FurnitureVariant
  } | null>(null)
  // Admin filter: 'all' | 'pending'
  const [adminFilter, setAdminFilter] = useState<'all' | 'pending'>('all')

  // ─── Load on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    loadCategories()
    loadStyles()
    loadItems()
  }, [loadCategories, loadStyles, loadItems])

  // Load variants for each visible item
  const filteredItems = getFilteredItems()

  useEffect(() => {
    for (const item of filteredItems) {
      if (!useCatalogStore.getState().variants[item.id]) {
        loadVariantsForItem(item.id)
      }
    }
  }, [filteredItems.length, loadVariantsForItem])

  // Poll for variant status updates (processing bg removal or 3D rendering)
  useEffect(() => {
    const interval = setInterval(() => {
      const state = useCatalogStore.getState()
      for (const item of filteredItems) {
        const variants = state.variants[item.id] ?? []
        const hasProcessing = variants.some(
          (v) => v.image_status === 'processing' || v.render_status === 'processing'
        )
        if (hasProcessing) {
          loadVariantsForItem(item.id)
        }
      }
    }, 5000) // Check every 5 seconds
    return () => clearInterval(interval)
  }, [filteredItems, loadVariantsForItem])

  // ─── Admin pending filter ─────────────────────────────────────────────────

  const displayItems = adminFilter === 'pending' && profile?.role === 'admin'
    ? filteredItems.filter((i) => i.status === 'pending')
    : filteredItems

  const pendingApprovalVariants = getPendingApprovalVariants()

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleItemClick = (itemId: string) => {
    setSelectedItemId((prev) => (prev === itemId ? null : itemId))
  }

  const handleImageApprovalClick = (item: FurnitureItem, variant: FurnitureVariant) => {
    setApprovalTarget({ item, variant })
  }

  return (
    <div className="catalog-panel">
      {/* Search */}
      <div className="catalog-search-row">
        <div className="catalog-search-wrap">
          <Search size={13} className="catalog-search-icon" />
          <input
            className="catalog-search-input"
            placeholder="Search furniture…"
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
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            className={`category-pill ${selectedCategoryId === cat.id ? 'active' : ''}`}
            onClick={() => setSelectedCategory(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Admin controls */}
      {profile?.role === 'admin' && (
        <div className="catalog-admin-row">
          <button
            className={`admin-filter-btn ${adminFilter === 'all' ? 'active' : ''}`}
            onClick={() => setAdminFilter('all')}
          >
            All
          </button>
          <button
            className={`admin-filter-btn ${adminFilter === 'pending' ? 'active' : ''}`}
            onClick={() => setAdminFilter('pending')}
          >
            <Clock size={11} />
            Pending
            {filteredItems.filter((i) => i.status === 'pending').length > 0 && (
              <span className="admin-pending-count">
                {filteredItems.filter((i) => i.status === 'pending').length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Image approval banner */}
      {pendingApprovalVariants.length > 0 && (
        <div className="approval-banner">
          <CheckCircle size={13} />
          <span>
            {pendingApprovalVariants.length} image{pendingApprovalVariants.length > 1 ? 's' : ''} need your approval
          </span>
          <button
            className="approval-banner-btn"
            onClick={() => setApprovalTarget(pendingApprovalVariants[0])}
          >
            Review
          </button>
        </div>
      )}

      {/* Item list */}
      <div className="catalog-list">
        {isLoading && displayItems.length === 0 && (
          <div className="catalog-empty">Loading…</div>
        )}

        {!isLoading && displayItems.length === 0 && (
          <div className="catalog-empty">
            {searchQuery || selectedCategoryId
              ? 'No items match your search'
              : 'No furniture yet. Add your first item.'}
          </div>
        )}

        {displayItems.map((item) => {
          const variants = getVariantsForItem(item.id)
          const category = categories.find((c) => c.id === item.category_id)

          return (
            <div key={item.id}>
              <FurnitureItemCard
                item={item}
                variants={variants}
                category={category}
                isSelected={selectedItemId === item.id}
                onClick={() => handleItemClick(item.id)}
              />

              {/* Expanded: image approval buttons + admin actions */}
              {selectedItemId === item.id && (
                <div className="item-expanded">
                  {/* Image approval buttons */}
                  {variants
                    .filter((v) => v.image_status === 'pending_approval')
                    .map((v) => (
                      <button
                        key={v.id}
                        className="approval-inline-btn"
                        onClick={() => handleImageApprovalClick(item, v)}
                      >
                        <CheckCircle size={12} />
                        Review "{v.color_name}" image
                      </button>
                    ))}

                  {/* Admin catalog approval */}
                  {profile?.role === 'admin' && item.status === 'pending' && (
                    <div className="admin-actions">
                      <span className="admin-actions-label">Catalog approval</span>
                      <div className="admin-actions-btns">
                        <button
                          className="admin-approve-btn"
                          onClick={() => approveItem(item.id)}
                        >
                          Approve
                        </button>
                        <button
                          className="admin-reject-btn"
                          onClick={() => rejectItem(item.id)}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Submit for review (designer, draft) */}
                  {profile?.role !== 'admin' && item.status === 'draft' && (
                    <button
                      className="submit-review-btn"
                      onClick={() => useCatalogStore.getState().submitItemForReview(item.id)}
                    >
                      Submit for review
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add Furniture button */}
      <div className="catalog-footer">
        <button className="add-furniture-btn" onClick={() => setShowAddModal(true)}>
          <Plus size={14} />
          Add Furniture
        </button>
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddFurnitureModal onClose={() => setShowAddModal(false)} />
      )}
      {approvalTarget && (
        <ImageApprovalModal
          item={approvalTarget.item}
          variant={approvalTarget.variant}
          onClose={() => setApprovalTarget(null)}
          onNext={() => {
            // Advance to next pending variant if any
            const pending = getPendingApprovalVariants()
            const nextIdx = pending.findIndex((p) => p.variant.id !== approvalTarget.variant.id)
            setApprovalTarget(nextIdx >= 0 ? pending[nextIdx] : null)
          }}
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
        .catalog-list {
          flex: 1;
          overflow-y: auto;
          padding: 0 12px;
        }
        .catalog-empty {
          font-size: 12px;
          color: var(--color-text-secondary);
          text-align: center;
          padding: 24px 0;
        }
        .item-expanded {
          margin: -2px 0 6px;
          padding: 8px 10px;
          background: var(--color-primary-brand-light);
          border: 1px solid var(--color-primary-brand);
          border-top: none;
          border-radius: 0 0 10px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .approval-inline-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid var(--color-warning);
          background: var(--color-warning-bg);
          color: var(--color-warning-text);
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
        }
        .approval-inline-btn:hover {
          background: rgba(245, 166, 35, 0.15);
        }
        .admin-actions {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .admin-actions-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.4px;
          color: var(--color-text-secondary);
          text-transform: uppercase;
        }
        .admin-actions-btns {
          display: flex;
          gap: 6px;
        }
        .admin-approve-btn {
          flex: 1;
          padding: 5px;
          border-radius: 6px;
          border: none;
          background: var(--color-success);
          color: white;
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
        }
        .admin-reject-btn {
          flex: 1;
          padding: 5px;
          border-radius: 6px;
          border: none;
          background: var(--color-error);
          color: white;
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
        }
        .submit-review-btn {
          width: 100%;
          padding: 6px;
          border-radius: 6px;
          border: 1.5px solid var(--color-primary-brand);
          background: transparent;
          color: var(--color-primary-brand);
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
        }
        .submit-review-btn:hover {
          background: var(--color-primary-brand-light);
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
