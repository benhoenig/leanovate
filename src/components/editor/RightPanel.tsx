import { useState, useEffect } from 'react'
import { RotateCw, Trash2, ExternalLink, DoorOpen, PanelTop, Plus } from 'lucide-react'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import type { RoomGeometry, RoomDoor, RoomWindow } from '@/types'

export default function RightPanel() {
  const { rooms, selectedRoomId, updateRoom } = useProjectStore()
  const room = rooms.find((r) => r.id === selectedRoomId) ?? null

  const selectedItemId = useCanvasStore((s) => s.selectedItemId)
  const placedFurniture = useCanvasStore((s) => s.placedFurniture)
  const selectedPlaced = placedFurniture.find((p) => p.id === selectedItemId)

  if (selectedPlaced) {
    return (
      <div className="right-panel">
        <FurnitureProperties placed={selectedPlaced} />
        <style>{panelStyle}</style>
      </div>
    )
  }

  if (room) {
    return (
      <div className="right-panel">
        <RoomProperties room={room} updateRoom={updateRoom} />
        <style>{panelStyle}</style>
      </div>
    )
  }

  return (
    <div className="right-panel right-panel--empty">
      <p className="empty-hint">Select a room to edit</p>
      <style>{panelStyle}</style>
    </div>
  )
}

// ── Furniture Properties ──────────────────────────────────────────────────────

function FurnitureProperties({ placed }: { placed: { id: string; furniture_item_id: string; selected_variant_id: string; direction: string; price_at_placement: number | null } }) {
  const { rotateItem, switchVariant, removeItem } = useCanvasStore()
  const catalogState = useCatalogStore()
  const item = catalogState.items.find((i) => i.id === placed.furniture_item_id)
  const variants = catalogState.getVariantsForItem(placed.furniture_item_id)
  const currentVariant = variants.find((v) => v.id === placed.selected_variant_id)
  const category = catalogState.categories.find((c) => c.id === item?.category_id)

  // Load variants if not loaded
  useEffect(() => {
    if (variants.length === 0) {
      catalogState.loadVariantsForItem(placed.furniture_item_id)
    }
  }, [placed.furniture_item_id])

  // Load sprites for all variants
  useEffect(() => {
    for (const v of variants) {
      const sprites = catalogState.getSpritesForVariant(v.id)
      if (sprites.length === 0 && v.render_status === 'completed') {
        catalogState.loadSpritesForVariant(v.id)
      }
    }
  }, [variants.length])

  const price = currentVariant?.price_thb ?? placed.price_at_placement
  const formattedPrice = price != null
    ? `฿${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : null

  const dimW = currentVariant?.width_cm ?? item?.width_cm
  const dimD = currentVariant?.depth_cm ?? item?.depth_cm
  const dimH = currentVariant?.height_cm ?? item?.height_cm
  const dims = [dimW, dimD, dimH].filter(Boolean).join(' × ')

  const sourceUrl = currentVariant?.source_url ?? item?.source_url

  return (
    <>
      <div className="panel-section">
        <span className="section-title">FURNITURE</span>
        <span className="fp-name">{item?.name ?? 'Unknown'}</span>
        {category && <span className="fp-category">{category.name}</span>}
      </div>

      <div className="panel-divider" />

      {/* Variant swatches */}
      {variants.length > 0 && (
        <div className="panel-section">
          <span className="section-title">COLOR</span>
          <div className="fp-swatch-grid">
            {variants.map((v) => (
              <button
                key={v.id}
                className={`fp-swatch ${v.id === placed.selected_variant_id ? 'selected' : ''}`}
                onClick={() => switchVariant(placed.id, v.id, v.price_thb)}
                title={v.color_name}
              >
                {v.original_image_url ? (
                  <img src={v.original_image_url} alt={v.color_name} className="fp-swatch-img" />
                ) : (
                  <span className="fp-swatch-text">{v.color_name.slice(0, 2)}</span>
                )}
              </button>
            ))}
          </div>
          {currentVariant && (
            <span className="fp-variant-name">{currentVariant.color_name}</span>
          )}
        </div>
      )}

      <div className="panel-divider" />

      {/* Details */}
      <div className="panel-section">
        <span className="section-title">DETAILS</span>
        {formattedPrice && <div className="fp-price">{formattedPrice}</div>}
        {dims && <div className="fp-dims">{dims} cm</div>}
        <div className="fp-direction">Facing: {placed.direction.replace('_', ' ')}</div>
        {sourceUrl && sourceUrl !== 'manual' && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="fp-link">
            <ExternalLink size={11} /> View product
          </a>
        )}
      </div>

      <div className="panel-divider" />

      {/* Actions */}
      <div className="panel-section">
        <button className="fp-action-btn" onClick={() => rotateItem(placed.id)}>
          <RotateCw size={13} /> Rotate
        </button>
        <button className="fp-action-btn fp-action-btn--danger" onClick={() => removeItem(placed.id)}>
          <Trash2 size={13} /> Remove
        </button>
      </div>
    </>
  )
}

// ── Room Properties (extracted from old RightPanel) ───────────────────────────

function RoomProperties({ room, updateRoom }: {
  room: { id: string; name: string; width_cm: number; height_cm: number; ceiling_height_cm: number; geometry: RoomGeometry }
  updateRoom: (id: string, updates: Record<string, unknown>) => Promise<void>
}) {
  const { setFixturePlacementMode, fixturePlacementType, selectedFixtureId, setSelectedFixture } = useCanvasStore()
  const [name, setName] = useState('')
  const [widthCm, setWidthCm] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [ceilingCm, setCeilingCm] = useState('')

  const geo = room.geometry as RoomGeometry

  const handleDeleteFixture = (fixtureId: string) => {
    const doors = (geo.doors ?? []).filter(d => d.id !== fixtureId)
    const windows = (geo.windows ?? []).filter(w => w.id !== fixtureId)
    updateRoom(room.id, { geometry: { ...geo, doors, windows } })
    if (selectedFixtureId === fixtureId) setSelectedFixture(null)
  }

  useEffect(() => {
    setName(room.name)
    setWidthCm(String(room.width_cm))
    setHeightCm(String(room.height_cm))
    setCeilingCm(String(room.ceiling_height_cm))
  }, [room.id, room.name, room.width_cm, room.height_cm, room.ceiling_height_cm])

  const commitName = () => {
    if (!name.trim() || name.trim() === room.name) return
    updateRoom(room.id, { name: name.trim() })
  }
  const commitWidth = () => {
    const val = Math.min(2000, Math.max(50, parseInt(widthCm, 10)))
    if (!isNaN(val) && val !== room.width_cm) updateRoom(room.id, { width_cm: val })
    else setWidthCm(String(room.width_cm))
  }
  const commitHeight = () => {
    const val = Math.min(2000, Math.max(50, parseInt(heightCm, 10)))
    if (!isNaN(val) && val !== room.height_cm) updateRoom(room.id, { height_cm: val })
    else setHeightCm(String(room.height_cm))
  }
  const commitCeiling = () => {
    const val = Math.min(400, Math.max(220, parseInt(ceilingCm, 10)))
    if (!isNaN(val) && val !== room.ceiling_height_cm) updateRoom(room.id, { ceiling_height_cm: val })
    else setCeilingCm(String(room.ceiling_height_cm))
  }
  const blurOnEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }

  return (
    <>
      <div className="panel-section">
        <span className="section-title">ROOM</span>
        <input className="panel-input panel-input--name" value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={blurOnEnter} placeholder="Room name" />
      </div>
      <div className="panel-divider" />
      <div className="panel-section">
        <span className="section-title">DIMENSIONS</span>
        <div className="dims-grid">
          <div className="dim-field">
            <label className="dim-label">Width (cm)</label>
            <input className="panel-input" type="number" min="50" max="2000" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} onBlur={commitWidth} onKeyDown={blurOnEnter} />
          </div>
          <div className="dim-field">
            <label className="dim-label">Depth (cm)</label>
            <input className="panel-input" type="number" min="50" max="2000" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} onBlur={commitHeight} onKeyDown={blurOnEnter} />
          </div>
        </div>
        <div className="dim-field">
          <label className="dim-label">Ceiling Height (cm)</label>
          <input className="panel-input" type="number" min="220" max="400" value={ceilingCm} onChange={(e) => setCeilingCm(e.target.value)} onBlur={commitCeiling} onKeyDown={blurOnEnter} />
        </div>
      </div>

      <div className="panel-divider" />

      {/* Fixtures */}
      <div className="panel-section">
        <span className="section-title">FIXTURES</span>

        {(geo.doors ?? []).map((door, i) => (
          <div key={door.id} className={`fixture-row ${selectedFixtureId === door.id ? 'selected' : ''}`} onClick={() => setSelectedFixture(door.id)}>
            <DoorOpen size={13} />
            <span className="fixture-label">Door {i + 1}</span>
            <span className="fixture-meta">{door.wall} wall</span>
            <button className="fixture-delete" onClick={(e) => { e.stopPropagation(); handleDeleteFixture(door.id) }} title="Remove door">
              <Trash2 size={11} />
            </button>
          </div>
        ))}

        {(geo.windows ?? []).map((win, i) => (
          <div key={win.id} className={`fixture-row ${selectedFixtureId === win.id ? 'selected' : ''}`} onClick={() => setSelectedFixture(win.id)}>
            <PanelTop size={13} />
            <span className="fixture-label">Window {i + 1}</span>
            <span className="fixture-meta">{win.wall} wall</span>
            <button className="fixture-delete" onClick={(e) => { e.stopPropagation(); handleDeleteFixture(win.id) }} title="Remove window">
              <Trash2 size={11} />
            </button>
          </div>
        ))}

        <div className="fixture-add-row">
          <button
            className={`fixture-add-btn ${fixturePlacementType === 'door' ? 'active' : ''}`}
            onClick={() => setFixturePlacementMode(fixturePlacementType === 'door' ? null : 'door')}
          >
            <Plus size={12} /> Door
          </button>
          <button
            className={`fixture-add-btn ${fixturePlacementType === 'window' ? 'active' : ''}`}
            onClick={() => setFixturePlacementMode(fixturePlacementType === 'window' ? null : 'window')}
          >
            <Plus size={12} /> Window
          </button>
        </div>
      </div>

      {selectedFixtureId && (
        <FixtureProperties
          key={selectedFixtureId}
          fixtureId={selectedFixtureId}
          geo={geo}
          ceilingM={room.ceiling_height_cm / 100}
          updateRoom={updateRoom}
          roomId={room.id}
        />
      )}
    </>
  )
}

// ── Fixture Properties ──────────────────────────────────────────────────────────

function FixtureProperties({ fixtureId, geo, ceilingM, updateRoom, roomId }: {
  fixtureId: string
  geo: RoomGeometry
  ceilingM: number
  updateRoom: (id: string, updates: Record<string, unknown>) => Promise<void>
  roomId: string
}) {
  const door = (geo.doors ?? []).find(d => d.id === fixtureId) as RoomDoor | undefined
  const win = (geo.windows ?? []).find(w => w.id === fixtureId) as RoomWindow | undefined
  const fixture = door ?? win
  if (!fixture) return null
  const isDoor = !!door

  const defaultH = isDoor
    ? Math.round(ceilingM * 0.82 * 10) / 10
    : Math.round(ceilingM * 0.48 * 10) / 10
  const defaultSill = Math.round(ceilingM * 0.30 * 10) / 10

  const [widthM, setWidthM] = useState(String(fixture.width_m))
  const [heightM, setHeightM] = useState(String(
    isDoor ? (door!.height_m ?? defaultH) : (win!.height_m ?? defaultH)
  ))
  const [sillM, setSillM] = useState(String(win?.sill_m ?? defaultSill))

  const blurOnEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }

  const commitWidth = () => {
    const val = parseFloat(widthM)
    if (isNaN(val)) { setWidthM(String(fixture.width_m)); return }
    const clamped = Math.max(0.3, Math.min(3, Math.round(val * 10) / 10))
    setWidthM(String(clamped))
    const updated = { ...fixture, width_m: clamped }
    const newGeo = isDoor
      ? { ...geo, doors: (geo.doors ?? []).map(d => d.id === fixtureId ? updated : d) }
      : { ...geo, windows: (geo.windows ?? []).map(w => w.id === fixtureId ? updated : w) }
    updateRoom(roomId, { geometry: newGeo })
  }

  const commitHeight = () => {
    const val = parseFloat(heightM)
    const fallback = isDoor ? (door!.height_m ?? defaultH) : (win!.height_m ?? defaultH)
    if (isNaN(val)) { setHeightM(String(fallback)); return }
    const clamped = Math.max(0.3, Math.min(ceilingM, Math.round(val * 10) / 10))
    setHeightM(String(clamped))
    const updated = { ...fixture, height_m: clamped }
    const newGeo = isDoor
      ? { ...geo, doors: (geo.doors ?? []).map(d => d.id === fixtureId ? updated : d) }
      : { ...geo, windows: (geo.windows ?? []).map(w => w.id === fixtureId ? updated : w) }
    updateRoom(roomId, { geometry: newGeo })
  }

  const commitSill = () => {
    const val = parseFloat(sillM)
    if (isNaN(val)) { setSillM(String(win?.sill_m ?? defaultSill)); return }
    const clamped = Math.max(0, Math.min(ceilingM - 0.3, Math.round(val * 10) / 10))
    setSillM(String(clamped))
    const updated = { ...fixture, sill_m: clamped }
    const newGeo = { ...geo, windows: (geo.windows ?? []).map(w => w.id === fixtureId ? updated : w) }
    updateRoom(roomId, { geometry: newGeo })
  }

  return (
    <>
      <div className="panel-divider" />
      <div className="panel-section">
        <span className="section-title">{isDoor ? 'DOOR' : 'WINDOW'} SIZE</span>
        <div className="dims-grid">
          <div className="dim-field">
            <label className="dim-label">Width (m)</label>
            <input className="panel-input" type="number" min="0.3" max="3" step="0.1"
              value={widthM} onChange={(e) => setWidthM(e.target.value)}
              onBlur={commitWidth} onKeyDown={blurOnEnter}
            />
          </div>
          <div className="dim-field">
            <label className="dim-label">Height (m)</label>
            <input className="panel-input" type="number" min="0.3" max={ceilingM} step="0.1"
              value={heightM} onChange={(e) => setHeightM(e.target.value)}
              onBlur={commitHeight} onKeyDown={blurOnEnter}
            />
          </div>
        </div>
        {!isDoor && (
          <div className="dim-field">
            <label className="dim-label">Sill Height (m)</label>
            <input className="panel-input" type="number" min="0" max={ceilingM - 0.3} step="0.1"
              value={sillM} onChange={(e) => setSillM(e.target.value)}
              onBlur={commitSill} onKeyDown={blurOnEnter}
            />
          </div>
        )}
      </div>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const panelStyle = `
  .right-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    padding: 14px;
    gap: 0;
  }
  .right-panel--empty {
    align-items: center;
    justify-content: center;
  }
  .empty-hint {
    font-size: 12px;
    color: var(--color-text-secondary);
    opacity: 0.6;
  }
  .panel-section {
    padding: 12px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--color-text-secondary);
  }
  .panel-divider {
    height: 1px;
    background: var(--color-border-custom);
  }
  .panel-input {
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--color-border-custom);
    border-radius: 7px;
    background: var(--color-input-bg);
    font-size: 12px;
    font-family: inherit;
    color: var(--color-text-primary);
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .panel-input:focus {
    border-color: var(--color-primary-brand);
  }
  .panel-input--name {
    font-weight: 600;
    font-size: 13px;
  }
  .dims-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .dim-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dim-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  /* Furniture properties */
  .fp-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .fp-category {
    font-size: 10px;
    font-weight: 500;
    color: var(--color-text-secondary);
    background: var(--color-hover-bg);
    padding: 2px 8px;
    border-radius: 4px;
    align-self: flex-start;
  }
  .fp-swatch-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .fp-swatch {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 2px solid var(--color-border-custom);
    cursor: pointer;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-hover-bg);
    padding: 0;
    transition: all 0.15s;
  }
  .fp-swatch:hover {
    transform: scale(1.08);
  }
  .fp-swatch.selected {
    border-color: var(--color-primary-brand);
    box-shadow: 0 0 0 1.5px var(--color-primary-brand);
  }
  .fp-swatch-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .fp-swatch-text {
    font-size: 9px;
    font-weight: 700;
    color: var(--color-text-secondary);
    text-transform: uppercase;
  }
  .fp-variant-name {
    font-size: 10px;
    color: var(--color-text-secondary);
  }
  .fp-price {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-primary-brand);
  }
  .fp-dims {
    font-size: 11px;
    color: var(--color-text-secondary);
  }
  .fp-direction {
    font-size: 11px;
    color: var(--color-text-secondary);
    text-transform: capitalize;
  }
  .fp-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-primary-brand);
    text-decoration: none;
  }
  .fp-link:hover {
    text-decoration: underline;
  }
  .fp-action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--color-border-custom);
    background: var(--color-card-bg);
    color: var(--color-text-primary);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .fp-action-btn:hover {
    background: var(--color-hover-bg);
  }
  .fp-action-btn--danger {
    color: var(--color-error);
    border-color: rgba(229, 77, 66, 0.3);
  }
  .fp-action-btn--danger:hover {
    background: rgba(229, 77, 66, 0.08);
  }

  /* Fixture controls */
  .fixture-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 7px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.15s;
    color: var(--color-text-secondary);
  }
  .fixture-row:hover {
    background: var(--color-hover-bg);
  }
  .fixture-row.selected {
    background: var(--color-primary-brand-light);
    border-color: var(--color-primary-brand);
    color: var(--color-text-primary);
  }
  .fixture-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .fixture-meta {
    font-size: 10px;
    color: var(--color-text-secondary);
    margin-left: auto;
    text-transform: capitalize;
  }
  .fixture-delete {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 3px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: all 0.15s;
  }
  .fixture-row:hover .fixture-delete {
    opacity: 1;
  }
  .fixture-delete:hover {
    color: var(--color-error);
    background: rgba(229, 77, 66, 0.08);
  }
  .fixture-add-row {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .fixture-add-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px;
    border-radius: 7px;
    border: 1.5px dashed var(--color-border-custom);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .fixture-add-btn:hover {
    border-color: var(--color-primary-brand);
    color: var(--color-primary-brand);
    background: var(--color-primary-brand-light);
  }
  .fixture-add-btn.active {
    border-color: var(--color-primary-brand);
    border-style: solid;
    color: white;
    background: var(--color-primary-brand);
  }
`
