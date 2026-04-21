import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import type { RoomGeometry, RoomWindow, CurtainStyle } from '@/types'

const CURTAIN_PRESETS = [
  { name: 'Linen', hex: '#F5F0E8' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Cream', hex: '#F5F0D0' },
  { name: 'Beige', hex: '#D4C5A9' },
  { name: 'Soft Blue', hex: '#B8CCD8' },
  { name: 'Sage', hex: '#B5C4B1' },
  { name: 'Walnut', hex: '#6B4E3D' },
  { name: 'Charcoal', hex: '#4A4A4A' },
]

export default function CurtainControls({ win, geo, roomId, updateRoom }: {
  win: RoomWindow
  geo: RoomGeometry
  roomId: string
  updateRoom: (id: string, updates: Record<string, unknown>) => Promise<void>
}) {
  const { t } = useTranslation()
  const style = (win.curtain_style ?? 'none') as CurtainStyle
  const color = win.curtain_color ?? '#F5F0E8'
  const [hexInput, setHexInput] = useState(color)

  useEffect(() => { setHexInput(color) }, [color])

  const updateWindow = (updates: Partial<RoomWindow>) => {
    const prevGeo = JSON.parse(JSON.stringify(geo)) as RoomGeometry
    const newGeo = {
      ...geo,
      windows: (geo.windows ?? []).map(w => w.id === win.id ? { ...w, ...updates } : w),
    }
    updateRoom(roomId, { geometry: newGeo })
    const rm = useProjectStore.getState().rooms.find(r => r.id === roomId)
    const ww = rm?.width_cm ?? 0, hh = rm?.height_cm ?? 0
    useCanvasStore.getState().pushGeometryCommand(roomId, prevGeo, JSON.parse(JSON.stringify(newGeo)), ww, hh, ww, hh)
  }

  const commitHex = () => {
    const val = hexInput.trim()
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      updateWindow({ curtain_color: val })
    } else {
      setHexInput(color)
    }
  }

  const blurOnEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }

  return (
    <>
      <div className="panel-divider" />
      <div className="panel-section">
        <span className="section-title">{t('editor.properties.curtain')}</span>
        <div className="curtain-style-row">
          {(['none', 'open', 'closed'] as CurtainStyle[]).map((s) => {
            const label = s === 'none' ? t('editor.properties.curtainStyleNone')
              : s === 'open' ? t('editor.properties.curtainStyleOpen')
              : t('editor.properties.curtainStyleClosed')
            return (
              <button
                key={s}
                className={`curtain-style-btn ${style === s ? 'active' : ''}`}
                onClick={() => updateWindow({ curtain_style: s })}
              >
                {label}
              </button>
            )
          })}
        </div>

        {style !== 'none' && (
          <>
            <div className="curtain-color-row">
              <label className="dim-label">{t('editor.properties.curtainColor')}</label>
              <div className="curtain-color-input">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => {
                    setHexInput(e.target.value)
                    updateWindow({ curtain_color: e.target.value })
                  }}
                  className="curtain-picker"
                />
                <input
                  className="panel-input curtain-hex"
                  value={hexInput}
                  onChange={(e) => setHexInput(e.target.value)}
                  onBlur={commitHex}
                  onKeyDown={blurOnEnter}
                  maxLength={7}
                />
              </div>
            </div>

            <div className="curtain-presets">
              {CURTAIN_PRESETS.map((p) => (
                <button
                  key={p.hex}
                  className={`curtain-swatch ${color === p.hex ? 'selected' : ''}`}
                  style={{ background: p.hex }}
                  onClick={() => {
                    setHexInput(p.hex)
                    updateWindow({ curtain_color: p.hex })
                  }}
                  title={p.name}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
