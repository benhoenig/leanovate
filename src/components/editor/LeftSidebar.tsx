import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Upload, LayoutDashboard, Palette, Package, DoorOpen, Layers } from 'lucide-react'
import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore } from '@/stores/useUIStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { supabase, rawStorageUpload } from '@/lib/supabase'
import type { FinishType } from '@/types'
import CatalogPanel from './CatalogPanel'
import FixturePickerPanel from './FixturePickerPanel'
import TemplatePanel from './TemplatePanel'

// Door + window finishes were dropped — those are placed fixtures now.
// Lighting is deferred (backlog): hide from the picker but keep the type
// available so a future ceiling-light UI can slot back in without a schema
// change.
const FINISH_TYPES: FinishType[] = ['wall', 'floor']

export default function LeftSidebar() {
  const { t } = useTranslation()
  const { rooms, selectedRoomId, currentProject, finishMaterials, setSelectedRoom, addRoom, deleteRoom, updateRoom, loadFinishMaterials } = useProjectStore()
  const { sidebarTab, setSidebarTab } = useUIStore()
  const { user } = useAuthStore()
  const { showToast } = useUIStore()

  const [addingRoom, setAddingRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null

  const handleAddRoom = async () => {
    if (!newRoomName.trim() || !currentProject) return
    const { error } = await addRoom(currentProject.id, newRoomName.trim())
    if (error) showToast(error, 'error')
    setNewRoomName('')
    setAddingRoom(false)
  }

  const handleDeleteRoom = async (id: string) => {
    if (deletingId === id) {
      await deleteRoom(id)
      setDeletingId(null)
    } else {
      setDeletingId(id)
      setTimeout(() => setDeletingId(null), 2500)
    }
  }

  const handleFinishSelect = (type: FinishType, materialId: string) => {
    if (!selectedRoom) return
    const currentFinishes = selectedRoom.finishes ?? {}
    const updated = {
      ...currentFinishes,
      [type]: { material_id: materialId, custom_url: null },
    }
    updateRoom(selectedRoom.id, { finishes: updated })
  }

  const handleCustomUpload = async (type: FinishType, file: File) => {
    if (!user) return
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { publicUrl, error: uploadError } = await rawStorageUpload('textures', path, file, { contentType: file.type })
    if (uploadError || !publicUrl) {
      showToast(t('editor.finishes.uploadFailed'), 'error')
      return
    }
    // For wall/floor uploads, also wire the image as a tileable texture
    // (default 200cm repeat — designer can't override this in v1; if tiling
    // looks off they re-upload a differently-cropped image). Doors, windows,
    // and lighting uploads keep texture_url null — those surfaces render as
    // flat color for now.
    const isTileableType = type === 'wall' || type === 'floor'
    const { data: matData, error: insertError } = await supabase
      .from('finish_materials')
      .insert({
        type,
        name: file.name,
        thumbnail_path: publicUrl,
        texture_url: isTileableType ? publicUrl : null,
        tile_size_cm: isTileableType ? 200 : null,
        is_custom: true,
        uploaded_by: user.id,
      })
      .select()
      .single()
    if (insertError) {
      showToast(t('editor.finishes.saveFailed'), 'error')
      return
    }
    await loadFinishMaterials()
    if (selectedRoom) {
      handleFinishSelect(type, (matData as { id: string }).id)
    }
    showToast(t('editor.finishes.customUploaded'), 'success')
  }

  return (
    <div className="left-sidebar">
      {/* Tab Switcher */}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${sidebarTab === 'rooms' ? 'active' : ''}`}
          onClick={() => setSidebarTab('rooms')}
          title={t('editor.sidebar.rooms')}
          aria-label={t('editor.sidebar.rooms')}
        >
          <LayoutDashboard size={16} />
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'finishes' ? 'active' : ''}`}
          onClick={() => setSidebarTab('finishes')}
          title={t('editor.sidebar.finishes')}
          aria-label={t('editor.sidebar.finishes')}
        >
          <Palette size={16} />
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'catalog' ? 'active' : ''}`}
          onClick={() => setSidebarTab('catalog')}
          title={t('editor.sidebar.catalog')}
          aria-label={t('editor.sidebar.catalog')}
        >
          <Package size={16} />
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'fixtures' ? 'active' : ''}`}
          onClick={() => setSidebarTab('fixtures')}
          title={t('editor.sidebar.fixtures')}
          aria-label={t('editor.sidebar.fixtures')}
        >
          <DoorOpen size={16} />
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'templates' ? 'active' : ''}`}
          onClick={() => setSidebarTab('templates')}
          title={t('editor.sidebar.templates')}
          aria-label={t('editor.sidebar.templates')}
        >
          <Layers size={16} />
        </button>
      </div>

      {/* Current tab title — replaces the text we lost when tabs became icons */}
      <div className="sidebar-title-bar">
        {t(`editor.sidebar.${sidebarTab}`)}
      </div>

      {/* Rooms Tab */}
      {sidebarTab === 'rooms' && (
        <div className="sidebar-section">
          <div className="section-header section-header--end">
            <button className="icon-btn" onClick={() => setAddingRoom(true)} title={t('editor.rooms.addRoom')}>
              <Plus size={14} />
            </button>
          </div>

          <div className="room-list">
            {rooms.map((room) => (
              <div
                key={room.id}
                className={`room-item ${room.id === selectedRoomId ? 'selected' : ''}`}
                onClick={() => setSelectedRoom(room.id)}
              >
                <div className="room-item-info">
                  <span className="room-item-name">{room.name}</span>
                  <span className="room-item-dims">{room.width_cm} × {room.height_cm} cm</span>
                </div>
                <button
                  className={`room-delete-btn ${deletingId === room.id ? 'confirm' : ''}`}
                  onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room.id) }}
                  title={deletingId === room.id ? t('editor.rooms.confirmDelete') : t('editor.rooms.deleteRoom')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}

            {addingRoom && (
              <div className="add-room-input-row">
                <input
                  className="add-room-input"
                  autoFocus
                  placeholder={t('editor.rooms.roomNamePlaceholder')}
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddRoom()
                    if (e.key === 'Escape') { setAddingRoom(false); setNewRoomName('') }
                  }}
                />
                <button className="icon-btn accent" onClick={handleAddRoom}>
                  <Plus size={13} />
                </button>
              </div>
            )}

            {rooms.length === 0 && !addingRoom && (
              <button className="add-first-room-btn" onClick={() => setAddingRoom(true)}>
                <Plus size={14} />
                {t('editor.rooms.addFirstRoom')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Catalog Tab */}
      {sidebarTab === 'catalog' && <CatalogPanel />}

      {/* Fixtures Tab (doors, windows — wall-mount catalog) */}
      {sidebarTab === 'fixtures' && <FixturePickerPanel />}

      {/* Templates Tab */}
      {sidebarTab === 'templates' && <TemplatePanel />}

      {/* Finishes Tab */}
      {sidebarTab === 'finishes' && (
        <div className="sidebar-section finishes-section">
          {!selectedRoom && (
            <p className="no-room-hint">{t('editor.finishes.selectRoomFirst')}</p>
          )}

          {selectedRoom && FINISH_TYPES.map((type) => {
            const materials = finishMaterials.filter((m) => m.type === type)
            const selectedId = selectedRoom.finishes?.[type]?.material_id
            const label = t(`editor.finishes.${type}`)
            const typeLabel = t(`editor.finishes.${type}`).toLowerCase()

            // Split materials into two visual groups. Textures cover the
            // "real material" case (wood, tile, brick) and plain colors
            // cover "painted/epoxy finish". Designers pick either.
            const colors = materials.filter((m) => m.thumbnail_path.startsWith('#'))
            const textures = materials.filter((m) => !m.thumbnail_path.startsWith('#'))

            const renderSwatch = (mat: typeof materials[number]) => {
              const isSelected = mat.id === selectedId
              const isColor = mat.thumbnail_path.startsWith('#')
              const swatchStyle = isColor
                ? { background: mat.thumbnail_path }
                : {
                    backgroundImage: `url(${mat.thumbnail_path})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
              return (
                <button
                  key={mat.id}
                  className={`finish-swatch ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleFinishSelect(type, mat.id)}
                  title={mat.name}
                  style={swatchStyle}
                />
              )
            }

            return (
              <div key={type} className="finish-group">
                <div className="finish-group-header">
                  <span className="section-title">{label}</span>
                  <label className="upload-label" title={t('editor.finishes.uploadCustom', { type: typeLabel })}>
                    <Upload size={12} />
                    <input
                      ref={(el) => { fileInputRefs.current[type] = el }}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleCustomUpload(type, file)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>

                {colors.length > 0 && (
                  <div className="finish-subgroup">
                    <span className="finish-subgroup-label">{t('editor.finishes.colors')}</span>
                    <div className="finish-swatches">{colors.map(renderSwatch)}</div>
                  </div>
                )}

                {textures.length > 0 && (
                  <div className="finish-subgroup">
                    <span className="finish-subgroup-label">{t('editor.finishes.textures')}</span>
                    <div className="finish-swatches">{textures.map(renderSwatch)}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        .left-sidebar {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .sidebar-tabs {
          display: flex;
          border-bottom: 1px solid var(--color-border-custom);
          flex-shrink: 0;
        }

        .sidebar-tab {
          flex: 1;
          padding: 10px;
          background: none;
          border: none;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          color: var(--color-text-secondary);
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sidebar-tab.active {
          color: var(--color-primary-brand);
          border-bottom-color: var(--color-primary-brand);
        }

        .sidebar-title-bar {
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: var(--color-text-primary);
          background: var(--color-panel-bg);
          border-bottom: 1px solid var(--color-border-custom);
          flex-shrink: 0;
        }

        .sidebar-section {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .section-header--end {
          justify-content: flex-end;
        }

        .section-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .icon-btn {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 5px;
          display: flex;
          align-items: center;
        }

        .icon-btn:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }

        .icon-btn.accent {
          background: var(--color-primary-brand);
          color: white;
          border-radius: 5px;
          padding: 4px 6px;
        }

        .room-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .room-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s;
        }

        .room-item:hover {
          background: var(--color-hover-bg);
        }

        .room-item.selected {
          background: var(--color-primary-brand-light);
          border-color: var(--color-primary-brand);
        }

        .room-item-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .room-item-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .room-item-dims {
          font-size: 10px;
          color: var(--color-text-secondary);
        }

        .room-delete-btn {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 5px;
          opacity: 0;
          display: flex;
          align-items: center;
          transition: all 0.15s;
          flex-shrink: 0;
        }

        .room-item:hover .room-delete-btn {
          opacity: 1;
        }

        .room-delete-btn:hover {
          color: var(--color-error);
          background: rgba(229, 77, 66, 0.08);
        }

        .room-delete-btn.confirm {
          opacity: 1;
          color: var(--color-error);
          background: rgba(229, 77, 66, 0.08);
        }

        .add-room-input-row {
          display: flex;
          gap: 6px;
          align-items: center;
          padding: 4px 0;
        }

        .add-room-input {
          flex: 1;
          padding: 6px 8px;
          border: 1px solid var(--color-primary-brand);
          border-radius: 6px;
          background: var(--color-input-bg);
          font-size: 12px;
          font-family: inherit;
          color: var(--color-text-primary);
          outline: none;
        }

        .add-first-room-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px;
          border-radius: 8px;
          border: 1.5px dashed var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          margin-top: 4px;
        }

        .add-first-room-btn:hover {
          background: rgba(43, 168, 160, 0.12);
        }

        .finishes-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding-top: 14px;
        }

        .no-room-hint {
          font-size: 12px;
          color: var(--color-text-secondary);
          text-align: center;
          padding: 20px 0;
        }

        .finish-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .finish-group-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .upload-label {
          display: flex;
          align-items: center;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          border-radius: 5px;
        }

        .upload-label:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }

        .finish-swatches {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .finish-swatch {
          width: 28px;
          height: 28px;
          border-radius: 7px;
          border: 2px solid var(--color-border-custom);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
          background: var(--color-hover-bg);
          flex-shrink: 0;
        }

        .finish-swatch:hover {
          transform: scale(1.08);
        }

        .finish-swatch.selected {
          border-color: var(--color-primary-brand);
          box-shadow: 0 0 0 1.5px var(--color-primary-brand);
        }

        .swatch-label {
          font-size: 8px;
          font-weight: 700;
          color: var(--color-text-secondary);
          text-transform: uppercase;
        }
      `}</style>
    </div>
  )
}
