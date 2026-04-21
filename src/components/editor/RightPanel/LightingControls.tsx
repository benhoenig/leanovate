import { useTranslation } from 'react-i18next'
import { Lightbulb } from 'lucide-react'
import { useUIStore } from '@/stores/useUIStore'

/**
 * Studio lighting toggle (per-app, persisted to localStorage). The ceiling
 * lights + lamps are placed furniture — their per-instance settings live in
 * `FurnitureProperties` when a light-emitting item is selected.
 */
export default function LightingControls() {
  const { t } = useTranslation()
  const studioOn = useUIStore((s) => s.studioLights)
  const setStudioLights = useUIStore((s) => s.setStudioLights)

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
      </div>
    </>
  )
}
