import { useState } from 'react'
import { Trash2, Globe, User, Shuffle, ArrowUpCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTemplateStore } from '@/stores/useTemplateStore'
import { useCatalogStore } from '@/stores/useCatalogStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUIStore } from '@/stores/useUIStore'
import type { DesignStyleTemplate } from '@/types'
import StalenessDialog from './StalenessDialog'

type SubTab = 'unit' | 'furniture' | 'style'

export default function TemplatePanel() {
  const { t } = useTranslation()
  const {
    unitTemplates, furnitureTemplates, styleTemplates,
    saveUnitTemplate, saveFurnitureTemplate, saveStyleTemplate,
    applyUnitTemplate, applyFurnitureTemplate, applyStyleTemplate,
    regenerateStyle,
    promoteTemplate, deleteTemplate,
    stalenessAlerts, clearStalenessAlerts,
  } = useTemplateStore()
  const profile = useAuthStore((s) => s.profile)
  const styles = useCatalogStore((s) => s.styles)
  const { showToast } = useUIStore()

  const [subTab, setSubTab] = useState<SubTab>('unit')
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveStyleId, setSaveStyleId] = useState('')
  const [applying, setApplying] = useState(false)
  const [pendingStyleTemplateId, setPendingStyleTemplateId] = useState<string | null>(null)

  const isAdmin = profile?.role === 'admin'

  // ── Save handler ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!saveName.trim()) return
    setApplying(true)
    let result: { id: string | null; error: string | null }
    if (subTab === 'unit') {
      result = await saveUnitTemplate(saveName.trim())
    } else if (subTab === 'furniture') {
      result = await saveFurnitureTemplate(saveName.trim())
    } else {
      if (!saveStyleId) {
        showToast(t('templates.selectStyleToast'), 'warning')
        setApplying(false)
        return
      }
      result = await saveStyleTemplate(saveName.trim(), saveStyleId)
    }
    setApplying(false)
    if (result.error) {
      showToast(result.error, 'error')
    } else {
      showToast(t('templates.templateSavedToast'), 'success')
      setSaving(false)
      setSaveName('')
      setSaveStyleId('')
    }
  }

  // ── Apply handler ──────────────────────────────────────────────────────────

  const handleApply = async (templateId: string) => {
    setApplying(true)
    if (subTab === 'unit') {
      const { error } = await applyUnitTemplate(templateId)
      if (error) showToast(error, 'error')
      else showToast(t('templates.unitLayoutApplied'), 'success')
    } else if (subTab === 'furniture') {
      const { error } = await applyFurnitureTemplate(templateId)
      if (error) showToast(error, 'warning')
      else showToast(t('templates.furnitureLayoutApplied'), 'success')
    } else {
      const { alerts, error } = await applyStyleTemplate(templateId)
      if (error) { showToast(error, 'error'); setApplying(false); return }
      if (alerts.length > 0) {
        setPendingStyleTemplateId(templateId)
        setApplying(false)
        return
      }
      showToast(t('templates.designStyleApplied'), 'success')
    }
    setApplying(false)
  }

  const handleForceApply = async () => {
    if (!pendingStyleTemplateId) return
    setApplying(true)
    await applyStyleTemplate(pendingStyleTemplateId, true)
    setPendingStyleTemplateId(null)
    clearStalenessAlerts()
    showToast(t('templates.designStyleApplied'), 'success')
    setApplying(false)
  }

  const handleRegenerate = async (styleId: string) => {
    setApplying(true)
    const { error } = await regenerateStyle(styleId)
    if (error) showToast(error, 'warning')
    else showToast(t('templates.furnitureRegenerated'), 'success')
    setApplying(false)
  }

  // ── Render template list ──────────────────────────────────────────────────

  const renderTemplateCard = (
    template: { id: string; name: string; created_by: string; is_global: boolean },
    type: 'unit' | 'furniture' | 'style',
    extra?: React.ReactNode,
  ) => {
    const isOwn = template.created_by === profile?.id
    return (
      <div key={template.id} className="tp-card">
        <div className="tp-card-header">
          <span className="tp-card-name">{template.name}</span>
          <span className={`tp-badge ${template.is_global ? 'global' : 'personal'}`}>
            {template.is_global ? <><Globe size={9} /> {t('templates.badgeGlobalLabel')}</> : <><User size={9} /> {t('templates.badgePersonalLabel')}</>}
          </span>
        </div>
        <div className="tp-card-actions">
          <button
            className="tp-apply-btn"
            onClick={() => handleApply(template.id)}
            disabled={applying}
          >
            {t('templates.applyButton')}
          </button>
          {extra}
          {isAdmin && !template.is_global && (
            <button
              className="tp-promote-btn"
              onClick={() => promoteTemplate(type, template.id)}
              title={t('templates.promoteToGlobal')}
            >
              <ArrowUpCircle size={13} />
            </button>
          )}
          {(isOwn || isAdmin) && (
            <button
              className="tp-delete-btn"
              onClick={() => deleteTemplate(type, template.id)}
              title={t('templates.deleteTemplateTitle')}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderList = () => {
    if (subTab === 'unit') {
      if (unitTemplates.length === 0) return <p className="tp-empty">{t('templates.noUnitTemplates')}</p>
      return unitTemplates.map((tpl) => renderTemplateCard(tpl, 'unit'))
    }
    if (subTab === 'furniture') {
      if (furnitureTemplates.length === 0) return <p className="tp-empty">{t('templates.noFurnitureTemplates')}</p>
      return furnitureTemplates.map((tpl) => renderTemplateCard(tpl, 'furniture'))
    }
    if (styleTemplates.length === 0) return <p className="tp-empty">{t('templates.noStyleTemplates')}</p>
    return styleTemplates.map((tpl) => {
      const style = styles.find((s) => s.id === (tpl as DesignStyleTemplate).style_id)
      return renderTemplateCard(tpl, 'style', (
        <>
          {style && <span className="tp-style-tag">{style.name}</span>}
          <button
            className="tp-regen-btn"
            onClick={() => handleRegenerate((tpl as DesignStyleTemplate).style_id)}
            disabled={applying}
            title={t('templates.regenerateTitle')}
          >
            <Shuffle size={12} />
          </button>
        </>
      ))
    })
  }

  return (
    <div className="template-panel">
      {/* Sub-tab pills */}
      <div className="tp-subtabs">
        {(['unit', 'furniture', 'style'] as SubTab[]).map((tab) => (
          <button
            key={tab}
            className={`tp-subtab ${subTab === tab ? 'active' : ''}`}
            onClick={() => { setSubTab(tab); setSaving(false) }}
          >
            {tab === 'unit' ? t('templates.tabUnit') : tab === 'furniture' ? t('templates.tabFurniture') : t('templates.tabStyle')}
          </button>
        ))}
      </div>

      {/* Template list */}
      <div className="tp-list">
        {renderList()}
      </div>

      {/* Save button / form */}
      <div className="tp-save-area">
        {saving ? (
          <div className="tp-save-form">
            <input
              className="tp-save-input"
              placeholder={t('templates.saveNamePlaceholder')}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false) }}
              autoFocus
            />
            {subTab === 'style' && (
              <select
                className="tp-style-select"
                value={saveStyleId}
                onChange={(e) => setSaveStyleId(e.target.value)}
              >
                <option value="">{t('templates.selectStyleOption')}</option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <div className="tp-save-btns">
              <button className="tp-save-confirm" onClick={handleSave} disabled={applying}>
                {t('common.save')}
              </button>
              <button className="tp-save-cancel" onClick={() => setSaving(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button className="tp-save-btn" onClick={() => setSaving(true)}>
            {t('templates.saveCurrentAsTemplate')}
          </button>
        )}
      </div>

      {/* Staleness dialog */}
      {pendingStyleTemplateId && stalenessAlerts.length > 0 && (
        <StalenessDialog
          alerts={stalenessAlerts}
          onConfirm={handleForceApply}
          onCancel={() => { setPendingStyleTemplateId(null); clearStalenessAlerts() }}
        />
      )}

      <style>{templateStyle}</style>
    </div>
  )
}

const templateStyle = `
  .template-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .tp-subtabs {
    display: flex;
    gap: 4px;
    padding: 10px 12px 8px;
    flex-shrink: 0;
  }
  .tp-subtab {
    flex: 1;
    padding: 5px 10px;
    border-radius: 6px;
    border: none;
    background: var(--color-hover-bg);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .tp-subtab:hover {
    color: var(--color-text-primary);
  }
  .tp-subtab.active {
    background: var(--color-primary-brand);
    color: white;
  }

  .tp-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tp-empty {
    font-size: 11px;
    color: var(--color-text-secondary);
    text-align: center;
    padding: 20px 0;
    opacity: 0.6;
  }

  .tp-card {
    padding: 10px;
    border-radius: 10px;
    background: var(--color-card-bg);
    border: 1px solid var(--color-border-custom);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tp-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .tp-card-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tp-badge {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 9px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .tp-badge.global {
    background: var(--color-primary-brand);
    color: white;
  }
  .tp-badge.personal {
    background: var(--color-hover-bg);
    color: var(--color-text-secondary);
  }

  .tp-card-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tp-apply-btn {
    padding: 4px 12px;
    border-radius: 6px;
    border: 1.5px solid var(--color-primary-brand);
    background: transparent;
    color: var(--color-primary-brand);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .tp-apply-btn:hover:not(:disabled) {
    background: var(--color-primary-brand);
    color: white;
  }
  .tp-apply-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .tp-style-tag {
    font-size: 9px;
    font-weight: 500;
    color: var(--color-text-secondary);
    background: var(--color-hover-bg);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .tp-regen-btn,
  .tp-promote-btn,
  .tp-delete-btn {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    transition: all 0.15s;
  }
  .tp-regen-btn:hover {
    color: var(--color-secondary);
    background: rgba(242, 115, 90, 0.08);
  }
  .tp-promote-btn:hover {
    color: var(--color-primary-brand);
    background: var(--color-primary-brand-light);
  }
  .tp-delete-btn {
    margin-left: auto;
  }
  .tp-delete-btn:hover {
    color: var(--color-error);
    background: rgba(229, 77, 66, 0.08);
  }

  .tp-save-area {
    flex-shrink: 0;
    padding: 10px 12px;
    border-top: 1px solid var(--color-border-custom);
  }
  .tp-save-btn {
    width: 100%;
    padding: 8px;
    border-radius: 8px;
    border: 1.5px dashed var(--color-primary-brand);
    background: var(--color-primary-brand-light);
    color: var(--color-primary-brand);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .tp-save-btn:hover {
    background: rgba(43, 168, 160, 0.12);
  }
  .tp-save-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tp-save-input {
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--color-border-custom);
    border-radius: 7px;
    background: var(--color-input-bg);
    font-size: 12px;
    font-family: inherit;
    color: var(--color-text-primary);
    outline: none;
    box-sizing: border-box;
  }
  .tp-save-input:focus {
    border-color: var(--color-primary-brand);
  }
  .tp-style-select {
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--color-border-custom);
    border-radius: 7px;
    background: var(--color-input-bg);
    font-size: 12px;
    font-family: inherit;
    color: var(--color-text-primary);
    outline: none;
    box-sizing: border-box;
  }
  .tp-save-btns {
    display: flex;
    gap: 6px;
  }
  .tp-save-confirm {
    flex: 1;
    padding: 6px;
    border-radius: 6px;
    border: none;
    background: var(--color-primary-brand);
    color: white;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
  .tp-save-confirm:hover {
    background: var(--color-primary-brand-hover);
  }
  .tp-save-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .tp-save-cancel {
    flex: 1;
    padding: 6px;
    border-radius: 6px;
    border: 1px solid var(--color-border-custom);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
  .tp-save-cancel:hover {
    background: var(--color-hover-bg);
  }
`
