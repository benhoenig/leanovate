import { useCanvasStore } from '@/stores/useCanvasStore'
import { useUIStore } from '@/stores/useUIStore'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'

export default function ZoomControls() {
  const displayZoom = useCanvasStore((s) => s.displayZoom)
  const zoomIn = useCanvasStore((s) => s.zoomIn)
  const zoomOut = useCanvasStore((s) => s.zoomOut)
  const fitToRoom = useCanvasStore((s) => s.fitToRoom)
  const cameraMode = useUIStore((s) => s.cameraMode)

  if (cameraMode === 'roam') return null

  return (
    <div className="zoom-controls">
      <button className="zoom-btn" onClick={zoomOut} title="Zoom out (Ctrl+Scroll)">
        <ZoomOut size={14} />
      </button>
      <span className="zoom-label">{Math.round(displayZoom * 100)}%</span>
      <button className="zoom-btn" onClick={zoomIn} title="Zoom in (Ctrl+Scroll)">
        <ZoomIn size={14} />
      </button>
      <div className="zoom-divider" />
      <button className="zoom-btn" onClick={fitToRoom} title="Fit to room">
        <Maximize size={14} />
      </button>

      <style>{`
        .zoom-controls {
          position: absolute;
          bottom: 16px;
          right: 16px;
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 4px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(8px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          z-index: 10;
        }
        .zoom-btn {
          width: 32px;
          height: 32px;
          border-radius: 7px;
          border: none;
          background: transparent;
          color: var(--color-text-secondary);
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .zoom-btn:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }
        .zoom-label {
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          color: var(--color-text-secondary);
          min-width: 38px;
          text-align: center;
          user-select: none;
        }
        .zoom-divider {
          width: 1px;
          height: 18px;
          background: var(--color-border-custom);
          margin: 0 2px;
        }
      `}</style>
    </div>
  )
}
