import { useEffect, useState, useRef } from 'react'
import { X, Download, Save, Loader2, AlertTriangle } from 'lucide-react'
import { renderRoomPreview } from '@/lib/renderRoomPreview'
import { useProjectStore } from '@/stores/useProjectStore'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useUIStore } from '@/stores/useUIStore'
import { supabase } from '@/lib/supabase'
import type { FurnitureItem } from '@/types'

export default function RoomPreviewModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<'rendering' | 'complete' | 'error'>('rendering')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const blobRef = useRef<Blob | null>(null)

  const { rooms, selectedRoomId, finishMaterials, updateRoom } = useProjectStore()
  const { showToast } = useUIStore()
  const room = rooms.find((r) => r.id === selectedRoomId) ?? null

  useEffect(() => {
    if (!room) {
      setError('No room selected')
      setStatus('error')
      return
    }

    const run = async () => {
      const placedFurniture = useCanvasStore.getState().placedFurniture
      const catalog = useCatalogStore.getState()

      // Build lookup maps for the renderer
      const variantsMap: Record<string, typeof catalog.variants[string]> = {}
      const itemsMap: Record<string, FurnitureItem> = {}

      for (const pf of placedFurniture) {
        // Ensure variants are loaded
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
      })

      if (result.error || !result.blob) {
        setError(result.error ?? 'Render failed')
        setStatus('error')
        return
      }

      blobRef.current = result.blob
      setWarnings(result.warnings)
      const url = URL.createObjectURL(result.blob)
      setImageUrl(url)
      setStatus('complete')
    }

    run()

    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDownload = () => {
    if (!imageUrl || !room) return
    const a = document.createElement('a')
    a.href = imageUrl
    a.download = `${room.name}_preview.png`
    a.click()
  }

  const handleSave = async () => {
    if (!blobRef.current || !room) return
    setIsSaving(true)

    try {
      const path = `${room.id}/preview_${Date.now()}.png`
      const { error: uploadErr } = await supabase.storage
        .from('thumbnails')
        .upload(path, blobRef.current, {
          contentType: 'image/png',
          upsert: true,
        })

      if (uploadErr) {
        showToast('Failed to save preview: ' + uploadErr.message, 'error')
        setIsSaving(false)
        return
      }

      const { data } = supabase.storage.from('thumbnails').getPublicUrl(path)
      await updateRoom(room.id, { preview_image_url: data.publicUrl })
      showToast('Preview saved to project', 'success')
    } catch (err) {
      showToast('Save failed: ' + String(err), 'error')
    } finally {
      setIsSaving(false)
    }
  }

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

        {/* Content */}
        <div className="preview-content">
          {status === 'rendering' && (
            <div className="preview-loading">
              <Loader2 size={32} className="preview-spinner" />
              <p>Rendering room preview…</p>
              <p className="preview-loading-hint">Loading 3D models and building the scene</p>
            </div>
          )}

          {status === 'error' && (
            <div className="preview-error">
              <AlertTriangle size={32} />
              <p>Preview failed</p>
              <p className="preview-error-detail">{error}</p>
            </div>
          )}

          {status === 'complete' && imageUrl && (
            <>
              {warnings.length > 0 && (
                <div className="preview-warnings">
                  <AlertTriangle size={14} />
                  <span>{warnings.length} item{warnings.length !== 1 ? 's' : ''} could not be rendered (missing 3D models)</span>
                </div>
              )}
              <img
                src={imageUrl}
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
