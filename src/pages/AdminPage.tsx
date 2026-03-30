import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, ArrowLeft, ClipboardCheck, Package, Link2, Users } from 'lucide-react'
import { useAuthStore } from '@/stores/useAuthStore'
import PendingApprovalQueue from '@/components/admin/PendingApprovalQueue'
import CatalogOverview from '@/components/admin/CatalogOverview'
import LinkHealthOverview from '@/components/admin/LinkHealthOverview'
import TeamManagement from '@/components/admin/TeamManagement'

type AdminTab = 'pending' | 'catalog' | 'link-health' | 'team'

const TABS: { value: AdminTab; label: string; icon: React.ReactNode }[] = [
  { value: 'pending', label: 'Pending', icon: <ClipboardCheck size={15} /> },
  { value: 'catalog', label: 'Catalog', icon: <Package size={15} /> },
  { value: 'link-health', label: 'Link Health', icon: <Link2 size={15} /> },
  { value: 'team', label: 'Team', icon: <Users size={15} /> },
]

export default function AdminPage() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const [activeTab, setActiveTab] = useState<AdminTab>('pending')

  return (
    <div className="admin-page">
      {/* Header */}
      <header className="admin-header">
        <div className="header-left">
          <button className="header-back-btn" onClick={() => navigate('/')} title="Back to Dashboard">
            <ArrowLeft size={16} />
          </button>
          <div className="header-logo-icon">
            <Boxes size={18} strokeWidth={1.8} />
          </div>
          <span className="header-logo-text">LEANOVATE</span>
          <span className="header-admin-badge">ADMIN</span>
        </div>
        <div className="header-right">
          <span className="header-user-name">{profile?.display_name}</span>
        </div>
      </header>

      {/* Tab navigation */}
      <div className="admin-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            className={`admin-tab ${activeTab === tab.value ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <main className="admin-content">
        {activeTab === 'pending' && <PendingApprovalQueue />}
        {activeTab === 'catalog' && <CatalogOverview />}
        {activeTab === 'link-health' && <LinkHealthOverview />}
        {activeTab === 'team' && <TeamManagement />}
      </main>

      <style>{`
        .admin-page {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          background: var(--color-canvas-bg);
        }
        .admin-header {
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
        .header-back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: none;
          background: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all 0.15s;
        }
        .header-back-btn:hover {
          background: var(--color-hover-bg);
          color: var(--color-text-primary);
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
        .header-admin-badge {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          background: var(--color-secondary);
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
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
        .admin-tabs {
          display: flex;
          gap: 0;
          padding: 0 24px;
          background: var(--color-panel-bg);
          border-bottom: 1px solid var(--color-border-custom);
        }
        .admin-tab {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 12px 16px;
          border: none;
          background: none;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          color: var(--color-text-secondary);
          border-bottom: 2px solid transparent;
          transition: all 0.15s;
        }
        .admin-tab:hover {
          color: var(--color-text-primary);
        }
        .admin-tab.active {
          color: var(--color-primary-brand);
          border-bottom-color: var(--color-primary-brand);
        }
        .admin-content {
          flex: 1;
          max-width: 1000px;
          width: 100%;
          margin: 0 auto;
          padding: 24px;
        }

        /* Color variables that may be needed */
        .header-admin-badge {
          --color-secondary: #F2735A;
          background: #F2735A;
        }
      `}</style>
    </div>
  )
}
