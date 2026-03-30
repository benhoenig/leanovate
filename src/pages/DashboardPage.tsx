import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, Plus, LogOut, FolderOpen, ExternalLink, Shield } from 'lucide-react'
import { useAuthStore } from '@/stores/useAuthStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useUIStore } from '@/stores/useUIStore'
import NewProjectModal from '@/components/NewProjectModal'
import type { Project } from '@/types'

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const statusColors: Record<string, string> = {
    draft: 'var(--color-text-secondary)',
    completed: 'var(--color-success)',
  }

  const formattedDate = new Date(project.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="project-card">
      <div className="project-card-body">
        <div className="project-card-top">
          <span
            className="project-status-dot"
            style={{ background: statusColors[project.status] ?? 'var(--color-text-secondary)' }}
          />
          <span className="project-status-label">{project.status}</span>
        </div>
        <h3 className="project-name">{project.name}</h3>
        {project.description && <p className="project-description">{project.description}</p>}
        <p className="project-date">{formattedDate}</p>
      </div>
      <div className="project-card-footer">
        <button className="project-open-btn" onClick={onOpen}>
          <ExternalLink size={13} />
          Open
        </button>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { profile, signOut } = useAuthStore()
  const { projects, isLoading, loadProjects } = useProjectStore()
  const { activeModal, openModal } = useUIStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const handleNewProject = () => openModal('new-project')

  return (
    <div className="dashboard-page">
      {/* Modal */}
      {activeModal === 'new-project' && <NewProjectModal />}

      {/* Top Bar */}
      <header className="dashboard-header">
        <div className="header-left">
          <div className="header-logo-icon">
            <Boxes size={18} strokeWidth={1.8} />
          </div>
          <span className="header-logo-text">LEANOVATE</span>
        </div>
        <div className="header-right">
          {profile?.role === 'admin' && (
            <button className="header-admin-btn" onClick={() => navigate('/admin')} title="Admin Dashboard">
              <Shield size={14} />
              Admin
            </button>
          )}
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
          <button className="new-project-btn" onClick={handleNewProject}>
            <Plus size={16} />
            New Project
          </button>
        </div>

        {isLoading ? (
          <div className="dashboard-loading">
            <p className="loading-hint">Loading projects…</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="dashboard-empty">
            <div className="empty-icon">
              <FolderOpen size={48} strokeWidth={1.2} />
            </div>
            <h2 className="empty-title">No projects yet</h2>
            <p className="empty-description">
              Create your first project to start designing a condo unit.
            </p>
            <button className="empty-cta" onClick={handleNewProject}>
              <Plus size={16} />
              Create First Project
            </button>
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => navigate(`/editor/${project.id}`)}
              />
            ))}
          </div>
        )}
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

        .header-admin-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          border-radius: 6px;
          border: 1.5px solid #F2735A;
          background: none;
          color: #F2735A;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }

        .header-admin-btn:hover {
          background: #F2735A;
          color: white;
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
          max-width: 960px;
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

        .dashboard-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 300px;
        }

        .loading-hint {
          font-size: 13px;
          color: var(--color-text-secondary);
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

        .projects-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
        }

        .project-card {
          background: var(--color-panel-bg);
          border: 1px solid var(--color-border-custom);
          border-radius: 10px;
          display: flex;
          flex-direction: column;
          transition: box-shadow 0.15s, border-color 0.15s;
        }

        .project-card:hover {
          box-shadow: var(--shadow-md);
          border-color: var(--color-primary-brand);
        }

        .project-card-body {
          padding: 14px;
          flex: 1;
        }

        .project-card-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
        }

        .project-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .project-status-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-secondary);
        }

        .project-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
          margin-bottom: 4px;
          line-height: 1.3;
        }

        .project-description {
          font-size: 11px;
          color: var(--color-text-secondary);
          margin-bottom: 6px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .project-date {
          font-size: 10px;
          color: var(--color-text-secondary);
          opacity: 0.7;
        }

        .project-card-footer {
          padding: 10px 14px;
          border-top: 1px solid var(--color-border-custom);
          display: flex;
          justify-content: flex-end;
        }

        .project-open-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          border-radius: 6px;
          background: none;
          border: 1.5px solid var(--color-primary-brand);
          color: var(--color-primary-brand);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }

        .project-open-btn:hover {
          background: var(--color-primary-brand);
          color: white;
        }
      `}</style>
    </div>
  )
}
