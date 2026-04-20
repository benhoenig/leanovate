import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUIStore } from '@/stores/useUIStore'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import EditorPage from '@/pages/EditorPage'
import AdminPage from '@/pages/AdminPage'
import { Boxes, X } from 'lucide-react'

// Auth-protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isInitialized } = useAuthStore()
  const { t } = useTranslation()

  if (!isInitialized || isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-icon">
          <Boxes size={28} strokeWidth={1.8} />
        </div>
        <p className="loading-text">{t('common.loading')}</p>
        <style>{`
          .loading-screen {
            min-height: 100dvh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: var(--color-canvas-bg);
            gap: 12px;
          }
          .loading-icon {
            width: 56px;
            height: 56px;
            border-radius: 14px;
            background: linear-gradient(135deg, #2BA8A0, #238C85);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: pulse 1.5s infinite;
          }
          .loading-text {
            font-size: 13px;
            color: var(--color-text-secondary);
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(0.95); }
          }
        `}</style>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

// Admin-only route wrapper
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { profile } = useAuthStore()
  if (profile?.role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

// Redirect if already logged in
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isInitialized } = useAuthStore()

  if (!isInitialized || isLoading) return null

  if (user) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function Toast() {
  const { toast, clearToast } = useUIStore()
  if (!toast) return null

  const bgColor =
    toast.type === 'error' ? '#E54D42' :
    toast.type === 'warning' ? '#F5A623' :
    '#4CAF82'

  return (
    <div style={{
      position: 'fixed',
      top: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9999,
      background: bgColor,
      color: 'white',
      padding: '10px 16px 10px 14px',
      borderRadius: 10,
      boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13,
      fontWeight: 600,
      maxWidth: 400,
    }}>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={clearToast}
        style={{
          background: 'none', border: 'none', color: 'white',
          cursor: 'pointer', padding: 2, display: 'flex', opacity: 0.8,
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <BrowserRouter>
      <Toast />
      <Routes>
        <Route
          path="/login"
          element={
            <AuthRoute>
              <LoginPage />
            </AuthRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/editor/:projectId"
          element={
            <ProtectedRoute>
              <EditorPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
