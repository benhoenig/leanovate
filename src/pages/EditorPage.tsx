import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Boxes, ArrowLeft, Save } from 'lucide-react'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useUIStore } from '@/stores/useUIStore'
import { useTemplateStore } from '@/stores/useTemplateStore'
import LeftSidebar from '@/components/editor/LeftSidebar'
import RightPanel from '@/components/editor/RightPanel'
import IsometricCanvas from '@/components/editor/IsometricCanvas'
import RotationControls from '@/components/editor/RotationControls'

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const { currentProject, rooms, selectedRoomId, finishMaterials, isDirty, isLoading, loadProject, loadFinishMaterials, saveProject } = useProjectStore()
  const { showToast } = useUIStore()
  const placementMode = useCanvasStore((s) => s.placementMode)
  const fixturePlacementType = useCanvasStore((s) => s.fixturePlacementType)
  const isDragging = useCanvasStore((s) => s.isDragging)

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null

  // Load project + templates on mount
  useEffect(() => {
    if (!projectId) return
    loadProject(projectId)
    loadFinishMaterials()
    useTemplateStore.getState().loadAllTemplates()
  }, [projectId, loadProject, loadFinishMaterials])

  // Load placed furniture when room changes
  useEffect(() => {
    if (!selectedRoomId) return
    useCanvasStore.getState().loadPlacedFurniture(selectedRoomId).then(() => {
      // Preload sprites for all placed items' variants
      const placed = useCanvasStore.getState().placedFurniture
      const catalog = useCatalogStore.getState()
      for (const item of placed) {
        // Load variants if needed
        if (!catalog.variants[item.furniture_item_id]) {
          catalog.loadVariantsForItem(item.furniture_item_id)
        }
        // Load sprites if needed
        const sprites = catalog.getSpritesForVariant(item.selected_variant_id)
        if (sprites.length === 0) {
          catalog.loadSpritesForVariant(item.selected_variant_id)
        }
      }

      // Check for price staleness
      let staleCount = 0
      for (const pf of placed) {
        const variants = catalog.getVariantsForItem(pf.furniture_item_id)
        const variant = variants.find((v) => v.id === pf.selected_variant_id)
        if (pf.price_at_placement != null && variant?.price_thb != null && pf.price_at_placement !== variant.price_thb) {
          staleCount++
        }
      }
      if (staleCount > 0) {
        showToast(`${staleCount} item${staleCount !== 1 ? 's have' : ' has'} price changes — check Cost tab`, 'warning')
      }
    })
  }, [selectedRoomId])

  // Warn on browser tab close
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault() }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const handleSave = async () => {
    await saveProject()
    await useCanvasStore.getState().savePlacedFurniture()
    showToast('Project saved', 'success')
  }

  const handleBack = () => {
    if (isDirty) {
      if (!window.confirm('You have unsaved changes. Leave without saving?')) return
    }
    navigate('/')
  }

  // Canvas cursor based on mode
  const canvasCursor = (placementMode || fixturePlacementType) ? 'crosshair' : isDragging ? 'grabbing' : undefined

  return (
    <div className="editor-page">
      {/* Editor Top Bar */}
      <header className="editor-header">
        <div className="editor-header-left">
          <button className="editor-back-btn" onClick={handleBack} title="Back to dashboard">
            <ArrowLeft size={16} />
          </button>
          <div className="header-logo-icon-small">
            <Boxes size={14} strokeWidth={1.8} />
          </div>
          <span className="editor-project-name">
            {currentProject?.name ?? 'Loading…'}
          </span>
          {isDirty && <span className="unsaved-badge">Unsaved</span>}
        </div>
        <div className="editor-header-right">
          {placementMode && (
            <span className="placement-badge">Click on canvas to place — Esc to cancel</span>
          )}
          {fixturePlacementType && (
            <span className="placement-badge">Click on a wall to place {fixturePlacementType} — Esc to cancel</span>
          )}
          <button
            className="editor-save-btn"
            onClick={handleSave}
            disabled={isLoading || !isDirty}
          >
            <Save size={14} />
            {isLoading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {/* Editor Body */}
      <div className="editor-body">
        <aside className="editor-sidebar-left">
          <LeftSidebar />
        </aside>

        <main className="editor-canvas" style={canvasCursor ? { cursor: canvasCursor } : undefined}>
          {selectedRoom ? (
            <>
              <IsometricCanvas room={selectedRoom} finishMaterials={finishMaterials} />
              <RotationControls />
            </>
          ) : (
            <div className="canvas-empty">
              <p className="canvas-empty-text">Select a room to view the canvas</p>
            </div>
          )}
        </main>

        <aside className="editor-sidebar-right">
          <RightPanel />
        </aside>
      </div>

      <style>{`
        .editor-page {
          height: 100dvh;
          display: flex;
          flex-direction: column;
          background: var(--color-canvas-bg);
          overflow: hidden;
        }

        .editor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          height: 44px;
          background: var(--color-panel-bg);
          border-bottom: 1px solid var(--color-border-custom);
          box-shadow: var(--shadow-sm);
          flex-shrink: 0;
        }

        .editor-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .editor-back-btn {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
        }

        .editor-back-btn:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }

        .header-logo-icon-small {
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .editor-project-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .unsaved-badge {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          background: var(--color-warning-bg);
          color: var(--color-warning-text);
          padding: 2px 6px;
          border-radius: 4px;
        }

        .placement-badge {
          font-size: 11px;
          font-weight: 500;
          color: var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          padding: 4px 10px;
          border-radius: 6px;
        }

        .editor-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .editor-save-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 14px;
          border-radius: 7px;
          background: var(--color-primary-brand);
          color: white;
          font-size: 12px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }

        .editor-save-btn:hover:not(:disabled) {
          background: var(--color-primary-brand-hover);
        }

        .editor-save-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .editor-body {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        .editor-sidebar-left {
          width: 280px;
          background: var(--color-panel-bg);
          border-right: 1px solid var(--color-border-custom);
          flex-shrink: 0;
          overflow: hidden;
        }

        .editor-sidebar-right {
          width: 240px;
          background: var(--color-panel-bg);
          border-left: 1px solid var(--color-border-custom);
          flex-shrink: 0;
          overflow: hidden;
        }

        .editor-canvas {
          flex: 1;
          background: var(--color-canvas-bg);
          overflow: hidden;
          position: relative;
        }

        .canvas-empty {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .canvas-empty-text {
          font-size: 13px;
          color: var(--color-text-secondary);
          opacity: .6;
        }
      `}</style>
    </div>
  )
}
