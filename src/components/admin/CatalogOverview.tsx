import { useEffect, useState } from 'react'
import { Search, Package, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { FurnitureItem, FurnitureCategory, FurnitureVariant, FurnitureSprite, ItemStatus } from '@/types'

type StatusFilter = 'all' | ItemStatus

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--color-text-secondary)',
  pending: 'var(--color-warning)',
  approved: 'var(--color-success)',
  rejected: 'var(--color-error)',
}

export default function CatalogOverview() {
  const [items, setItems] = useState<FurnitureItem[]>([])
  const [categories, setCategories] = useState<FurnitureCategory[]>([])
  const [variantsByItem, setVariantsByItem] = useState<Map<string, FurnitureVariant[]>>(new Map())
  const [spritesByVariant, setSpritesByVariant] = useState<Map<string, FurnitureSprite[]>>(new Map())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      const [itemsRes, catsRes, variantsRes, spritesRes] = await Promise.all([
        supabase.from('furniture_items').select('*').order('created_at', { ascending: false }),
        supabase.from('furniture_categories').select('*').order('sort_order', { ascending: true }),
        supabase.from('furniture_variants').select('*').order('sort_order', { ascending: true }),
        supabase.from('furniture_sprites').select('*'),
      ])
      if (itemsRes.data) setItems(itemsRes.data as FurnitureItem[])
      if (catsRes.data) setCategories(catsRes.data as FurnitureCategory[])
      if (variantsRes.data) {
        const map = new Map<string, FurnitureVariant[]>()
        for (const v of variantsRes.data as FurnitureVariant[]) {
          const list = map.get(v.furniture_item_id) ?? []
          list.push(v)
          map.set(v.furniture_item_id, list)
        }
        setVariantsByItem(map)
      }
      if (spritesRes.data) {
        const map = new Map<string, FurnitureSprite[]>()
        for (const s of spritesRes.data as FurnitureSprite[]) {
          const list = map.get(s.variant_id) ?? []
          list.push(s)
          map.set(s.variant_id, list)
        }
        setSpritesByVariant(map)
      }
      setIsLoading(false)
    }
    load()
  }, [])

  const catMap = new Map(categories.map((c) => [c.id, c.name]))

  const getSpriteUrl = (path: string) =>
    supabase.storage.from('sprites').getPublicUrl(path).data.publicUrl

  const filteredItems = items.filter((item) => {
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter
    const matchesCategory = categoryFilter === 'all' || item.category_id === categoryFilter
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase())
    return matchesStatus && matchesCategory && matchesSearch
  })

  const statusCounts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="catalog-overview">
      {/* Summary cards */}
      <div className="catalog-summary">
        <div className="summary-card summary-total">
          <span className="summary-value">{items.length}</span>
          <span className="summary-label">Total Items</span>
        </div>
        {STATUS_FILTERS.filter((f) => f.value !== 'all').map((f) => (
          <div key={f.value} className="summary-card">
            <span className="summary-value" style={{ color: STATUS_COLORS[f.value] }}>
              {statusCounts[f.value] ?? 0}
            </span>
            <span className="summary-label">{f.label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="catalog-filters">
        <div className="catalog-search-wrapper">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="catalog-search-input"
          />
        </div>
        <div className="catalog-status-pills">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`catalog-status-pill ${statusFilter === f.value ? 'active' : ''}`}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
              {f.value !== 'all' && <span className="pill-count">{statusCounts[f.value] ?? 0}</span>}
            </button>
          ))}
        </div>
        <div className="catalog-category-pills">
          <button
            className={`catalog-category-pill ${categoryFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            All Categories
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`catalog-category-pill ${categoryFilter === cat.id ? 'active' : ''}`}
              onClick={() => setCategoryFilter(cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Items list */}
      {isLoading ? (
        <p className="catalog-loading">Loading catalog…</p>
      ) : filteredItems.length === 0 ? (
        <div className="catalog-empty">
          <Package size={32} strokeWidth={1.5} />
          <p>No items match the current filter</p>
        </div>
      ) : (
        <div className="catalog-items-list">
          {filteredItems.map((item) => {
            const variants = variantsByItem.get(item.id) ?? []
            const thumbVariant = variants[0]
            const thumbUrl = thumbVariant?.clean_image_url || thumbVariant?.original_image_url
            const isExpanded = expandedId === item.id
            return (
              <div key={item.id} className={`catalog-item-card ${isExpanded ? 'expanded' : ''}`}>
                <div className="catalog-item-row" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                  <span className="catalog-expand-icon">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  {thumbUrl ? (
                    <img src={thumbUrl} alt={item.name} className="catalog-item-thumb" />
                  ) : (
                    <div className="catalog-item-thumb-empty">
                      <Package size={16} />
                    </div>
                  )}
                  <div className="catalog-item-info">
                    <div className="catalog-item-top">
                      <span className="catalog-item-dot" style={{ background: STATUS_COLORS[item.status] }} />
                      <span className="catalog-item-name">{item.name}</span>
                      <span className="catalog-item-status-badge" style={{ background: STATUS_COLORS[item.status] }}>
                        {item.status}
                      </span>
                    </div>
                    <div className="catalog-item-bottom">
                      <span className="catalog-item-category">{catMap.get(item.category_id) ?? '—'}</span>
                      <span className="catalog-item-domain">{item.source_domain}</span>
                      {item.width_cm && item.depth_cm && (
                        <span className="catalog-item-dims">{item.width_cm}×{item.depth_cm}{item.height_cm ? `×${item.height_cm}` : ''} cm</span>
                      )}
                      <span className="catalog-item-date">
                        {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                  {!isExpanded && variants.length > 1 && (
                    <div className="catalog-item-swatches">
                      {variants.slice(0, 5).map((v) => (
                        <img
                          key={v.id}
                          src={v.clean_image_url || v.original_image_url}
                          alt={v.color_name}
                          title={v.color_name}
                          className="catalog-swatch-thumb"
                        />
                      ))}
                      {variants.length > 5 && (
                        <span className="catalog-swatch-more">+{variants.length - 5}</span>
                      )}
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="catalog-item-detail">
                    {item.description && <p className="catalog-detail-desc">{item.description}</p>}
                    {item.source_url && item.source_url !== 'manual' && (
                      <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="catalog-detail-link">
                        <ExternalLink size={11} />
                        {item.source_domain}
                      </a>
                    )}

                    {variants.length === 0 ? (
                      <p className="catalog-detail-empty">No variants added yet</p>
                    ) : (
                      <div className="catalog-variants-grid">
                        {variants.map((v) => {
                          const sprites = spritesByVariant.get(v.id) ?? []
                          const dirOrder = ['front_left', 'front_right', 'back_left', 'back_right']
                          const sortedSprites = dirOrder
                            .map((d) => sprites.find((s) => s.direction === d))
                            .filter(Boolean) as FurnitureSprite[]
                          return (
                            <div key={v.id} className="catalog-variant-section">
                              <div className="catalog-variant-header">
                                <span className="catalog-variant-color">{v.color_name}</span>
                                {v.price_thb != null && (
                                  <span className="catalog-variant-price">฿{v.price_thb.toLocaleString()}</span>
                                )}
                                <span className="catalog-variant-img-status" style={{ color: STATUS_COLORS[v.image_status === 'approved' ? 'approved' : v.image_status === 'rejected' ? 'rejected' : 'pending'] }}>
                                  {v.image_status.replace('_', ' ')}
                                </span>
                              </div>
                              <div className="catalog-variant-images">
                                <div className="catalog-img-col">
                                  <span className="catalog-img-label">Original</span>
                                  <img src={v.original_image_url} alt="Original" className="catalog-detail-img" />
                                </div>
                                {v.clean_image_url && (
                                  <div className="catalog-img-col">
                                    <span className="catalog-img-label">Clean</span>
                                    <img src={v.clean_image_url} alt="Clean" className="catalog-detail-img catalog-detail-img-clean" />
                                  </div>
                                )}
                                {sortedSprites.length > 0 && (
                                  <div className="catalog-img-col catalog-sprites-col">
                                    <span className="catalog-img-label">3D Sprites</span>
                                    <div className="catalog-sprites-row">
                                      {sortedSprites.map((s) => (
                                        <div key={s.id} className="catalog-sprite-cell">
                                          <img src={getSpriteUrl(s.image_path)} alt={s.direction} className="catalog-sprite-img" />
                                          <span className="catalog-sprite-dir">{s.direction.replace('_', ' ')}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        .catalog-overview {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .catalog-summary {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 10px;
        }
        .summary-card {
          background: var(--color-card-bg);
          border: 1px solid var(--color-border-custom);
          border-radius: 10px;
          padding: 12px;
          text-align: center;
        }
        .summary-total {
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          border: none;
          color: white;
        }
        .summary-total .summary-value { color: white; }
        .summary-total .summary-label { color: rgba(255,255,255,0.8); }
        .summary-value {
          display: block;
          font-size: 22px;
          font-weight: 800;
          color: var(--color-text-primary);
        }
        .summary-label {
          display: block;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
          margin-top: 2px;
        }
        .catalog-filters {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .catalog-search-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: var(--color-input-bg);
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
          color: var(--color-text-secondary);
        }
        .catalog-search-input {
          flex: 1;
          border: none;
          background: none;
          outline: none;
          font-size: 13px;
          font-family: inherit;
          color: var(--color-text-primary);
        }
        .catalog-search-input::placeholder {
          color: var(--color-text-secondary);
        }
        .catalog-status-pills {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .catalog-status-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 12px;
          border-radius: 8px;
          border: none;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          background: var(--color-hover-bg);
          color: var(--color-text-secondary);
          transition: all 0.15s;
        }
        .catalog-status-pill.active {
          background: var(--color-primary-brand);
          color: white;
        }
        .pill-count {
          font-size: 10px;
          font-weight: 700;
          opacity: 0.7;
        }
        .catalog-category-pills {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .catalog-category-pill {
          padding: 4px 10px;
          border-radius: 6px;
          border: none;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          background: var(--color-hover-bg);
          color: var(--color-text-secondary);
          transition: all 0.15s;
        }
        .catalog-category-pill.active {
          background: var(--color-secondary);
          color: white;
        }
        .catalog-loading {
          color: var(--color-text-secondary);
          font-size: 13px;
          padding: 20px;
        }
        .catalog-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 40px 20px;
          color: var(--color-text-secondary);
          font-size: 13px;
        }
        .catalog-items-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .catalog-item-card {
          border-radius: 10px;
          background: var(--color-card-bg);
          border: 1px solid var(--color-border-custom);
          overflow: hidden;
          transition: border-color 0.15s;
        }
        .catalog-item-card.expanded {
          border-color: var(--color-primary-brand);
        }
        .catalog-item-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .catalog-item-row:hover {
          background: var(--color-primary-brand-light);
        }
        .catalog-expand-icon {
          color: var(--color-text-secondary);
          flex-shrink: 0;
          display: flex;
        }
        .catalog-item-thumb {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          object-fit: cover;
          border: 1px solid var(--color-border-custom);
          background: white;
          flex-shrink: 0;
        }
        .catalog-item-thumb-empty {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          border: 1px solid var(--color-border-custom);
          background: var(--color-hover-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-secondary);
          flex-shrink: 0;
        }
        .catalog-item-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .catalog-item-top {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .catalog-item-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .catalog-item-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .catalog-item-status-badge {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 2px 6px;
          border-radius: 4px;
          color: white;
          flex-shrink: 0;
        }
        .catalog-item-bottom {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 11px;
          color: var(--color-text-secondary);
        }
        .catalog-item-category {
          font-weight: 500;
        }
        .catalog-item-domain {
          font-size: 10px;
        }
        .catalog-item-dims {
          font-size: 10px;
        }
        .catalog-item-date {
          font-size: 10px;
          margin-left: auto;
        }
        .catalog-item-swatches {
          display: flex;
          gap: 4px;
          align-items: center;
          flex-shrink: 0;
        }
        .catalog-swatch-thumb {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          object-fit: cover;
          border: 1px solid var(--color-border-custom);
          background: white;
        }
        .catalog-swatch-more {
          font-size: 10px;
          font-weight: 600;
          color: var(--color-text-secondary);
        }

        /* Expanded detail */
        .catalog-item-detail {
          padding: 12px 16px 16px;
          border-top: 1px solid var(--color-border-custom);
        }
        .catalog-detail-desc {
          font-size: 12px;
          color: var(--color-text-secondary);
          line-height: 1.4;
          margin-bottom: 8px;
        }
        .catalog-detail-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--color-primary-brand);
          text-decoration: none;
          margin-bottom: 12px;
        }
        .catalog-detail-link:hover {
          text-decoration: underline;
        }
        .catalog-detail-empty {
          font-size: 12px;
          color: var(--color-text-secondary);
          padding: 12px 0;
        }
        .catalog-variants-grid {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .catalog-variant-section {
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
          padding: 10px;
        }
        .catalog-variant-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }
        .catalog-variant-color {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
        }
        .catalog-variant-price {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-primary-brand);
        }
        .catalog-variant-img-status {
          font-size: 10px;
          font-weight: 500;
          text-transform: capitalize;
          margin-left: auto;
        }
        .catalog-variant-images {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .catalog-img-col {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .catalog-img-label {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }
        .catalog-detail-img {
          width: 120px;
          height: 120px;
          border-radius: 8px;
          object-fit: cover;
          border: 1px solid var(--color-border-custom);
          background: white;
        }
        .catalog-detail-img-clean {
          background: repeating-conic-gradient(#e8e8e8 0% 25%, white 0% 50%) 50% / 16px 16px;
        }
        .catalog-sprites-col {
          flex: 1;
          min-width: 0;
        }
        .catalog-sprites-row {
          display: flex;
          gap: 6px;
        }
        .catalog-sprite-cell {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .catalog-sprite-img {
          width: 80px;
          height: 80px;
          border-radius: 6px;
          object-fit: contain;
          border: 1px solid var(--color-border-custom);
          background: repeating-conic-gradient(#e8e8e8 0% 25%, white 0% 50%) 50% / 12px 12px;
        }
        .catalog-sprite-dir {
          font-size: 8px;
          color: var(--color-text-secondary);
          text-transform: capitalize;
        }
      `}</style>
    </div>
  )
}
