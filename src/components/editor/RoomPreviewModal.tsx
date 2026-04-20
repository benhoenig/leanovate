import { useEffect, useState, useRef, useCallback } from 'react'
import { X, Download, Save, Loader2, AlertTriangle, Zap, Sparkles, Square } from 'lucide-react'
import { renderRoomPreview, type RenderMode } from '@/lib/renderRoomPreview'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useUIStore } from '@/stores/useUIStore'
import { rawStorageUpload } from '@/lib/supabase'
import { getVertices } from '@/lib/roomGeometry'
import type { FurnitureItem } from '@/types'

type PreviewStatus = 'idle' | 'rendering' | 'building_scene' | 'path_tracing' | 'complete' | 'error'

export default function RoomPreviewModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [selectedWallIdx, setSelectedWallIdx] = useState(0)
  const [renderMode, setRenderMode] = useState<RenderMode>('fast')
  const [hdProgress, setHdProgress] = useState({ samples: 0, total: 200 })
  const [progressImageUrl, setProgressImageUrl] = useState<string | null>(null)

  const blobRef = useRef<Blob | null>(null)
  const imageUrlRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { rooms, selectedRoomId, finishMaterials, updateRoom } = useProjectStore()
  const { showToast } = useUIStore()
  const room = rooms.find((r) => r.id === selectedRoomId) ?? null
  const numWalls = room ? getVertices(room).length : 4

  const isRendering = status === 'rendering' || status === 'building_scene' || status === 'path_tracing'

  const renderPreview = useCallback(async (wallIdx: number, mode: RenderMode) => {
    if (!room) {
      setError('No room selected')
      setStatus('error')
      return
    }

    // Abort any in-progress render
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setStatus(mode === 'hd' ? 'building_scene' : 'rendering')
    setError(null)
    setProgressImageUrl(null)
    setHdProgress({ samples: 0, total: 200 })

    // Revoke old URL
    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = null
      setImageUrl(null)
    }

    const placedFurniture = useCanvasStore.getState().placedFurniture
    const catalog = useCatalogStore.getState()

    const variantsMap: Record<string, typeof catalog.variants[string]> = {}
    const itemsMap: Record<string, FurnitureItem> = {}

    for (const pf of placedFurniture) {
      if (!catalog.variants[pf.furniture_item_id]) {
        await catalog.loadVariantsForItem(pf.furniture_item_id)
      }
      variantsMap[pf.furniture_item_id] = useCatalogStore.getState().variants[pf.furniture_item_id] ?? []

      const item = useCatalogStore.getState().items.find((i) => i.id === pf.furniture_item_id)
      if (item) itemsMap[pf.furniture_item_id] = item
    }

    const result = await renderRoomPreview({
      room,
      finishMaterials,
      placedFurniture,
      variants: variantsMap,
      items: itemsMap,
      cameraWallIdx: wallIdx,
      mode,
      abortSignal: abortRef.current.signal,
      onProgress: (samples, total, url) => {
        setStatus('path_tracing')
        setHdProgress({ samples, total })
        setProgressImageUrl(url)
      },
    })

    if (result.error === 'Cancelled') return

    if (result.error || !result.blob) {
      setError(result.error ?? 'Render failed')
      setStatus('error')
      return
    }

    blobRef.current = result.blob
    setWarnings(result.warnings)
    const url = URL.createObjectURL(result.blob)
    imageUrlRef.current = url
    setImageUrl(url)
    setProgressImageUrl(null)
    setStatus('complete')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, finishMaterials])

  // Initial render
  useEffect(() => {
    renderPreview(0, 'fast')
    return () => {
      abortRef.current?.abort()
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleWallChange = (idx: number) => {
    if (idx === selectedWallIdx && !isRendering && status !== 'error') return
    setSelectedWallIdx(idx)
    renderPreview(idx, renderMode)
  }

  const handleModeChange = (mode: RenderMode) => {
    if (mode === renderMode && !isRendering) return
    setRenderMode(mode)
    renderPreview(selectedWallIdx, mode)
  }

  const handleStop = () => {
    abortRef.current?.abort()
    // Use the latest progress image as the final result
    if (progressImageUrl) {
      setImageUrl(progressImageUrl)
      setProgressImageUrl(null)
      setStatus('complete')
      // Convert data URL to blob for download/save
      fetch(progressImageUrl)
        .then((r) => r.blob())
        .then((b) => { blobRef.current = b })
    }
  }

  const handleDownload = () => {
    if (!imageUrl || !room) return
    const a = document.createElement('a')
    a.href = imageUrl
    const modeLabel = renderMode === 'hd' ? 'hd' : 'preview'
    a.download = `${room.name}_wall${selectedWallIdx + 1}_${modeLabel}.png`
    a.click()
  }

  const handleSave = async () => {
    if (!blobRef.current || !room) return
    setIsSaving(true)

    try {
      const path = `${room.id}/preview_${Date.now()}.png`
      const { publicUrl, error: uploadErr } = await rawStorageUpload('thumbnails', path, blobRef.current, {
        contentType: 'image/png',
        upsert: true,
      })

      if (uploadErr || !publicUrl) {
        showToast('Failed to save preview: ' + (uploadErr ?? 'unknown error'), 'error')
        setIsSaving(false)
        return
      }

      await updateRoom(room.id, { preview_image_url: publicUrl })
      showToast('Preview saved to project', 'success')
    } catch (err) {
      showToast('Save failed: ' + String(err), 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // The image to show: final image or progressive HD image
  const displayImage = imageUrl ?? progressImageUrl

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="preview-header">
          <span className="preview-title">Room Preview — {room?.name ?? 'Room'}</span>
          <button className="preview-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Wall selector + Mode toggle */}
        <div className="preview-wall-bar">
          <div className="preview-wall-buttons">
            {Array.from({ length: numWalls }, (_, i) => (
              <button
                key={i}
                className={`preview-wall-btn ${selectedWallIdx === i ? 'active' : ''}`}
                onClick={() => handleWallChange(i)}
                disabled={isRendering}
              >
                Wall {i + 1}
              </button>
            ))}
          </div>

          <div className="preview-mode-toggle">
            <button
              className={`preview-mode-btn ${renderMode === 'fast' ? 'active' : ''}`}
              onClick={() => handleModeChange('fast')}
              disabled={isRendering}
            >
              <Zap size={12} />
              Fast
            </button>
            <button
              className={`preview-mode-btn ${renderMode === 'hd' ? 'active' : ''}`}
              onClick={() => handleModeChange('hd')}
              disabled={isRendering}
            >
              <Sparkles size={12} />
              HD
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="preview-content">
          {/* Loading state for fast mode */}
          {status === 'rendering' && (
            <div className="preview-loading">
              <Loader2 size={32} className="preview-spinner" />
              <p>Rendering room preview…</p>
              <p className="preview-loading-hint">Loading 3D models and building the scene</p>
            </div>
          )}

          {/* Loading state for HD mode — BVH building */}
          {status === 'building_scene' && (
            <div className="preview-loading">
              <Loader2 size={32} className="preview-spinner" />
              <p>Preparing HD render…</p>
              <p className="preview-loading-hint">Building ray tracing acceleration structure</p>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="preview-error">
              <AlertTriangle size={32} />
              <p>Preview failed</p>
              <p className="preview-error-detail">{error}</p>
            </div>
          )}

          {/* HD progressive rendering — show refining image */}
          {status === 'path_tracing' && progressImageUrl && (
            <>
              {warnings.length > 0 && (
                <div className="preview-warnings">
                  <AlertTriangle size={14} />
                  <span>{warnings.length} item{warnings.length !== 1 ? 's' : ''} could not be rendered (missing 3D models)</span>
                </div>
              )}
              <img
                src={progressImageUrl}
                alt="HD render in progress"
                className="preview-image"
              />
              <div className="preview-hd-progress">
                <div className="hd-progress-bar">
                  <div
                    className="hd-progress-fill"
                    style={{ width: `${(hdProgress.samples / hdProgress.total) * 100}%` }}
                  />
                </div>
                <div className="hd-progress-text">
                  <span>HD Rendering: {hdProgress.samples} / {hdProgress.total} samples</span>
                  <button className="hd-stop-btn" onClick={handleStop}>
                    <Square size={10} />
                    Stop & Use Current
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Complete state */}
          {status === 'complete' && displayImage && (
            <>
              {warnings.length > 0 && (
                <div className="preview-warnings">
                  <AlertTriangle size={14} />
                  <span>{warnings.length} item{warnings.length !== 1 ? 's' : ''} could not be rendered (missing 3D models)</span>
                </div>
              )}
              <img
                src={displayImage}
                alt="Room perspective preview"
                className="preview-image"
              />
            </>
          )}
        </div>

        {/* Footer */}
        {status === 'complete' && (
          <div className="preview-footer">
            <button className="preview-download-btn" onClick={handleDownload}>
              <Download size={14} />
              Download PNG
            </button>
            <button
              className="preview-save-btn"
              onClick={handleSave}
              disabled={isSaving}
            >
              <Save size={14} />
              {isSaving ? 'Saving…' : 'Save to Project'}
            </button>
          </div>
        )}
      </div>

      <style>{`
        .preview-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(2px);
        }
        .preview-modal {
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
        .preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          border-bottom: 1px solid var(--color-border-custom);
        }
        .preview-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-text-primary);
        }
        .preview-close {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
        }
        .preview-close:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }
        .preview-wall-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--color-border-custom);
          background: var(--color-card-bg);
          flex-wrap: wrap;
        }
        .preview-wall-buttons {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .preview-wall-btn {
          padding: 5px 14px;
          border-radius: 6px;
          border: 1.5px solid var(--color-border-custom);
          background: none;
          color: var(--color-text-secondary);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .preview-wall-btn:hover:not(:disabled) {
          border-color: var(--color-primary-brand);
          color: var(--color-primary-brand);
        }
        .preview-wall-btn.active {
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          border-color: transparent;
          color: white;
        }
        .preview-wall-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .preview-mode-toggle {
          display: flex;
          gap: 4px;
          background: var(--color-hover-bg);
          padding: 3px;
          border-radius: 8px;
        }
        .preview-mode-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 12px;
          border-radius: 6px;
          border: none;
          background: none;
          color: var(--color-text-secondary);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .preview-mode-btn:hover:not(:disabled) {
          color: var(--color-text-primary);
        }
        .preview-mode-btn.active {
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          color: white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .preview-mode-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .preview-content {
          flex: 1;
          overflow: auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 300px;
        }
        .preview-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          color: var(--color-primary-brand);
          padding: 60px 20px;
        }
        .preview-loading p {
          font-size: 14px;
          font-weight: 600;
        }
        .preview-loading-hint {
          font-size: 12px !important;
          font-weight: 400 !important;
          color: var(--color-text-secondary) !important;
        }
        .preview-spinner {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .preview-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          color: var(--color-error);
          padding: 60px 20px;
        }
        .preview-error p {
          font-size: 14px;
          font-weight: 600;
        }
        .preview-error-detail {
          font-size: 12px !important;
          font-weight: 400 !important;
          max-width: 400px;
          text-align: center;
        }
        .preview-warnings {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          margin: 8px 16px 0;
          background: var(--color-warning-bg);
          border: 1px solid rgba(245, 166, 35, 0.25);
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
          color: var(--color-warning-text);
          align-self: stretch;
        }
        .preview-image {
          max-width: 100%;
          max-height: 70vh;
          object-fit: contain;
          padding: 8px;
        }
        .preview-hd-progress {
          width: 100%;
          padding: 0 16px 8px;
        }
        .hd-progress-bar {
          width: 100%;
          height: 4px;
          background: var(--color-border-custom);
          border-radius: 2px;
          overflow: hidden;
        }
        .hd-progress-fill {
          height: 100%;
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          border-radius: 2px;
          transition: width 0.3s ease;
        }
        .hd-progress-text {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 6px;
          font-size: 11px;
          color: var(--color-text-secondary);
        }
        .hd-stop-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 10px;
          border-radius: 6px;
          border: 1.5px solid var(--color-secondary, #F2735A);
          background: none;
          color: var(--color-secondary, #F2735A);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .hd-stop-btn:hover {
          background: var(--color-secondary, #F2735A);
          color: white;
        }
        .preview-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid var(--color-border-custom);
        }
        .preview-download-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 7px 14px;
          border-radius: 8px;
          border: 1.5px solid var(--color-border-custom);
          background: none;
          color: var(--color-text-secondary);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .preview-download-btn:hover {
          border-color: var(--color-primary-brand);
          color: var(--color-primary-brand);
        }
        .preview-save-btn {
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
        .preview-save-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .preview-save-btn:hover:not(:disabled) {
          filter: brightness(1.05);
        }
      `}</style>
    </div>
  )
}
