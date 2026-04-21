import { useTranslation } from 'react-i18next'
import { Lightbulb } from 'lucide-react'
import { useUIStore } from '@/stores/useUIStore'
import { LIGHTING_PRESETS, resolveLightingSettings } from '@/lib/roomScene'
import type { Room, LightingPreset, RoomLightingFinish } from '@/types'

type PresetOption = Exclude<LightingPreset, 'custom'> | 'off'
const PRESET_OPTIONS: readonly PresetOption[] = ['warm', 'neutral', 'cool', 'off']

interface Props {
  room: Room
  updateRoom: (id: string, updates: Record<string, unknown>) => Promise<void>
}

export default function LightingControls({ room, updateRoom }: Props) {
  const { t } = useTranslation()
  const studioOn = useUIStore((s) => s.studioLights)
  const setStudioLights = useUIStore((s) => s.setStudioLights)

  const lighting = resolveLightingSettings(room.finishes?.lighting)

  const write = (patch: Partial<RoomLightingFinish>) => {
    const next: RoomLightingFinish = { ...lighting, ...patch }
    updateRoom(room.id, { finishes: { ...room.finishes, lighting: next } })
  }

  const applyPreset = (p: PresetOption) => {
    if (p === 'off') {
      write({ enabled: false })
      return
    }
    const v = LIGHTING_PRESETS[p]
    write({ enabled: true, preset: p, temperature_k: v.temperature_k, intensity: v.intensity })
  }

  const tweakCustom = (patch: Partial<Pick<RoomLightingFinish, 'temperature_k' | 'intensity'>>) => {
    write({ ...patch, preset: 'custom', enabled: true })
  }

  const activePreset: PresetOption | 'custom' =
    !lighting.enabled ? 'off' : lighting.preset

  return (
    <>
      <div className="panel-divider" />
      <div className="panel-section">
        <span className="section-title">{t('editor.properties.lightingTitle')}</span>

        <button
          className={`shape-edit-btn ${studioOn ? 'active' : ''}`}
          onClick={() => setStudioLights(!studioOn)}
        >
          <Lightbulb size={12} />
          {t('editor.properties.studioLights')}
        </button>

        <div className="lighting-preset-row">
          {PRESET_OPTIONS.map((p) => (
            <button
              key={p}
              className={`curtain-style-btn ${activePreset === p ? 'active' : ''}`}
              onClick={() => applyPreset(p)}
            >
              {t(`editor.properties.lightingPreset.${p}`)}
            </button>
          ))}
        </div>

        <div className="lighting-slider">
          <div className="lighting-slider-label">
            <span>{t('editor.properties.temperature')}</span>
            <span className="lighting-slider-value">{lighting.temperature_k}K</span>
          </div>
          <input
            className="lighting-slider-range"
            type="range"
            min={2200}
            max={6500}
            step={100}
            value={lighting.temperature_k}
            disabled={!lighting.enabled}
            onChange={(e) => tweakCustom({ temperature_k: parseInt(e.target.value, 10) })}
          />
        </div>

        <div className="lighting-slider">
          <div className="lighting-slider-label">
            <span>{t('editor.properties.brightness')}</span>
            <span className="lighting-slider-value">{Math.round(lighting.intensity * 100)}%</span>
          </div>
          <input
            className="lighting-slider-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(lighting.intensity * 100)}
            disabled={!lighting.enabled}
            onChange={(e) => tweakCustom({ intensity: parseInt(e.target.value, 10) / 100 })}
          />
        </div>
      </div>
    </>
  )
}
