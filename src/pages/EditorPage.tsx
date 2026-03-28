import { useParams, useNavigate } from 'react-router-dom'
import { Boxes, ArrowLeft, Save } from 'lucide-react'

export default function EditorPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()

  return (
    <div className="editor-page">
      {/* Editor Top Bar */}
      <header className="editor-header">
        <div className="editor-header-left">
          <button className="editor-back-btn" onClick={() => navigate('/')}>
            <ArrowLeft size={16} />
          </button>
          <div className="header-logo-icon-small">
            <Boxes size={14} strokeWidth={1.8} />
          </div>
          <span className="editor-project-name">Untitled Project</span>
        </div>
        <div className="editor-header-right">
          <button className="editor-save-btn">
            <Save size={14} />
            Save
          </button>
        </div>
      </header>

      {/* Editor Body */}
      <div className="editor-body">
        {/* Left Sidebar */}
        <aside className="editor-sidebar-left">
          <div className="sidebar-placeholder">
            <p className="placeholder-text">Left Sidebar</p>
            <p className="placeholder-hint">Rooms • Catalog • Templates</p>
          </div>
        </aside>

        {/* Canvas Area */}
        <main className="editor-canvas">
          <div className="canvas-placeholder">
            <div className="canvas-grid-icon">
              <Boxes size={36} strokeWidth={1} />
            </div>
            <p className="canvas-placeholder-text">Isometric Canvas</p>
            <p className="canvas-placeholder-hint">
              Project: {projectId?.slice(0, 8)}...
            </p>
          </div>
        </main>

        {/* Right Panel */}
        <aside className="editor-sidebar-right">
          <div className="sidebar-placeholder">
            <p className="placeholder-text">Right Panel</p>
            <p className="placeholder-hint">Properties • Cost</p>
          </div>
        </aside>
      </div>

      <style>{`
        .editor-page {
          height: 100dvh;
          display: flex;
          flex-direction: column;
          background: var(--color-canvas-bg);
          overflow: hidden;
        }

        .editor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          height: 44px;
          background: var(--color-panel-bg);
          border-bottom: 1px solid var(--color-border-custom);
          box-shadow: var(--shadow-sm);
          flex-shrink: 0;
        }

        .editor-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .editor-back-btn {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
        }

        .editor-back-btn:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
        }

        .header-logo-icon-small {
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .editor-project-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .editor-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .editor-save-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 14px;
          border-radius: 7px;
          background: var(--color-primary-brand);
          color: white;
          font-size: 12px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          font-family: inherit;
        }

        .editor-save-btn:hover {
          background: var(--color-primary-brand-hover);
        }

        .editor-body {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        .editor-sidebar-left {
          width: 280px;
          background: var(--color-panel-bg);
          border-right: 1px solid var(--color-border-custom);
          flex-shrink: 0;
          overflow-y: auto;
        }

        .editor-sidebar-right {
          width: 260px;
          background: var(--color-panel-bg);
          border-left: 1px solid var(--color-border-custom);
          flex-shrink: 0;
          overflow-y: auto;
        }

        .editor-canvas {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-canvas-bg);
        }

        .sidebar-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
          padding: 20px;
        }

        .placeholder-text {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-secondary);
        }

        .placeholder-hint {
          font-size: 11px;
          color: var(--color-text-secondary);
          opacity: 0.6;
          margin-top: 4px;
        }

        .canvas-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: var(--color-text-secondary);
          opacity: 0.5;
        }

        .canvas-grid-icon {
          width: 72px;
          height: 72px;
          border-radius: 18px;
          background: var(--color-hover-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 4px;
        }

        .canvas-placeholder-text {
          font-size: 15px;
          font-weight: 600;
        }

        .canvas-placeholder-hint {
          font-size: 11px;
        }
      `}</style>
    </div>
  )
}
