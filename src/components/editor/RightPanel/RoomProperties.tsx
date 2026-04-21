import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { DoorOpen, PanelTop, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useCanvasStore } from '@/stores/useCanvasStore'
import type { Room, RoomGeometry } from '@/types'
import { migrateFixtureWallIndex } from '@/lib/roomGeometry'
import FixtureProperties from './FixtureProperties'
import LightingControls from './LightingControls'

export default function RoomProperties({ room, updateRoom, t }: {
  room: Room
  updateRoom: (id: string, updates: Record<string, unknown>) => Promise<void>
  t: TFunction
}) {
  const { setFixturePlacementMode, fixturePlacementType, selectedFixtureId, setSelectedFixture, shapeEditMode, setShapeEditMode } = useCanvasStore()
  const [name, setName] = useState('')
  const [ceilingCm, setCeilingCm] = useState('')

  const geo = room.geometry as RoomGeometry
  const hasCustomVertices = !!(geo.vertices && geo.vertices.length >= 3)
  const vertexCount = hasCustomVertices ? geo.vertices!.length : 4

  const handleDeleteFixture = (fixtureId: string) => {
    const prevGeo = JSON.parse(JSON.stringify(geo)) as RoomGeometry
    const doors = (geo.doors ?? []).filter(d => d.id !== fixtureId)
    const windows = (geo.windows ?? []).filter(w => w.id !== fixtureId)
    const nextGeo = { ...geo, doors, windows }
    updateRoom(room.id, { geometry: nextGeo })
    useCanvasStore.getState().pushGeometryCommand(room.id, prevGeo, JSON.parse(JSON.stringify(nextGeo)), room.width_cm, room.height_cm, room.width_cm, room.height_cm)
    if (selectedFixtureId === fixtureId) setSelectedFixture(null)
  }

  useEffect(() => {
    setName(room.name)
    setCeilingCm(String(room.ceiling_height_cm))
  }, [room.id, room.name, room.ceiling_height_cm])

  const commitName = () => {
    if (!name.trim() || name.trim() === room.name) return
    updateRoom(room.id, { name: name.trim() })
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
        <span className="section-title">{t('editor.properties.roomTitle')}</span>
        <input className="panel-input panel-input--name" value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={blurOnEnter} placeholder={t('editor.properties.roomNamePlaceholder')} />
      </div>
      <div className="panel-divider" />
      <div className="panel-section">
        <span className="section-title">{t('editor.properties.dimensionsTitle')}</span>
        <div className="dim-field">
          <label className="dim-label">{t('editor.properties.ceilingHeightLabel')}</label>
          <input className="panel-input" type="number" min="220" max="400" value={ceilingCm} onChange={(e) => setCeilingCm(e.target.value)} onBlur={commitCeiling} onKeyDown={blurOnEnter} />
        </div>

        <button
          className={`shape-edit-btn ${shapeEditMode ? 'active' : ''}`}
          onClick={() => setShapeEditMode(!shapeEditMode)}
        >
          <Pencil size={12} />
          {shapeEditMode ? t('editor.properties.doneEditing') : t('editor.properties.editShape')}
          {shapeEditMode && <span className="vertex-count">{t('editor.properties.verticesLabel', { count: vertexCount })}</span>}
        </button>

        {shapeEditMode && hasCustomVertices && (
          <button
            className="shape-reset-btn"
            onClick={() => {
              const prevGeo = JSON.parse(JSON.stringify(geo)) as RoomGeometry
              const newGeo = { ...geo }
              delete newGeo.vertices
              updateRoom(room.id, { geometry: newGeo })
              useCanvasStore.getState().pushGeometryCommand(room.id, prevGeo, JSON.parse(JSON.stringify(newGeo)), room.width_cm, room.height_cm, room.width_cm, room.height_cm)
              setShapeEditMode(false)
            }}
          >
            <RotateCcw size={12} /> {t('editor.properties.resetToRectangle')}
          </button>
        )}
      </div>

      <LightingControls />

      {((geo.doors?.length ?? 0) > 0 || (geo.windows?.length ?? 0) > 0 || fixturePlacementType) && (
        <>
          <div className="panel-divider" />
          <div className="panel-section">
            <span className="section-title">{t('editor.properties.fixtures')}</span>

            {(geo.doors ?? []).map((door, i) => (
              <div key={door.id} className={`fixture-row ${selectedFixtureId === door.id ? 'selected' : ''}`} onClick={() => setSelectedFixture(door.id)}>
                <DoorOpen size={13} />
                <span className="fixture-label">{t('editor.properties.door', { index: i + 1 })}</span>
                <span className="fixture-meta">{t('editor.properties.wallLabel', { index: migrateFixtureWallIndex(door) + 1 })}</span>
                <button className="fixture-delete" onClick={(e) => { e.stopPropagation(); handleDeleteFixture(door.id) }} title={t('editor.properties.removeDoor')}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}

            {(geo.windows ?? []).map((win, i) => (
              <div key={win.id} className={`fixture-row ${selectedFixtureId === win.id ? 'selected' : ''}`} onClick={() => setSelectedFixture(win.id)}>
                <PanelTop size={13} />
                <span className="fixture-label">{t('editor.properties.window', { index: i + 1 })}</span>
                <span className="fixture-meta">{t('editor.properties.wallLabel', { index: migrateFixtureWallIndex(win) + 1 })}</span>
                <button className="fixture-delete" onClick={(e) => { e.stopPropagation(); handleDeleteFixture(win.id) }} title={t('editor.properties.removeWindow')}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}

            {fixturePlacementType && (
              <button
                className="shape-reset-btn"
                onClick={() => setFixturePlacementMode(null)}
              >
                {t('editor.properties.cancelPlacement')}
              </button>
            )}
          </div>
        </>
      )}

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
