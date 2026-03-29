import { useState, useRef } from 'react'
import { X, Check, XCircle, Upload, Loader2 } from 'lucide-react'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useUIStore } from '@/stores/useUIStore'
import type { FurnitureItem, FurnitureVariant } from '@/types'

interface Props {
  item: FurnitureItem
  variant: FurnitureVariant
  onClose: () => void
  /** Called after approve/reject — caller can advance to next pending variant */
  onNext?: () => void
}

export default function ImageApprovalModal({ item, variant, onClose, onNext }: Props) {
  const { approveImage, rejectImage, uploadVariantImage, updateVariant, triggerBackgroundRemoval, loadVariantsForItem } = useCatalogStore()
  const { showToast } = useUIStore()

  const [isProcessing, setIsProcessing] = useState(false)
  const [isReuploading, setIsReuploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ─── Approve ──────────────────────────────────────────────────────────────

  const handleApprove = async () => {
    setIsProcessing(true)
    try {
      const { error } = await approveImage(variant.id)
      if (error) {
        showToast(error, 'error')
        return
      }
      showToast('Image approved — generating 3D model…', 'success')
      await loadVariantsForItem(item.id)
      onNext?.()
      onClose()
    } finally {
      setIsProcessing(false)
    }
  }

  // ─── Reject ───────────────────────────────────────────────────────────────

  const handleReject = async () => {
    setIsProcessing(true)
    try {
      await rejectImage(variant.id)
      showToast('Image rejected — upload a better photo', 'warning')
      await loadVariantsForItem(item.id)
      onNext?.()
      onClose()
    } finally {
      setIsProcessing(false)
    }
  }

  // ─── Re-upload + retry background removal ────────────────────────────────

  const handleReupload = async (file: File) => {
    setIsReuploading(true)
    try {
      const { url, error: uploadError } = await uploadVariantImage(`${item.id}_${variant.id}_retry`, file)
      if (uploadError || !url) {
        showToast(uploadError ?? 'Upload failed', 'error')
        return
      }
      // Update original_image_url and reset image_status to processing
      await updateVariant(variant.id, {
        image_status: 'processing',
        clean_image_url: null,
      } as Parameters<typeof updateVariant>[1])
      // Also update original_image_url (not in updateVariant type, write directly)
      const { supabase } = await import('@/lib/supabase')
      await supabase
        .from('furniture_variants')
        .update({ original_image_url: url, image_status: 'processing', clean_image_url: null })
        .eq('id', variant.id)

      const { error: bgError } = await triggerBackgroundRemoval(variant.id)
      if (bgError) {
        showToast('Background removal failed to start', 'error')
        return
      }
      showToast('New image uploaded — re-running background removal…', 'success')
      await loadVariantsForItem(item.id)
      onClose()
    } finally {
      setIsReuploading(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const originalUrl = variant.original_image_url
  const cleanUrl = variant.clean_image_url

  return (
    <div className="approval-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="approval-box">
        {/* Header */}
        <div className="approval-header">
          <div>
            <p className="approval-item-name">{item.name}</p>
            <h2 className="approval-title">Review background removal — "{variant.color_name}"</h2>
          </div>
          <button className="approval-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Images */}
        <div className="approval-images">
          <div className="approval-image-panel">
            <span className="approval-image-label">Original</span>
            <div className="approval-image-frame checker">
              {originalUrl
                ? <img src={originalUrl} alt="Original" className="approval-img" />
                : <div className="approval-img-placeholder">No image</div>
              }
            </div>
          </div>

          <div className="approval-arrow">→</div>

          <div className="approval-image-panel">
            <span className="approval-image-label">Background removed</span>
            <div className="approval-image-frame checker">
              {cleanUrl
                ? <img src={cleanUrl} alt="Background removed" className="approval-img" />
                : <div className="approval-img-placeholder processing">
                    <Loader2 size={22} className="spin" />
                    <span>Processing…</span>
                  </div>
              }
            </div>
          </div>
        </div>

        {/* Info */}
        <p className="approval-info">
          If the result looks good, approve it — TRELLIS will generate a 3D model and isometric sprites.
          If it's poor quality, reject it and upload a better photo below.
        </p>

        {/* Actions */}
        <div className="approval-actions">
          <div className="approval-primary-btns">
            <button
              className="approval-reject-btn"
              onClick={handleReject}
              disabled={isProcessing || !cleanUrl}
            >
              <XCircle size={15} />
              Reject
            </button>
            <button
              className="approval-approve-btn"
              onClick={handleApprove}
              disabled={isProcessing || !cleanUrl}
            >
              {isProcessing ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
              Approve & Generate 3D
            </button>
          </div>

          {/* Re-upload section */}
          <div className="reupload-section">
            <span className="reupload-label">Upload a better photo instead:</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleReupload(file)
                e.target.value = ''
              }}
            />
            <button
              className="reupload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isReuploading}
            >
              {isReuploading
                ? <><Loader2 size={13} className="spin" /> Uploading…</>
                : <><Upload size={13} /> Upload & Retry</>
              }
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .approval-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1010;
          padding: 16px;
        }
        .approval-box {
          background: var(--color-panel-bg);
          border-radius: 14px;
          width: 100%;
          max-width: 580px;
          max-height: 90dvh;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 18px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.22);
          overflow-y: auto;
        }
        .approval-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
        }
        .approval-item-name {
          font-size: 11px;
          color: var(--color-text-secondary);
          margin: 0 0 2px;
        }
        .approval-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--color-text-primary);
          margin: 0;
        }
        .approval-close-btn {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
        }
        .approval-close-btn:hover {
          background: var(--color-hover-bg);
        }
        .approval-images {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .approval-image-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .approval-image-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .approval-image-frame {
          width: 100%;
          aspect-ratio: 1;
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid var(--color-border-custom);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .checker {
          background-image:
            linear-gradient(45deg, #e0e0e0 25%, transparent 25%),
            linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #e0e0e0 75%),
            linear-gradient(-45deg, transparent 75%, #e0e0e0 75%);
          background-size: 16px 16px;
          background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
          background-color: white;
        }
        .approval-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .approval-img-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 12px;
          color: var(--color-text-secondary);
          width: 100%;
          height: 100%;
          min-height: 120px;
        }
        .approval-img-placeholder.processing {
          color: var(--color-primary-brand);
        }
        .approval-arrow {
          font-size: 20px;
          color: var(--color-text-secondary);
          flex-shrink: 0;
          align-self: center;
          margin-top: 20px;
        }
        .approval-info {
          font-size: 12px;
          color: var(--color-text-secondary);
          line-height: 1.5;
          margin: 0;
        }
        .approval-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .approval-primary-btns {
          display: flex;
          gap: 8px;
        }
        .approval-reject-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 9px 18px;
          border-radius: 8px;
          border: 1.5px solid var(--color-error);
          background: transparent;
          color: var(--color-error);
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
        }
        .approval-reject-btn:hover:not(:disabled) {
          background: rgba(229, 77, 66, 0.06);
        }
        .approval-reject-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .approval-approve-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 18px;
          border-radius: 8px;
          border: none;
          background: var(--color-success);
          color: white;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
        }
        .approval-approve-btn:hover:not(:disabled) {
          background: #3d9e70;
        }
        .approval-approve-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .reupload-section {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: var(--color-card-bg);
          border-radius: 8px;
          border: 1px solid var(--color-border-custom);
        }
        .reupload-label {
          flex: 1;
          font-size: 12px;
          color: var(--color-text-secondary);
        }
        .reupload-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 12px;
          border-radius: 7px;
          border: 1.5px solid var(--color-primary-brand);
          background: transparent;
          color: var(--color-primary-brand);
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          white-space: nowrap;
        }
        .reupload-btn:hover:not(:disabled) {
          background: var(--color-primary-brand-light);
        }
        .reupload-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin { animation: spin 0.8s linear infinite; }
      `}</style>
    </div>
  )
}
