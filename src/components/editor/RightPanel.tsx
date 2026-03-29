import { useState, useEffect } from 'react'
import { useProjectStore } from '@/stores/useProjectStore'

export default function RightPanel() {
  const { rooms, selectedRoomId, updateRoom } = useProjectStore()
  const room = rooms.find((r) => r.id === selectedRoomId) ?? null

  const [name, setName] = useState('')
  const [widthCm, setWidthCm] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [ceilingCm, setCeilingCm] = useState('')

  useEffect(() => {
    if (room) {
      setName(room.name)
      setWidthCm(String(room.width_cm))
      setHeightCm(String(room.height_cm))
      setCeilingCm(String(room.ceiling_height_cm))
    }
  }, [room?.id, room?.name, room?.width_cm, room?.height_cm, room?.ceiling_height_cm])

  const commitName = () => {
    if (!room || !name.trim() || name.trim() === room.name) return
    updateRoom(room.id, { name: name.trim() })
  }

  const commitWidth = () => {
    if (!room) return
    const val = Math.min(2000, Math.max(50, parseInt(widthCm, 10)))
    if (!isNaN(val) && val !== room.width_cm) {
      updateRoom(room.id, { width_cm: val })
    } else {
      setWidthCm(String(room.width_cm))
    }
  }

  const commitHeight = () => {
    if (!room) return
    const val = Math.min(2000, Math.max(50, parseInt(heightCm, 10)))
    if (!isNaN(val) && val !== room.height_cm) {
      updateRoom(room.id, { height_cm: val })
    } else {
      setHeightCm(String(room.height_cm))
    }
  }

  const commitCeiling = () => {
    if (!room) return
    const val = Math.min(400, Math.max(220, parseInt(ceilingCm, 10)))
    if (!isNaN(val) && val !== room.ceiling_height_cm) {
      updateRoom(room.id, { ceiling_height_cm: val })
    } else {
      setCeilingCm(String(room.ceiling_height_cm))
    }
  }

  if (!room) {
    return (
      <div className="right-panel right-panel--empty">
        <p className="empty-hint">Select a room to edit</p>
        <style>{panelStyle}</style>
      </div>
    )
  }

  return (
    <div className="right-panel">
      <div className="panel-section">
        <span className="section-title">ROOM</span>
        <input
          className="panel-input panel-input--name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          placeholder="Room name"
        />
      </div>

      <div className="panel-divider" />

      <div className="panel-section">
        <span className="section-title">DIMENSIONS</span>
        <div className="dims-grid">
          <div className="dim-field">
            <label className="dim-label">Width (cm)</label>
            <input
              className="panel-input"
              type="number"
              min="50"
              max="2000"
              value={widthCm}
              onChange={(e) => setWidthCm(e.target.value)}
              onBlur={commitWidth}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
          </div>
          <div className="dim-field">
            <label className="dim-label">Depth (cm)</label>
            <input
              className="panel-input"
              type="number"
              min="50"
              max="2000"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              onBlur={commitHeight}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
          </div>
        </div>
        <div className="dim-field">
          <label className="dim-label">Ceiling Height (cm)</label>
          <input
            className="panel-input"
            type="number"
            min="220"
            max="400"
            value={ceilingCm}
            onChange={(e) => setCeilingCm(e.target.value)}
            onBlur={commitCeiling}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />
        </div>
      </div>

      <style>{panelStyle}</style>
    </div>
  )
}

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
`
