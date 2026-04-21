import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import type { RoomGeometry, RoomDoor, RoomWindow } from '@/types'
import FixtureStyleSwatches from './FixtureStyleSwatches'
import CurtainControls from './CurtainControls'

export default function FixtureProperties({ fixtureId, geo, ceilingM, updateRoom, roomId }: {
  fixtureId: string
  geo: RoomGeometry
  ceilingM: number
  updateRoom: (id: string, updates: Record<string, unknown>) => Promise<void>
  roomId: string
}) {
  const { t } = useTranslation()
  const door = (geo.doors ?? []).find(d => d.id === fixtureId) as RoomDoor | undefined
  const win = (geo.windows ?? []).find(w => w.id === fixtureId) as RoomWindow | undefined
  const fixture = door ?? win
  const isDoor = !!door

  const defaultH = isDoor
    ? Math.round(ceilingM * 0.82 * 10) / 10
    : Math.round(ceilingM * 0.48 * 10) / 10
  const defaultSill = Math.round(ceilingM * 0.30 * 10) / 10

  const [widthM, setWidthM] = useState(String(fixture?.width_m ?? ''))
  const [heightM, setHeightM] = useState(String(
    isDoor ? (door?.height_m ?? defaultH) : (win?.height_m ?? defaultH)
  ))
  const [sillM, setSillM] = useState(String(win?.sill_m ?? defaultSill))

  if (!fixture) return null

  const blurOnEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }

  const pushGeoCmd = (prevGeo: RoomGeometry, nextGeo: RoomGeometry) => {
    const rm = useProjectStore.getState().rooms.find(r => r.id === roomId)
    const w = rm?.width_cm ?? 0, h = rm?.height_cm ?? 0
    useCanvasStore.getState().pushGeometryCommand(roomId, prevGeo, JSON.parse(JSON.stringify(nextGeo)), w, h, w, h)
  }

  const commitWidth = () => {
    const val = parseFloat(widthM)
    if (isNaN(val)) { setWidthM(String(fixture.width_m)); return }
    const clamped = Math.max(0.3, Math.min(3, Math.round(val * 10) / 10))
    setWidthM(String(clamped))
    const prevGeo = JSON.parse(JSON.stringify(geo)) as RoomGeometry
    const updated = { ...fixture, width_m: clamped }
    const newGeo = isDoor
      ? { ...geo, doors: (geo.doors ?? []).map(d => d.id === fixtureId ? updated : d) }
      : { ...geo, windows: (geo.windows ?? []).map(w => w.id === fixtureId ? updated : w) }
    updateRoom(roomId, { geometry: newGeo })
    pushGeoCmd(prevGeo, newGeo)
  }

  const commitHeight = () => {
    const val = parseFloat(heightM)
    const fallback = isDoor ? (door?.height_m ?? defaultH) : (win?.height_m ?? defaultH)
    if (isNaN(val)) { setHeightM(String(fallback)); return }
    const clamped = Math.max(0.3, Math.min(ceilingM, Math.round(val * 10) / 10))
    setHeightM(String(clamped))
    const prevGeo = JSON.parse(JSON.stringify(geo)) as RoomGeometry
    const updated = { ...fixture, height_m: clamped }
    const newGeo = isDoor
      ? { ...geo, doors: (geo.doors ?? []).map(d => d.id === fixtureId ? updated : d) }
      : { ...geo, windows: (geo.windows ?? []).map(w => w.id === fixtureId ? updated : w) }
    updateRoom(roomId, { geometry: newGeo })
    pushGeoCmd(prevGeo, newGeo)
  }

  const commitSill = () => {
    const val = parseFloat(sillM)
    if (isNaN(val)) { setSillM(String(win?.sill_m ?? defaultSill)); return }
    const clamped = Math.max(0, Math.min(ceilingM - 0.3, Math.round(val * 10) / 10))
    setSillM(String(clamped))
    const prevGeo = JSON.parse(JSON.stringify(geo)) as RoomGeometry
    const updated = { ...fixture, sill_m: clamped }
    const newGeo = { ...geo, windows: (geo.windows ?? []).map(w => w.id === fixtureId ? updated : w) }
    updateRoom(roomId, { geometry: newGeo })
    pushGeoCmd(prevGeo, newGeo)
  }

  return (
    <>
      <div className="panel-divider" />
      <FixtureStyleSwatches
        fixture={fixture}
        isDoor={isDoor}
        roomId={roomId}
      />
      <div className="panel-divider" />
      <div className="panel-section">
        <span className="section-title">{isDoor ? t('editor.properties.doorSize') : t('editor.properties.windowSize')}</span>
        <div className="dims-grid">
          <div className="dim-field">
            <label className="dim-label">{t('editor.properties.widthM')}</label>
            <input className="panel-input" type="number" min="0.3" max="3" step="0.1"
              value={widthM} onChange={(e) => setWidthM(e.target.value)}
              onBlur={commitWidth} onKeyDown={blurOnEnter}
            />
          </div>
          <div className="dim-field">
            <label className="dim-label">{t('editor.properties.heightM')}</label>
            <input className="panel-input" type="number" min="0.3" max={ceilingM} step="0.1"
              value={heightM} onChange={(e) => setHeightM(e.target.value)}
              onBlur={commitHeight} onKeyDown={blurOnEnter}
            />
          </div>
        </div>
        {!isDoor && (
          <div className="dim-field">
            <label className="dim-label">{t('editor.properties.sillHeightM')}</label>
            <input className="panel-input" type="number" min="0" max={ceilingM - 0.3} step="0.1"
              value={sillM} onChange={(e) => setSillM(e.target.value)}
              onBlur={commitSill} onKeyDown={blurOnEnter}
            />
          </div>
        )}
      </div>

      {!isDoor && win && (
        <CurtainControls
          win={win}
          geo={geo}
          roomId={roomId}
          updateRoom={updateRoom}
        />
      )}
    </>
  )
}
