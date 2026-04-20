import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore } from '@/stores/useUIStore'

export default function NewProjectModal() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { createProject } = useProjectStore()
  const { closeModal, showToast } = useUIStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setIsSubmitting(true)
    setError(null)
    const { id, error: err } = await createProject(name.trim(), description.trim() || undefined)
    setIsSubmitting(false)
    if (err || !id) {
      setError(err ?? t('dashboard.errorCreateFailed'))
      return
    }
    showToast(t('toasts.projectCreated'), 'success')
    closeModal()
    navigate(`/editor/${id}`)
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{t('dashboard.newProjectTitle')}</h2>
          <button className="modal-close" onClick={closeModal}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="field">
            <label className="field-label">{t('dashboard.projectNameLabel')}</label>
            <input
              className="field-input"
              type="text"
              placeholder={t('dashboard.projectNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={100}
            />
          </div>

          <div className="field">
            <label className="field-label">{t('dashboard.descriptionLabel')}</label>
            <textarea
              className="field-input field-textarea"
              placeholder={t('dashboard.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>

          {error && <p className="modal-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={closeModal}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? t('dashboard.creating') : t('dashboard.createProjectSubmit')}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 16px;
        }

        .modal-card {
          background: var(--color-panel-bg);
          border-radius: 12px;
          box-shadow: var(--shadow-lg);
          width: 100%;
          max-width: 420px;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--color-border-custom);
        }

        .modal-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-text-primary);
        }

        .modal-close {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
        }

        .modal-close:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }

        .modal-body {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .field-input {
          padding: 8px 10px;
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
          background: var(--color-input-bg);
          font-size: 13px;
          font-family: inherit;
          color: var(--color-text-primary);
          outline: none;
          transition: border-color 0.15s;
        }

        .field-input:focus {
          border-color: var(--color-primary-brand);
        }

        .field-textarea {
          resize: vertical;
          min-height: 72px;
        }

        .modal-error {
          font-size: 12px;
          color: var(--color-error);
        }

        .modal-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          padding-top: 4px;
        }

        .btn-ghost {
          padding: 7px 14px;
          border-radius: 8px;
          background: none;
          border: none;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          color: var(--color-text-secondary);
          cursor: pointer;
        }

        .btn-ghost:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }

        .btn-primary {
          padding: 7px 16px;
          border-radius: 8px;
          background: var(--color-primary-brand);
          border: none;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          color: white;
          cursor: pointer;
          transition: all 0.15s;
        }

        .btn-primary:hover:not(:disabled) {
          background: var(--color-primary-brand-hover);
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}
