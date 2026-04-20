import { useCanvasStore } from '@/stores/useCanvasStore'
import type { RoomRotation } from '@/lib/roomGeometry'

const ROTATIONS: { dir: RoomRotation; label: string }[] = [
  { dir: 'front_left', label: 'NW' },
  { dir: 'front_right', label: 'NE' },
  { dir: 'back_right', label: 'SE' },
  { dir: 'back_left', label: 'SW' },
]

export default function RotationControls() {
  const roomRotation = useCanvasStore((s) => s.roomRotation)
  const setRoomRotation = useCanvasStore((s) => s.setRoomRotation)

  return (
    <div className="rotation-controls">
      {ROTATIONS.map(({ dir, label }) => (
        <button
          key={dir}
          className={`rotation-btn ${roomRotation === dir ? 'active' : ''}`}
          onClick={() => setRoomRotation(dir)}
          title={`View from ${label}`}
        >
          {label}
        </button>
      ))}

      <style>{`
        .rotation-controls {
          position: absolute;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 2px;
          padding: 4px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(8px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          z-index: 10;
        }
        .rotation-btn {
          width: 36px;
          height: 32px;
          border-radius: 7px;
          border: none;
          background: transparent;
          color: var(--color-text-secondary);
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rotation-btn:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }
        .rotation-btn.active {
          background: var(--color-primary-brand);
          color: white;
        }
      `}</style>
    </div>
  )
}
