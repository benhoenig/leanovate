import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { X, Check, XCircle, RefreshCw, Loader2 } from 'lucide-react'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useUIStore } from '@/stores/useUIStore'
import { SUPABASE_URL, SUPABASE_ANON_KEY, getAuthToken } from '@/lib/supabase'
import type { FurnitureItem, FurnitureVariant } from '@/types'

interface Props {
  item: FurnitureItem
  variant: FurnitureVariant
  onClose: () => void
  /** Called after approve/reject — caller can advance to next pending variant */
  onNext?: () => void
}

export default function ModelApprovalModal({ item, variant, onClose, onNext }: Props) {
  const { t } = useTranslation()
  const { approveRender, rejectRender, retryRender } = useCatalogStore()
  const { showToast } = useUIStore()

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // ─── Render .glb preview ──────────────────────────────────────────────────
  useEffect(() => {
    if (!variant.glb_path || !canvasRef.current) return

    const canvas = canvasRef.current
    let renderer: THREE.WebGLRenderer | null = null
    let scene: THREE.Scene | null = null
    let camera: THREE.PerspectiveCamera | null = null
    let model: THREE.Group | null = null
    let animationId = 0
    let cancelled = false

    async function init() {
      try {
        setLoading(true)
        setLoadError(null)

        const token = getAuthToken()
        const resp = await fetch(
          `${SUPABASE_URL}/storage/v1/object/glb-models/${variant.glb_path}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: SUPABASE_ANON_KEY,
            },
          }
        )

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const buffer = await resp.arrayBuffer()
        if (cancelled) return

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.setClearColor(0x000000, 0)
        renderer.outputColorSpace = THREE.SRGBColorSpace

        scene = new THREE.Scene()
        scene.add(new THREE.AmbientLight(0xffffff, 1.2))
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.4)
        keyLight.position.set(5, 8, 6)
        scene.add(keyLight)
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.6)
        fillLight.position.set(-5, 3, -4)
        scene.add(fillLight)

        camera = new THREE.PerspectiveCamera(35, canvas.clientWidth / canvas.clientHeight, 0.1, 100)

        const loader = new GLTFLoader()
        const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
          loader.parse(buffer, '', resolve, (err) => reject(err))
        })
        if (cancelled) return

        model = gltf.scene
        // Brighten PBR materials (TRELLIS produces dark metallic surfaces)
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mat = (child as THREE.Mesh).material
            const arr = Array.isArray(mat) ? mat : [mat]
            for (const m of arr) {
              if (m instanceof THREE.MeshStandardMaterial) {
                m.metalness = Math.min(m.metalness, 0.3)
                m.roughness = Math.max(m.roughness, 0.4)
                m.needsUpdate = true
              }
            }
          }
        })

        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = 2.0 / maxDim
        model.scale.setScalar(scale)
        model.position.sub(center.multiplyScalar(scale))
        scene.add(model)

        camera.position.set(3, 2, 3)
        camera.lookAt(0, 0, 0)

        setLoading(false)

        // Auto-rotate
        const animate = () => {
          if (cancelled || !model || !renderer || !scene || !camera) return
          model.rotation.y += 0.006
          renderer.render(scene, camera)
          animationId = requestAnimationFrame(animate)
        }
        animate()
      } catch (err) {
        console.error('[ModelApprovalModal] load error:', err)
        if (!cancelled) {
          setLoadError(String(err))
          setLoading(false)
        }
      }
    }

    init()

    return () => {
      cancelled = true
      if (animationId) cancelAnimationFrame(animationId)
      renderer?.dispose()
      renderer?.forceContextLoss()
    }
  }, [variant.glb_path])

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleApprove = async () => {
    setIsProcessing(true)
    try {
      const { error } = await approveRender(variant.id)
      if (error) {
        showToast(error, 'error')
        return
      }
      showToast(t('modelApproval.approvedToast'), 'success')
      onNext?.()
      onClose()
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    setIsProcessing(true)
    try {
      const { error } = await rejectRender(variant.id)
      if (error) {
        showToast(error, 'error')
        return
      }
      showToast(t('modelApproval.rejectedToast'), 'warning')
      onNext?.()
      onClose()
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRetry = async () => {
    setIsProcessing(true)
    try {
      const { error } = await retryRender(variant.id)
      if (error) {
        showToast(error, 'error')
        return
      }
      showToast(t('modelApproval.regeneratingToast'), 'success')
      onClose()
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="approval-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="approval-box">
        {/* Header */}
        <div className="approval-header">
          <div>
            <p className="approval-item-name">{item.name}</p>
            <h2 className="approval-title">{t('modelApproval.heading', { color: variant.color_name })}</h2>
          </div>
          <button className="approval-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Preview canvas + source image */}
        <div className="approval-preview">
          <div className="approval-glb-wrap">
            <span className="approval-label">{t('modelApproval.generatedLabel')}</span>
            <div className="approval-glb-frame">
              <canvas ref={canvasRef} className="approval-glb-canvas" width={400} height={400} />
              {loading && (
                <div className="approval-loading">
                  <Loader2 size={22} className="spin" />
                  <span>{t('modelApproval.loadingModel')}</span>
                </div>
              )}
              {loadError && !loading && (
                <div className="approval-loading error">
                  <span>{t('modelApproval.loadFailed')}</span>
                  <span className="error-detail">{loadError}</span>
                </div>
              )}
            </div>
          </div>

          {variant.original_image_urls.length > 0 && (
            <div className="approval-source-wrap">
              <span className="approval-label">{t('modelApproval.sourceLabel')}</span>
              <img
                src={variant.original_image_urls[0]}
                alt={t('modelApproval.sourceAlt')}
                className="approval-source-img"
              />
              {variant.original_image_urls.length > 1 && (
                <span className="approval-source-count">
                  {t('modelApproval.sourceMoreCount', { count: variant.original_image_urls.length - 1 })}
                </span>
              )}
            </div>
          )}
        </div>

        <p className="approval-info">
          {t('modelApproval.info')}
        </p>

        {/* Actions */}
        <div className="approval-actions">
          <button className="approval-reject-btn" onClick={handleReject} disabled={isProcessing}>
            <XCircle size={15} />
            {t('modelApproval.reject')}
          </button>
          <button className="approval-retry-btn" onClick={handleRetry} disabled={isProcessing}>
            <RefreshCw size={14} />
            {t('modelApproval.retry')}
          </button>
          <button className="approval-approve-btn" onClick={handleApprove} disabled={isProcessing || !!loadError}>
            {isProcessing ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            {t('modelApproval.approve')}
          </button>
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
          max-width: 620px;
          max-height: 92dvh;
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
        .approval-preview {
          display: flex;
          gap: 12px;
        }
        .approval-glb-wrap {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .approval-source-wrap {
          width: 120px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .approval-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .approval-glb-frame {
          width: 100%;
          aspect-ratio: 1;
          border-radius: 10px;
          border: 1px solid var(--color-border-custom);
          background:
            linear-gradient(135deg, #fafafa 0%, #f0f0f0 100%);
          position: relative;
          overflow: hidden;
        }
        .approval-glb-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }
        .approval-loading {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 12px;
          color: var(--color-primary-brand);
          background: rgba(255,255,255,0.8);
        }
        .approval-loading.error {
          color: var(--color-error);
        }
        .error-detail {
          font-size: 10px;
          max-width: 80%;
          text-align: center;
          word-break: break-word;
          opacity: 0.7;
        }
        .approval-source-img {
          width: 100%;
          aspect-ratio: 1;
          object-fit: contain;
          border-radius: 10px;
          border: 1px solid var(--color-border-custom);
          background: white;
        }
        .approval-source-count {
          font-size: 10px;
          color: var(--color-text-secondary);
          text-align: center;
        }
        .approval-info {
          font-size: 12px;
          color: var(--color-text-secondary);
          line-height: 1.5;
          margin: 0;
        }
        .approval-actions {
          display: flex;
          gap: 8px;
        }
        .approval-reject-btn,
        .approval-retry-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 9px 16px;
          border-radius: 8px;
          border: 1.5px solid var(--color-border-custom);
          background: transparent;
          color: var(--color-text-primary);
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
        }
        .approval-reject-btn {
          color: var(--color-error);
          border-color: var(--color-error);
        }
        .approval-reject-btn:hover:not(:disabled) {
          background: rgba(229, 77, 66, 0.06);
        }
        .approval-retry-btn:hover:not(:disabled) {
          background: var(--color-hover-bg);
        }
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
        .approval-reject-btn:disabled,
        .approval-retry-btn:disabled,
        .approval-approve-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin { animation: spin 0.8s linear infinite; }
      `}</style>
    </div>
  )
}
