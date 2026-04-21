import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { LIGHTING_PRESETS, resolveLightSettings } from '@/lib/roomScene'
import type { LightingPreset, PlacedLightSettings } from '@/types'

type PresetOption = Exclude<LightingPreset, 'custom'> | 'off'
const PRESET_OPTIONS: readonly PresetOption[] = ['warm', 'neutral', 'cool', 'off']

/**
 * Per-instance lighting controls for a placed fixture (ceiling downlight /
 * lamp). Writes to `placed_furniture.light_settings` via `updateLightSettings`.
 * Presets set temperature + intensity in one click; moving a slider flips
 * `preset` to 'custom'. "Off" sets `enabled=false`.
 */
export default function PlacedLightingSection({
  placedId,
  settings: raw,
}: {
  placedId: string
  settings: PlacedLightSettings | null
}) {
  const { t } = useTranslation()
  const updateLightSettings = useCanvasStore((s) => s.updateLightSettings)
  const settings = resolveLightSettings(raw)

  const applyPreset = (p: PresetOption) => {
    if (p === 'off') {
      updateLightSettings(placedId, { enabled: false })
      return
    }
    const v = LIGHTING_PRESETS[p]
    updateLightSettings(placedId, {
      enabled: true,
      preset: p,
      temperature_k: v.temperature_k,
      intensity: v.intensity,
    })
  }

  const tweakCustom = (patch: Partial<Pick<PlacedLightSettings, 'temperature_k' | 'intensity'>>) => {
    updateLightSettings(placedId, { ...patch, preset: 'custom', enabled: true })
  }

  const activePreset: PresetOption | 'custom' =
    !settings.enabled ? 'off' : settings.preset

  return (
    <>
      <div className="panel-section">
        <span className="section-title">{t('editor.properties.lightingTitle')}</span>

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
            <span className="lighting-slider-value">{settings.temperature_k}K</span>
          </div>
          <input
            className="lighting-slider-range"
            type="range"
            min={2200}
            max={6500}
            step={100}
            value={settings.temperature_k}
            disabled={!settings.enabled}
            onChange={(e) => tweakCustom({ temperature_k: parseInt(e.target.value, 10) })}
          />
        </div>

        <div className="lighting-slider">
          <div className="lighting-slider-label">
            <span>{t('editor.properties.brightness')}</span>
            <span className="lighting-slider-value">{Math.round(settings.intensity * 100)}%</span>
          </div>
          <input
            className="lighting-slider-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(settings.intensity * 100)}
            disabled={!settings.enabled}
            onChange={(e) => tweakCustom({ intensity: parseInt(e.target.value, 10) / 100 })}
          />
        </div>
      </div>
      <div className="panel-divider" />
    </>
  )
}
