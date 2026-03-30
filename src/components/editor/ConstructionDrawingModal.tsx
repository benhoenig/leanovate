import { useEffect, useState, useRef } from 'react'
import { X, Download, Loader2, AlertTriangle } from 'lucide-react'
import { renderFloorPlan, renderElevation, exportConstructionPDF } from '@/lib/renderConstructionDrawings'
import { useProjectStore } from '@/stores/useProjectStore'
import { getVertices } from '@/lib/roomGeometry'

export default function ConstructionDrawingModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<'rendering' | 'complete' | 'error'>('rendering')
  const [error, setError] = useState<string | null>(null)
  const [floorPlanUrl, setFloorPlanUrl] = useState<string | null>(null)
  const [elevationUrls, setElevationUrls] = useState<string[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const urlsRef = useRef<string[]>([])

  const { rooms, selectedRoomId, currentProject } = useProjectStore()
  const room = rooms.find((r) => r.id === selectedRoomId) ?? null
  const projectName = currentProject?.name ?? 'Project'

  useEffect(() => {
    if (!room) {
      setError('No room selected')
      setStatus('error')
      return
    }

    try {
      const vertices = getVertices(room)
      const numWalls = vertices.length

      // Auto scale
      const us = vertices.map(v => v.u)
      const vs = vertices.map(v => v.v)
      const maxDim = Math.max(
        Math.max(...us) - Math.min(...us),
        Math.max(...vs) - Math.min(...vs),
      )
      let scale = 50
      if (maxDim < 3) scale = 25
      else if (maxDim > 8) scale = 100

      // Render floor plan
      const fpCanvas = renderFloorPlan(room, projectName, scale)
      const fpUrl = fpCanvas.toDataURL('image/png')
      setFloorPlanUrl(fpUrl)
      urlsRef.current = [fpUrl]

      // Render elevations
      const elUrls: string[] = []
      for (let i = 0; i < numWalls; i++) {
        const elCanvas = renderElevation(room, i, projectName, scale)
        const url = elCanvas.toDataURL('image/png')
        elUrls.push(url)
      }
      setElevationUrls(elUrls)
      urlsRef.current = [fpUrl, ...elUrls]

      setStatus('complete')
    } catch (err) {
      setError('Failed to render drawings: ' + String(err))
      setStatus('error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDownloadPDF = async () => {
    if (!room) return
    setIsExporting(true)
    try {
      const blob = await exportConstructionPDF(room, projectName)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${room.name}_construction_drawings.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export error:', err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="cd-overlay" onClick={onClose}>
      <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cd-header">
          <span className="cd-title">Construction Drawings — {room?.name ?? 'Room'}</span>
          <button className="cd-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="cd-content">
          {status === 'rendering' && (
            <div className="cd-loading">
              <Loader2 size={32} className="cd-spinner" />
              <p>Generating drawings…</p>
            </div>
          )}

          {status === 'error' && (
            <div className="cd-error">
              <AlertTriangle size={32} />
              <p>Drawing generation failed</p>
              <p className="cd-error-detail">{error}</p>
            </div>
          )}

          {status === 'complete' && (
            <div className="cd-drawings">
              {/* Floor plan (large) */}
              {floorPlanUrl && (
                <div className="cd-drawing-section">
                  <h3 className="cd-section-label">Floor Plan</h3>
                  <img src={floorPlanUrl} alt="Floor Plan" className="cd-floor-plan" />
                </div>
              )}

              {/* Elevations */}
              {elevationUrls.length > 0 && (
                <div className="cd-drawing-section">
                  <h3 className="cd-section-label">Wall Elevations</h3>
                  <div className="cd-elevation-grid">
                    {elevationUrls.map((url, i) => (
                      <div key={i} className="cd-elevation-item">
                        <span className="cd-elevation-label">Wall {i + 1}</span>
                        <img src={url} alt={`Wall ${i + 1} Elevation`} className="cd-elevation-img" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {status === 'complete' && (
          <div className="cd-footer">
            <button
              className="cd-download-btn"
              onClick={handleDownloadPDF}
              disabled={isExporting}
            >
              {isExporting ? <Loader2 size={14} className="cd-spinner" /> : <Download size={14} />}
              {isExporting ? 'Exporting…' : 'Download PDF'}
            </button>
          </div>
        )}
      </div>

      <style>{`
        .cd-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(2px);
        }
        .cd-modal {
          background: var(--color-panel-bg);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.25);
          max-width: 1200px;
          max-height: 90vh;
          width: 90%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .cd-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          border-bottom: 1px solid var(--color-border-custom);
        }
        .cd-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-text-primary);
        }
        .cd-close {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
        }
        .cd-close:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }
        .cd-content {
          flex: 1;
          overflow: auto;
          display: flex;
          flex-direction: column;
          min-height: 300px;
        }
        .cd-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          color: var(--color-primary-brand);
          padding: 60px 20px;
          flex: 1;
          justify-content: center;
        }
        .cd-loading p {
          font-size: 14px;
          font-weight: 600;
        }
        .cd-spinner {
          animation: cdspin 1s linear infinite;
        }
        @keyframes cdspin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .cd-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          color: var(--color-error);
          padding: 60px 20px;
          flex: 1;
          justify-content: center;
        }
        .cd-error p {
          font-size: 14px;
          font-weight: 600;
        }
        .cd-error-detail {
          font-size: 12px !important;
          font-weight: 400 !important;
          max-width: 400px;
          text-align: center;
        }
        .cd-drawings {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .cd-drawing-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cd-section-label {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-text-primary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .cd-floor-plan {
          width: 100%;
          max-height: 50vh;
          object-fit: contain;
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
          background: white;
        }
        .cd-elevation-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 10px;
        }
        .cd-elevation-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cd-elevation-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-secondary);
        }
        .cd-elevation-img {
          width: 100%;
          border: 1px solid var(--color-border-custom);
          border-radius: 6px;
          background: white;
          object-fit: contain;
        }
        .cd-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid var(--color-border-custom);
        }
        .cd-download-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 7px 14px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          color: white;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .cd-download-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .cd-download-btn:hover:not(:disabled) {
          filter: brightness(1.05);
        }
      `}</style>
    </div>
  )
}
