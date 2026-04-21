import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Upload, Trash2, Users, Lock, ImageOff } from 'lucide-react'
import { useArtStore } from '@/stores/useArtStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUIStore } from '@/stores/useUIStore'
import type { ArtImage } from '@/types'

interface Props {
  /** Aspect ratio (w/h) of the frame's mat opening. Used to filter art that fits. */
  frameAspectRatio: number
  /** Current art_id on the placed frame, if any (so the tile is highlighted). */
  currentArtId: string | null
  onClose: () => void
  /** Called when the designer picks art (null = empty frame). */
  onPick: (artId: string | null) => void
}

type Tab = 'my' | 'team' | 'upload'

// Art with aspect ratio within this factor of the frame is considered a fit.
// ±10% is generous enough for "close enough" crops without showing everything.
const ASPECT_TOLERANCE = 0.1

export default function ArtPickerModal({ frameAspectRatio, currentArtId, onClose, onPick }: Props) {
  const { t } = useTranslation()
  // Destructuring subscribes to the whole store; acceptable scope for a modal.
  const { loadArt, uploadArt, setScope, deleteArt, getMyArt, getTeamArt, getArtUrl } = useArtStore()
  const { profile } = useAuthStore()
  const { showToast } = useUIStore()

  const [tab, setTab] = useState<Tab>('my')
  const [fitOnly, setFitOnly] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Load art once when modal mounts.
  useEffect(() => {
    loadArt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Revoke preview URL on unmount / replacement.
  useEffect(() => {
    return () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    }
  }, [pendingPreview])

  const myArt = getMyArt()
  const teamArt = getTeamArt()

  const listed = useMemo(() => {
    const pool = tab === 'my' ? myArt : tab === 'team' ? teamArt : []
    if (!fitOnly) return pool
    return pool.filter((a) => Math.abs(a.aspect_ratio - frameAspectRatio) / frameAspectRatio <= ASPECT_TOLERANCE)
  }, [tab, myArt, teamArt, fitOnly, frameAspectRatio])

  const handleFileSelect = (file: File | null) => {
    if (!file) return
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(file)
    setPendingPreview(URL.createObjectURL(file))
    if (!uploadName.trim()) {
      setUploadName(file.name.replace(/\.[^.]+$/, ''))
    }
  }

  const handleUpload = async () => {
    if (!pendingFile) return
    setUploading(true)
    const { art: created, error } = await uploadArt(pendingFile, uploadName.trim() || pendingFile.name)
    setUploading(false)
    if (error || !created) {
      showToast(error ?? t('artPicker.toastUploadFailed'), 'error')
      return
    }
    showToast(t('artPicker.toastUploaded'), 'success')
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingPreview(null)
    setUploadName('')
    setTab('my')
  }

  const handleToggleScope = async (a: ArtImage) => {
    const next = a.scope === 'team' ? 'private' : 'team'
    const { error } = await setScope(a.id, next)
    if (error) showToast(error, 'error')
  }

  const handleDelete = async (a: ArtImage) => {
    if (!confirm(t('artPicker.deleteConfirm', { name: a.name }))) return
    const { error } = await deleteArt(a.id)
    if (error) showToast(error, 'error')
  }

  const canEditArt = (a: ArtImage) => a.uploaded_by === profile?.id || profile?.role === 'admin'

  return (
    <div className="art-picker-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="art-picker-box">
        <div className="art-picker-header">
          <h2>{t('artPicker.title')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('artPicker.close')}>
            <X size={16} />
          </button>
        </div>

        <div className="art-picker-tabs">
          <button className={`tab-btn ${tab === 'my' ? 'active' : ''}`} onClick={() => setTab('my')}>
            {t('artPicker.tabMy', { count: myArt.length })}
          </button>
          <button className={`tab-btn ${tab === 'team' ? 'active' : ''}`} onClick={() => setTab('team')}>
            {t('artPicker.tabTeam', { count: teamArt.length })}
          </button>
          <button className={`tab-btn ${tab === 'upload' ? 'active' : ''}`} onClick={() => setTab('upload')}>
            {t('artPicker.tabUpload')}
          </button>
        </div>

        {tab !== 'upload' && (
          <div className="art-picker-toolbar">
            <label className="fit-toggle">
              <input type="checkbox" checked={fitOnly} onChange={(e) => setFitOnly(e.target.checked)} />
              <span>
                {t('artPicker.fitFilterLabel', {
                  orientation: frameAspectRatio >= 1 ? t('artPicker.orientationLandscape') : t('artPicker.orientationPortrait'),
                  ratio: frameAspectRatio.toFixed(2),
                })}
              </span>
            </label>
            <button
              className="empty-frame-btn"
              onClick={() => {
                onPick(null)
                onClose()
              }}
            >
              <ImageOff size={13} />
              {t('artPicker.leaveEmpty')}
            </button>
          </div>
        )}

        <div className="art-picker-body">
          {tab === 'upload' ? (
            <div className="upload-pane">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
              />
              {pendingPreview ? (
                <div className="upload-preview-wrap">
                  <img src={pendingPreview} alt="" className="upload-preview-img" />
                </div>
              ) : (
                <button className="upload-dropzone" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={32} />
                  <span>{t('artPicker.uploadCta')}</span>
                  <span className="upload-hint">{t('artPicker.uploadHint')}</span>
                </button>
              )}

              {pendingFile && (
                <>
                  <input
                    className="upload-name-input"
                    placeholder={t('artPicker.uploadNamePlaceholder')}
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                  />
                  <div className="upload-actions">
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        if (pendingPreview) URL.revokeObjectURL(pendingPreview)
                        setPendingFile(null)
                        setPendingPreview(null)
                        setUploadName('')
                      }}
                    >
                      {t('artPicker.uploadCancel')}
                    </button>
                    <button className="btn-primary" onClick={handleUpload} disabled={uploading}>
                      {uploading ? t('artPicker.uploading') : t('artPicker.uploadSubmit')}
                    </button>
                  </div>
                </>
              )}
              <p className="upload-footnote">{t('artPicker.uploadFootnote')}</p>
            </div>
          ) : listed.length === 0 ? (
            <div className="empty-state">
              {tab === 'my' ? t('artPicker.emptyMine') : t('artPicker.emptyTeam')}
              {fitOnly && <div className="empty-sub">{t('artPicker.emptyFilterHint')}</div>}
            </div>
          ) : (
            <div className="art-grid">
              {listed.map((a) => {
                const isPicked = a.id === currentArtId
                const url = getArtUrl(a)
                const editable = canEditArt(a)
                return (
                  <div
                    key={a.id}
                    className={`art-tile ${isPicked ? 'picked' : ''}`}
                    onClick={() => {
                      onPick(a.id)
                      onClose()
                    }}
                  >
                    <div
                      className="art-thumb"
                      style={{ aspectRatio: `${a.aspect_ratio}`, backgroundImage: `url(${url})` }}
                    />
                    <div className="art-meta">
                      <div className="art-name" title={a.name}>{a.name}</div>
                      <div className="art-aspect">{a.aspect_ratio.toFixed(2)}:1</div>
                    </div>
                    {editable && (
                      <div className="art-tile-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className={`scope-btn ${a.scope === 'team' ? 'team' : ''}`}
                          title={a.scope === 'team' ? t('artPicker.scopeToMakePrivate') : t('artPicker.scopeToMakeTeam')}
                          onClick={() => handleToggleScope(a)}
                        >
                          {a.scope === 'team' ? <Users size={12} /> : <Lock size={12} />}
                          {a.scope === 'team' ? t('editor.properties.artScopeTeam') : t('editor.properties.artScopePrivate')}
                        </button>
                        <button className="delete-btn" title={t('artPicker.delete')} onClick={() => handleDelete(a)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <style>{styles}</style>
    </div>
  )
}

const styles = `
.art-picker-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.art-picker-box {
  width: 720px; max-width: 92vw;
  height: 640px; max-height: 86vh;
  background: var(--color-panel-bg);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.art-picker-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}
.art-picker-header h2 { font-size: 15px; font-weight: 700; color: var(--color-text-primary); margin: 0; }
.icon-btn {
  background: none; border: none; cursor: pointer;
  color: var(--color-text-secondary);
  padding: 4px; border-radius: 6px;
}
.icon-btn:hover { background: var(--color-hover-bg); }
.art-picker-tabs {
  display: flex; gap: 0;
  border-bottom: 1px solid var(--color-border);
}
.tab-btn {
  flex: 1; padding: 10px 0;
  background: none; border: none; cursor: pointer;
  font-size: 12px; font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}
.tab-btn.active { color: var(--color-primary-brand); border-bottom-color: var(--color-primary-brand); }
.art-picker-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px;
  background: var(--color-card-bg);
  border-bottom: 1px solid var(--color-border);
}
.fit-toggle {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--color-text-secondary);
  cursor: pointer;
}
.empty-frame-btn {
  display: flex; align-items: center; gap: 4px;
  background: none; border: 1px solid var(--color-border); border-radius: 6px;
  padding: 4px 10px; font-size: 11px; color: var(--color-text-primary);
  cursor: pointer;
}
.empty-frame-btn:hover { background: var(--color-hover-bg); }
.art-picker-body { flex: 1; overflow-y: auto; padding: 14px 16px; }
.art-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.art-tile {
  position: relative;
  background: var(--color-card-bg);
  border: 1.5px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.15s ease;
}
.art-tile:hover { border-color: var(--color-primary-brand); }
.art-tile.picked { border-color: var(--color-primary-brand); box-shadow: 0 0 0 2px rgba(43,168,160,0.15); }
.art-thumb {
  width: 100%;
  background-size: cover; background-position: center;
  background-color: #ececec;
}
.art-meta {
  padding: 6px 8px;
  display: flex; align-items: center; justify-content: space-between;
}
.art-name {
  font-size: 11px; font-weight: 600; color: var(--color-text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 140px;
}
.art-aspect { font-size: 10px; color: var(--color-text-secondary); }
.art-tile-actions {
  position: absolute; top: 6px; right: 6px;
  display: flex; gap: 4px;
}
.scope-btn, .delete-btn {
  display: flex; align-items: center; gap: 3px;
  background: rgba(255,255,255,0.95);
  border: 1px solid var(--color-border); border-radius: 5px;
  padding: 3px 6px;
  font-size: 9px; font-weight: 600;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.scope-btn.team { background: var(--color-primary-brand); color: white; border-color: var(--color-primary-brand); }
.delete-btn:hover { background: var(--color-error); color: white; border-color: var(--color-error); }
.empty-state {
  padding: 40px 16px; text-align: center;
  font-size: 12px; color: var(--color-text-secondary);
}
.empty-sub { margin-top: 4px; font-size: 10px; opacity: 0.7; }
.upload-pane { display: flex; flex-direction: column; gap: 10px; }
.upload-dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 48px 16px;
  background: var(--color-card-bg);
  border: 1.5px dashed var(--color-border); border-radius: 10px;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 12px; font-weight: 600;
}
.upload-dropzone:hover { border-color: var(--color-primary-brand); color: var(--color-primary-brand); }
.upload-hint { font-size: 10px; font-weight: 400; opacity: 0.8; }
.upload-preview-wrap {
  padding: 10px;
  background: var(--color-card-bg);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  text-align: center;
}
.upload-preview-img { max-width: 100%; max-height: 280px; border-radius: 6px; }
.upload-name-input {
  padding: 8px 10px; font-size: 12px;
  border: 1px solid var(--color-border); border-radius: 8px;
  background: var(--color-input-bg);
}
.upload-actions { display: flex; justify-content: flex-end; gap: 8px; }
.upload-footnote { font-size: 10px; color: var(--color-text-secondary); text-align: center; margin-top: 4px; }
`
