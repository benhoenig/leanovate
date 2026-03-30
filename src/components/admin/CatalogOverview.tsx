import { useEffect, useState } from 'react'
import { Search, Package, ChevronDown, ChevronRight, ExternalLink, RefreshCw, ImageIcon, Box } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { renderSprites } from '@/lib/renderSprites'
import type { FurnitureItem, FurnitureCategory, FurnitureVariant, FurnitureSprite, ItemStatus } from '@/types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Raw fetch for edge functions — same pattern as TeamManagement / useCatalogStore */
async function invokeEdgeFunction(name: string, body: Record<string, unknown>): Promise<{ error: string | null; data?: Record<string, unknown> }> {
  let token = SUPABASE_ANON_KEY
  try {
    const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.access_token) token = parsed.access_token
    }
  } catch { /* use anon key */ }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { error: data?.error || `HTTP ${res.status}`, data }
    return { error: null, data }
  } catch (err) {
    return { error: String(err) }
  }
}

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
  const [regeneratingBg, setRegeneratingBg] = useState<Set<string>>(new Set())
  const [regeneratingSprites, setRegeneratingSprites] = useState<Set<string>>(new Set())
  const [confirmAction, setConfirmAction] = useState<{ variantId: string; type: 'bg' | 'sprites' } | null>(null)

  const reloadData = async () => {
    const [variantsRes, spritesRes] = await Promise.all([
      supabase.from('furniture_variants').select('*').order('sort_order', { ascending: true }),
      supabase.from('furniture_sprites').select('*'),
    ])
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
  }

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

  const handleRegenerateBg = async (variantId: string) => {
    setConfirmAction(null)
    setRegeneratingBg((prev) => new Set(prev).add(variantId))
    try {
      // Reset image_status to processing
      await supabase.from('furniture_variants').update({ image_status: 'processing', clean_image_url: null }).eq('id', variantId)
      // Call remove-background edge function
      const { error } = await invokeEdgeFunction('remove-background', { variant_id: variantId })
      if (error) console.error('[RegenerateBG] Error:', error)
      await reloadData()
    } catch (err) {
      console.error('[RegenerateBG] Unexpected error:', err)
    }
    setRegeneratingBg((prev) => { const n = new Set(prev); n.delete(variantId); return n })
  }

  const handleRegenerateSprites = async (variant: FurnitureVariant) => {
    setConfirmAction(null)
    setRegeneratingSprites((prev) => new Set(prev).add(variant.id))
    try {
      // Reset render_status to processing
      await supabase.from('furniture_variants').update({ render_status: 'processing' }).eq('id', variant.id)

      if (variant.glb_path) {
        // GLB already exists — just re-render sprites from it
        console.log('[RegenerateSprites] Re-rendering from existing .glb:', variant.glb_path)
        await renderSprites(variant.id, variant.glb_path)
      } else if (variant.image_status === 'approved' && variant.clean_image_url) {
        // No GLB — re-run full TRELLIS → sprites pipeline
        console.log('[RegenerateSprites] No .glb, running full TRELLIS → sprites pipeline')
        const { error, data } = await invokeEdgeFunction('generate-3d-model', { variant_id: variant.id })
        if (error) {
          console.error('[RegenerateSprites] TRELLIS error:', error)
          await supabase.from('furniture_variants').update({ render_status: 'failed' }).eq('id', variant.id)
        } else {
          const glbPath = data?.glb_path as string | undefined
          if (glbPath) {
            await renderSprites(variant.id, glbPath)
          } else {
            console.error('[RegenerateSprites] No glb_path in response')
            await supabase.from('furniture_variants').update({ render_status: 'failed' }).eq('id', variant.id)
          }
        }
      } else {
        console.error('[RegenerateSprites] Cannot regenerate: image not approved')
        await supabase.from('furniture_variants').update({ render_status: 'failed' }).eq('id', variant.id)
      }
      await reloadData()
    } catch (err) {
      console.error('[RegenerateSprites] Unexpected error:', err)
    }
    setRegeneratingSprites((prev) => { const n = new Set(prev); n.delete(variant.id); return n })
  }

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
                                <span className="catalog-variant-render-status" style={{ color: STATUS_COLORS[v.render_status === 'completed' ? 'approved' : v.render_status === 'failed' ? 'rejected' : 'pending'] }}>
                                  render: {v.render_status}
                                </span>
                                <div className="catalog-variant-actions">
                                  <button
                                    className="catalog-regen-btn"
                                    disabled={regeneratingBg.has(v.id)}
                                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ variantId: v.id, type: 'bg' }) }}
                                    title="Re-run background removal"
                                  >
                                    {regeneratingBg.has(v.id) ? <RefreshCw size={12} className="spinning" /> : <ImageIcon size={12} />}
                                    Re-run BG
                                  </button>
                                  <button
                                    className="catalog-regen-btn"
                                    disabled={regeneratingSprites.has(v.id)}
                                    onClick={(e) => { e.stopPropagation(); setConfirmAction({ variantId: v.id, type: 'sprites' }) }}
                                    title="Regenerate 3D model and sprites"
                                  >
                                    {regeneratingSprites.has(v.id) ? <RefreshCw size={12} className="spinning" /> : <Box size={12} />}
                                    Regen Sprites
                                  </button>
                                </div>
                              </div>
                              {confirmAction?.variantId === v.id && (
                                <div className="catalog-confirm-bar">
                                  <span className="catalog-confirm-msg">
                                    {confirmAction.type === 'bg'
                                      ? 'Re-run background removal? This will replace the current clean image.'
                                      : v.glb_path
                                        ? 'Regenerate sprites from existing 3D model? This will replace current sprite images.'
                                        : 'Regenerate 3D model + sprites? This runs TRELLIS (~1 min) then renders new sprites.'}
                                  </span>
                                  <button
                                    className="catalog-confirm-yes"
                                    onClick={() => confirmAction.type === 'bg' ? handleRegenerateBg(v.id) : handleRegenerateSprites(v)}
                                  >
                                    Confirm
                                  </button>
                                  <button className="catalog-confirm-no" onClick={() => setConfirmAction(null)}>Cancel</button>
                                </div>
                              )}
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
          flex-wrap: wrap;
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
        }
        .catalog-variant-render-status {
          font-size: 10px;
          font-weight: 500;
          text-transform: capitalize;
        }
        .catalog-variant-actions {
          display: flex;
          gap: 6px;
          margin-left: auto;
        }
        .catalog-regen-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid var(--color-border-custom);
          background: var(--color-card-bg);
          color: var(--color-text-secondary);
          font-size: 10px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .catalog-regen-btn:hover:not(:disabled) {
          background: var(--color-primary-brand);
          color: white;
          border-color: var(--color-primary-brand);
        }
        .catalog-regen-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .spinning {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .catalog-confirm-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: var(--color-warning-bg, #FFF8EC);
          border: 1px solid rgba(245, 166, 35, 0.25);
          border-radius: 6px;
          margin-bottom: 10px;
        }
        .catalog-confirm-msg {
          flex: 1;
          font-size: 11px;
          color: var(--color-warning-text, #8B6914);
        }
        .catalog-confirm-yes {
          padding: 4px 12px;
          border-radius: 6px;
          border: none;
          background: var(--color-primary-brand);
          color: white;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .catalog-confirm-yes:hover {
          background: var(--color-primary-hover, #238C85);
        }
        .catalog-confirm-no {
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid var(--color-border-custom);
          background: var(--color-card-bg);
          color: var(--color-text-secondary);
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .catalog-confirm-no:hover {
          background: var(--color-hover-bg);
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
