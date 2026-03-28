import { useAuthStore } from '@/stores/useAuthStore'
import { useNavigate } from 'react-router-dom'
import { Boxes, Plus, LogOut, FolderOpen } from 'lucide-react'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuthStore()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="dashboard-page">
      {/* Top Bar */}
      <header className="dashboard-header">
        <div className="header-left">
          <div className="header-logo-icon">
            <Boxes size={18} strokeWidth={1.8} />
          </div>
          <span className="header-logo-text">LEANOVATE</span>
        </div>
        <div className="header-right">
          <span className="header-user-name">{profile?.display_name}</span>
          <span className="header-user-role">{profile?.role}</span>
          <button className="header-sign-out" onClick={handleSignOut} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="dashboard-content">
        <div className="dashboard-title-row">
          <h1 className="dashboard-title">My Projects</h1>
          <button className="new-project-btn">
            <Plus size={16} />
            New Project
          </button>
        </div>

        {/* Empty State */}
        <div className="dashboard-empty">
          <div className="empty-icon">
            <FolderOpen size={48} strokeWidth={1.2} />
          </div>
          <h2 className="empty-title">No projects yet</h2>
          <p className="empty-description">
            Create your first project to start designing a condo unit.
          </p>
          <button className="empty-cta">
            <Plus size={16} />
            Create First Project
          </button>
        </div>
      </main>

      <style>{`
        .dashboard-page {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          background: var(--color-canvas-bg);
        }

        .dashboard-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 var(--space-xl);
          height: 52px;
          background: var(--color-panel-bg);
          border-bottom: 1px solid var(--color-border-custom);
          box-shadow: var(--shadow-sm);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .header-logo-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .header-logo-text {
          font-size: 15px;
          font-weight: 700;
          color: var(--color-text-primary);
          letter-spacing: 1.5px;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .header-user-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .header-user-role {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          background: var(--color-primary-brand);
          color: white;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .header-sign-out {
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
        }

        .header-sign-out:hover {
          background: var(--color-hover-bg);
          color: var(--color-error);
        }

        .dashboard-content {
          flex: 1;
          max-width: 900px;
          width: 100%;
          margin: 0 auto;
          padding: 32px 24px;
        }

        .dashboard-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
        }

        .dashboard-title {
          font-size: 22px;
          font-weight: 700;
          color: var(--color-text-primary);
        }

        .new-project-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 8px;
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          color: white;
          font-size: 12px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          font-family: inherit;
        }

        .new-project-btn:hover {
          filter: brightness(1.05);
          box-shadow: 0 2px 8px rgba(43, 168, 160, 0.3);
        }

        .dashboard-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 400px;
          text-align: center;
        }

        .empty-icon {
          width: 80px;
          height: 80px;
          border-radius: 20px;
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }

        .empty-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--color-text-primary);
          margin-bottom: 8px;
        }

        .empty-description {
          font-size: 13px;
          color: var(--color-text-secondary);
          max-width: 280px;
          margin-bottom: 20px;
        }

        .empty-cta {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 20px;
          border-radius: 10px;
          border: 1.5px dashed var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }

        .empty-cta:hover {
          background: rgba(43, 168, 160, 0.12);
        }
      `}</style>
    </div>
  )
}
