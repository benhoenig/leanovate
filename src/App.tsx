import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/useAuthStore'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import EditorPage from '@/pages/EditorPage'
import { Boxes } from 'lucide-react'

// Auth-protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isInitialized } = useAuthStore()

  if (!isInitialized || isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-icon">
          <Boxes size={28} strokeWidth={1.8} />
        </div>
        <p className="loading-text">Loading...</p>
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

// Redirect if already logged in
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isInitialized } = useAuthStore()

  if (!isInitialized || isLoading) return null

  if (user) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <BrowserRouter>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
