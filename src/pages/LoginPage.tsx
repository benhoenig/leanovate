import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/useAuthStore'
import { Boxes, Eye, EyeOff } from 'lucide-react'
import LanguageToggle from '@/components/LanguageToggle'

export default function LoginPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { signIn, signUp, isLoading } = useAuthStore()

  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (isSignUp) {
      if (!displayName.trim()) {
        setError(t('auth.errorNameRequired'))
        return
      }
      const result = await signUp(email, password, displayName)
      if (result.error) {
        setError(result.error)
      } else {
        navigate('/')
      }
    } else {
      const result = await signIn(email, password)
      if (result.error) {
        setError(result.error)
      } else {
        navigate('/')
      }
    }
  }

  return (
    <div className="login-page">
      <div className="login-lang-toggle">
        <LanguageToggle />
      </div>
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">
            <Boxes size={28} strokeWidth={1.8} />
          </div>
          <h1 className="login-title">{t('auth.appName')}</h1>
          <p className="login-subtitle">{t('auth.tagline')}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          {isSignUp && (
            <div className="form-group">
              <label htmlFor="displayName">{t('auth.nameLabel')}</label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('auth.namePlaceholder')}
                autoComplete="name"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">{t('auth.emailLabel')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t('auth.passwordLabel')}</label>
            <div className="password-input-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            type="submit"
            className="login-submit"
            disabled={isLoading}
          >
            {isLoading ? t('auth.loadingButton') : isSignUp ? t('auth.signUpButton') : t('auth.signInButton')}
          </button>
        </form>

        {/* Toggle */}
        <div className="login-toggle">
          <span>
            {isSignUp ? t('auth.haveAccount') : t('auth.noAccount')}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp)
              setError(null)
            }}
          >
            {isSignUp ? t('auth.switchToSignIn') : t('auth.switchToSignUp')}
          </button>
        </div>
      </div>

      <style>{`
        .login-page {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-canvas-bg);
          padding: 20px;
          position: relative;
        }

        .login-lang-toggle {
          position: absolute;
          top: 20px;
          right: 20px;
        }

        .login-card {
          width: 100%;
          max-width: 380px;
          background: var(--color-panel-bg);
          border-radius: 16px;
          padding: 40px 32px;
          box-shadow: var(--shadow-lg);
          border: 1px solid var(--color-border-custom);
        }

        .login-logo {
          text-align: center;
          margin-bottom: 32px;
        }

        .login-logo-icon {
          width: 56px;
          height: 56px;
          border-radius: 14px;
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
        }

        .login-title {
          font-size: 20px;
          font-weight: 700;
          color: var(--color-text-primary);
          letter-spacing: 2px;
          margin: 0;
        }

        .login-subtitle {
          font-size: 12px;
          color: var(--color-text-secondary);
          margin-top: 4px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .form-group input {
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--color-border-custom);
          background: var(--color-input-bg);
          font-size: 13px;
          color: var(--color-text-primary);
          outline: none;
          font-family: inherit;
          width: 100%;
        }

        .form-group input:focus {
          border-color: var(--color-primary-brand);
          box-shadow: 0 0 0 3px rgba(43, 168, 160, 0.12);
        }

        .form-group input::placeholder {
          color: var(--color-text-secondary);
        }

        .password-input-wrapper {
          position: relative;
        }

        .password-toggle {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
        }

        .password-toggle:hover {
          color: var(--color-text-primary);
        }

        .login-error {
          font-size: 12px;
          color: var(--color-error);
          background: rgba(229, 77, 66, 0.08);
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid rgba(229, 77, 66, 0.2);
        }

        .login-submit {
          padding: 10px 16px;
          border-radius: 8px;
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          color: white;
          font-size: 13px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          font-family: inherit;
          margin-top: 4px;
        }

        .login-submit:hover:not(:disabled) {
          filter: brightness(1.05);
          box-shadow: 0 2px 8px rgba(43, 168, 160, 0.3);
        }

        .login-submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .login-toggle {
          text-align: center;
          margin-top: 20px;
          font-size: 12px;
          color: var(--color-text-secondary);
        }

        .login-toggle button {
          background: none;
          border: none;
          color: var(--color-primary-brand);
          font-weight: 600;
          cursor: pointer;
          font-size: 12px;
          font-family: inherit;
          margin-left: 4px;
        }

        .login-toggle button:hover {
          color: var(--color-primary-brand-hover);
        }
      `}</style>
    </div>
  )
}
