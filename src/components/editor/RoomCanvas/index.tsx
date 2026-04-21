/**
 * 3D room canvas — Three.js scene.
 *
 * This file is the composition root: it owns only the JSX shell (container
 * div, floating controls) and wires up the domain hooks that do the actual
 * work. See `./hooks/` for each concern:
 *
 *   - useThreeScene         renderer, camera, OrbitControls, render loop
 *   - useRoomShell          floor/walls/ceiling (rebuilt per change)
 *   - useRoomLighting       studio rig + ceiling fixture (persistent, mutable)
 *   - useFurnitureLayer     placed furniture ↔ scene graph sync
 *   - useSelectionRing      selection ring + per-frame follow
 *   - usePlacementGhosts    furniture + fixture placement ghosts
 *   - useShapeHandles       vertex + midpoint handles in Edit Shape mode
 *   - useCameraMode         design ↔ roam camera switching
 *   - useCanvasInteractions pointer / wheel / keyboard dispatcher
 */

import { useTranslation } from 'react-i18next'
import { useCanvasStore } from '@/stores/useCanvasStore'
import { useUIStore } from '@/stores/useUIStore'
import type { Room, FinishMaterial } from '@/types'
import { useThreeScene } from './hooks/useThreeScene'
import { useRoomShell } from './hooks/useRoomShell'
import { useRoomLighting } from './hooks/useRoomLighting'
import { useFurnitureLayer } from './hooks/useFurnitureLayer'
import { useSelectionRing } from './hooks/useSelectionRing'
import { usePlacementGhosts } from './hooks/usePlacementGhosts'
import { useShapeHandles } from './hooks/useShapeHandles'
import { useCameraMode } from './hooks/useCameraMode'
import { useCanvasInteractions } from './hooks/useCanvasInteractions'
import { canvasStyle } from './styles'

interface Props {
  room: Room
  finishMaterials: FinishMaterial[]
}

export default function RoomCanvas({ room, finishMaterials }: Props) {
  const { t } = useTranslation()

  const ctx = useThreeScene(room)
  useRoomShell(ctx, room, finishMaterials)
  useRoomLighting(ctx, room, finishMaterials)
  useFurnitureLayer(ctx)
  useSelectionRing(ctx)
  const ghostRefs = usePlacementGhosts(ctx, room.id)
  useShapeHandles(ctx, room)
  useCameraMode(ctx, room)
  useCanvasInteractions(ctx, room, ghostRefs)

  const placementMode = useCanvasStore((s) => s.placementMode)
  const gridOn = useUIStore((s) => s.canvasGrid)
  const setCanvasGrid = useUIStore((s) => s.setCanvasGrid)
  const cameraMode = useUIStore((s) => s.cameraMode)
  const setCameraMode = useUIStore((s) => s.setCameraMode)

  const { containerRef, dimLabelsRef, roamControlsRef } = ctx

  const enterRoam = () => {
    setCameraMode('roam')
    // Lock on the next frame so the click event has finished propagating
    requestAnimationFrame(() => roamControlsRef.current?.lock())
  }

  return (
    <div
      ref={containerRef}
      className={`room-canvas ${placementMode ? 'placement-mode' : ''} ${cameraMode === 'roam' ? 'roam-mode' : ''}`}
    >
      {/* Edit-shape wall length labels (populated imperatively in the animate loop). */}
      <div ref={dimLabelsRef} className="wall-dim-labels-layer" />

      {/* Grid toggle */}
      <button
        type="button"
        className={`canvas-toggle-btn grid-toggle-btn ${gridOn ? 'active' : ''}`}
        onClick={() => setCanvasGrid(!gridOn)}
        title={gridOn ? t('editor.canvas.hideWorldGrid') : t('editor.canvas.showWorldGrid')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M0.5 4.5h13M0.5 9.5h13M4.5 0.5v13M9.5 0.5v13" />
        </svg>
        {t('editor.canvas.gridLabel')}
      </button>

      {/* Camera mode toggle */}
      <button
        type="button"
        className={`canvas-toggle-btn mode-toggle-btn ${cameraMode === 'roam' ? 'active' : ''}`}
        onClick={() => cameraMode === 'design' ? enterRoam() : setCameraMode('design')}
        title={cameraMode === 'roam' ? t('editor.canvas.backToDesign') : t('editor.canvas.enterRoam')}
      >
        {cameraMode === 'roam' ? `🎨 ${t('editor.canvas.cameraDesign')}` : `🚶 ${t('editor.canvas.cameraRoam')}`}
      </button>

      {/* Roam-mode hint */}
      {cameraMode === 'roam' && (
        <div className="roam-hint">
          <strong>WASD</strong> {t('editor.canvas.roamHintMove')} · <strong>Shift</strong> {t('editor.canvas.roamHintSprint')} · <strong>Mouse</strong> {t('editor.canvas.roamHintLook')} · <strong>Esc</strong> {t('editor.canvas.roamHintExit')}
        </div>
      )}

      <style>{canvasStyle}</style>
    </div>
  )
}
