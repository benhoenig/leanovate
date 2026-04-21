import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useUIStore } from '@/stores/useUIStore'
import CostPanel from '../CostPanel'
import FurnitureProperties from './FurnitureProperties'
import RoomProperties from './RoomProperties'
import { panelStyle } from './styles'

export default function RightPanel() {
  const { t } = useTranslation()
  const { rooms, selectedRoomId, updateRoom } = useProjectStore()
  const room = rooms.find((r) => r.id === selectedRoomId) ?? null

  const selectedItemId = useCanvasStore((s) => s.selectedItemId)
  const placedFurniture = useCanvasStore((s) => s.placedFurniture)
  const selectedPlaced = placedFurniture.find((p) => p.id === selectedItemId)

  const rightPanelTab = useUIStore((s) => s.rightPanelTab)
  const setRightPanelTab = useUIStore((s) => s.setRightPanelTab)

  const renderProperties = () => {
    if (selectedPlaced) return <FurnitureProperties placed={selectedPlaced} />
    if (room) return <RoomProperties room={room} updateRoom={updateRoom} t={t} />
    return <p className="empty-hint">{t('editor.properties.selectRoomHint')}</p>
  }

  return (
    <div className="right-panel">
      {/* Tab Switcher */}
      <div className="rp-tabs">
        <button
          className={`rp-tab ${rightPanelTab === 'properties' ? 'active' : ''}`}
          onClick={() => setRightPanelTab('properties')}
        >
          {t('editor.rightPanel.properties')}
        </button>
        <button
          className={`rp-tab ${rightPanelTab === 'cost' ? 'active' : ''}`}
          onClick={() => setRightPanelTab('cost')}
        >
          {t('editor.rightPanel.cost')}
        </button>
      </div>

      {/* Tab Content */}
      <div className="rp-content">
        {rightPanelTab === 'properties' ? renderProperties() : <CostPanel />}
      </div>

      <style>{panelStyle}</style>
    </div>
  )
}
