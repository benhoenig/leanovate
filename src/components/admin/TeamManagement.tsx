import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserPlus, Shield, User, Trash2, AlertCircle } from 'lucide-react'
import { rawSelect } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import AdminListSkeleton from './AdminListSkeleton'
import type { Profile, UserRole } from '@/types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Raw fetch for edge functions — same pattern as useCatalogStore */
async function invokeEdgeFunction(name: string, body: Record<string, unknown>): Promise<{ error: string | null; data?: Record<string, unknown> }> {
  let token = SUPABASE_ANON_KEY
  try {
    const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.access_token) token = parsed.access_token
    }
  } catch { /* fall back to anon key */ }

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const text = await resp.text()
      return { error: text || `HTTP ${resp.status}` }
    }
    try {
      const data = await resp.json()
      return { error: null, data }
    } catch {
      return { error: null }
    }
  } catch (err) {
    return { error: String(err) }
  }
}

export default function TeamManagement() {
  const { t, i18n } = useTranslation()
  const localeTag = i18n.resolvedLanguage === 'th' ? 'th-TH' : 'en-US'
  const currentProfile = useAuthStore((s) => s.profile)
  const [members, setMembers] = useState<Profile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('designer')
  const [inviteResult, setInviteResult] = useState<{ tempPassword?: string; error?: string } | null>(null)
  const [isInviting, setIsInviting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const loadMembers = async () => {
    // rawSelect (raw fetch) — see CLAUDE.md #8.
    setIsLoading(true)
    const { data, error } = await rawSelect<Profile>(
      'profiles',
      'order=created_at.asc',
    )
    if (error) { console.error('loadMembers:', error); setIsLoading(false); return }
    setMembers(data ?? [])
    setIsLoading(false)
  }

  useEffect(() => { loadMembers() }, [])

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return
    setIsInviting(true)
    setInviteResult(null)

    const { error, data } = await invokeEdgeFunction('manage-team', {
      action: 'invite',
      email: inviteEmail.trim(),
      display_name: inviteName.trim(),
      role: inviteRole,
    })

    if (error) {
      setInviteResult({ error })
    } else {
      setInviteResult({ tempPassword: (data?.temp_password as string) ?? t('admin.team.checkEmail') })
      setInviteEmail('')
      setInviteName('')
      await loadMembers()
    }
    setIsInviting(false)
  }

  const handleChangeRole = async (userId: string, newRole: UserRole) => {
    if (userId === currentProfile?.id) return
    setActionError(null)
    const { error } = await invokeEdgeFunction('manage-team', {
      action: 'change-role',
      user_id: userId,
      role: newRole,
    })
    if (error) { setActionError(error); return }
    setMembers((prev) =>
      prev.map((m) => (m.id === userId ? { ...m, role: newRole } : m))
    )
  }

  const handleRemove = async (userId: string) => {
    if (userId === currentProfile?.id) return
    setActionError(null)
    const { error } = await invokeEdgeFunction('manage-team', {
      action: 'remove',
      user_id: userId,
    })
    if (error) { setActionError(error); return }
    setMembers((prev) => prev.filter((m) => m.id !== userId))
    setConfirmRemoveId(null)
  }

  if (isLoading) {
    return <AdminListSkeleton rows={3} />
  }

  return (
    <div className="team-mgmt">
      {actionError && (
        <div className="team-error">
          <AlertCircle size={14} />
          {actionError}
          <button onClick={() => setActionError(null)} className="team-error-dismiss">{t('admin.team.dismiss')}</button>
        </div>
      )}

      {/* Invite section */}
      <div className="team-invite-section">
        {!showInvite ? (
          <button className="team-invite-trigger" onClick={() => { setShowInvite(true); setInviteResult(null) }}>
            <UserPlus size={14} />
            {t('admin.team.inviteMember')}
          </button>
        ) : (
          <div className="team-invite-form">
            <div className="invite-row">
              <input
                type="email"
                placeholder={t('admin.team.emailLabel')}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="invite-input"
              />
              <input
                type="text"
                placeholder={t('admin.team.displayNamePlaceholder')}
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="invite-input"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="invite-select"
              >
                <option value="designer">{t('admin.team.roleDesigner')}</option>
                <option value="admin">{t('admin.team.roleAdmin')}</option>
              </select>
            </div>
            <div className="invite-actions">
              <button
                className="invite-send-btn"
                onClick={handleInvite}
                disabled={isInviting || !inviteEmail.trim() || !inviteName.trim()}
              >
                {isInviting ? t('admin.team.inviting') : t('admin.team.inviteButton')}
              </button>
              <button className="invite-cancel-btn" onClick={() => { setShowInvite(false); setInviteResult(null) }}>
                {t('admin.team.cancelInvite')}
              </button>
            </div>
            {inviteResult && (
              <div className={`invite-result ${inviteResult.error ? 'error' : 'success'}`}>
                {inviteResult.error ? (
                  <span>{t('admin.team.inviteErrorPrefix', { error: inviteResult.error })}</span>
                ) : (
                  <span>
                    {t('admin.team.inviteSuccessLine1')} <strong>{inviteResult.tempPassword}</strong>
                    <br />
                    <em style={{ fontSize: 10, opacity: 0.8 }}>{t('admin.team.inviteSuccessLine2')}</em>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Members list */}
      <div className="team-list">
        <p className="team-count">{t('admin.team.countMembers', { count: members.length })}</p>
        {members.map((member) => {
          const isSelf = member.id === currentProfile?.id
          const joinedDate = new Date(member.created_at).toLocaleDateString(localeTag, { month: 'short', day: 'numeric', year: 'numeric' })
          return (
            <div key={member.id} className={`team-member-row ${isSelf ? 'is-self' : ''}`}>
              <div className="member-icon-wrapper">
                {member.role === 'admin' ? <Shield size={14} /> : <User size={14} />}
              </div>
              <div className="member-info">
                <span className="member-name">
                  {member.display_name}
                  {isSelf && <span className="member-you">{t('admin.team.youLabel')}</span>}
                </span>
                <span className="member-joined">
                  {t('admin.team.joined', { date: joinedDate })}
                </span>
              </div>
              <span className={`member-role-badge ${member.role}`}>
                {member.role === 'admin' ? t('admin.team.roleAdmin') : t('admin.team.roleDesigner')}
              </span>
              {!isSelf && (
                <div className="member-actions">
                  <button
                    className="member-role-toggle"
                    onClick={() => handleChangeRole(member.id, member.role === 'admin' ? 'designer' : 'admin')}
                    title={member.role === 'admin' ? t('admin.team.demoteTooltip') : t('admin.team.promoteTooltip')}
                  >
                    {member.role === 'admin' ? t('admin.team.demoteButton') : t('admin.team.promoteButton')}
                  </button>
                  {confirmRemoveId === member.id ? (
                    <div className="remove-confirm">
                      <button className="remove-confirm-btn" onClick={() => handleRemove(member.id)}>{t('admin.team.confirm')}</button>
                      <button className="remove-cancel-btn" onClick={() => setConfirmRemoveId(null)}>{t('admin.team.cancel')}</button>
                    </div>
                  ) : (
                    <button
                      className="member-remove-btn"
                      onClick={() => setConfirmRemoveId(member.id)}
                      title={t('admin.team.removeTooltip')}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <style>{`
        .team-mgmt {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .team-error {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 10px;
          background: rgba(229, 77, 66, 0.08);
          border: 1px solid rgba(229, 77, 66, 0.25);
          color: var(--color-error);
          font-size: 12px;
          font-weight: 500;
        }
        .team-error-dismiss {
          margin-left: auto;
          background: none;
          border: none;
          color: var(--color-error);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          text-decoration: underline;
          font-family: inherit;
        }
        .team-invite-trigger {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 10px;
          border: 1.5px dashed var(--color-primary-brand);
          background: var(--color-primary-brand-light);
          color: var(--color-primary-brand);
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          justify-content: center;
          transition: all 0.15s;
        }
        .team-invite-trigger:hover {
          background: rgba(43, 168, 160, 0.12);
        }
        .team-invite-form {
          padding: 14px;
          border: 1px solid var(--color-border-custom);
          border-radius: 10px;
          background: var(--color-card-bg);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .invite-row {
          display: flex;
          gap: 8px;
        }
        .invite-input {
          flex: 1;
          padding: 8px 10px;
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
          background: var(--color-input-bg);
          font-size: 13px;
          font-family: inherit;
          color: var(--color-text-primary);
          outline: none;
        }
        .invite-input:focus {
          border-color: var(--color-primary-brand);
        }
        .invite-select {
          padding: 8px 10px;
          border: 1px solid var(--color-border-custom);
          border-radius: 8px;
          background: var(--color-input-bg);
          font-size: 13px;
          font-family: inherit;
          color: var(--color-text-primary);
          outline: none;
          cursor: pointer;
          width: 120px;
        }
        .invite-actions {
          display: flex;
          gap: 8px;
        }
        .invite-send-btn {
          padding: 8px 16px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #2BA8A0, #238C85);
          color: white;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .invite-send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .invite-cancel-btn {
          padding: 8px 16px;
          border-radius: 8px;
          border: 1px solid var(--color-border-custom);
          background: none;
          color: var(--color-text-secondary);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .invite-result {
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 12px;
          line-height: 1.5;
        }
        .invite-result.success {
          background: rgba(76, 175, 130, 0.08);
          border: 1px solid rgba(76, 175, 130, 0.25);
          color: var(--color-success);
        }
        .invite-result.error {
          background: rgba(229, 77, 66, 0.08);
          border: 1px solid rgba(229, 77, 66, 0.25);
          color: var(--color-error);
        }
        .team-count {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-secondary);
          margin-bottom: 4px;
        }
        .team-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .team-member-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--color-card-bg);
          border: 1px solid var(--color-border-custom);
          transition: all 0.15s;
        }
        .team-member-row:hover {
          border-color: var(--color-primary-brand);
        }
        .team-member-row.is-self {
          background: var(--color-primary-brand-light);
        }
        .member-icon-wrapper {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: var(--color-hover-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-secondary);
          flex-shrink: 0;
        }
        .member-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }
        .member-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-text-primary);
        }
        .member-you {
          font-size: 11px;
          font-weight: 400;
          color: var(--color-text-secondary);
          margin-left: 4px;
        }
        .member-joined {
          font-size: 10px;
          color: var(--color-text-secondary);
        }
        .member-role-badge {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .member-role-badge.admin {
          background: #F2735A;
          color: white;
        }
        .member-role-badge.designer {
          background: var(--color-primary-brand);
          color: white;
        }
        .member-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .member-role-toggle {
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid var(--color-border-custom);
          background: none;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          color: var(--color-text-secondary);
          transition: all 0.15s;
        }
        .member-role-toggle:hover {
          border-color: var(--color-primary-brand);
          color: var(--color-primary-brand);
        }
        .member-remove-btn {
          display: flex;
          align-items: center;
          padding: 5px;
          border-radius: 6px;
          border: none;
          background: none;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all 0.15s;
        }
        .member-remove-btn:hover {
          background: rgba(229, 77, 66, 0.1);
          color: var(--color-error);
        }
        .remove-confirm {
          display: flex;
          gap: 4px;
        }
        .remove-confirm-btn {
          padding: 4px 8px;
          border-radius: 5px;
          border: none;
          background: var(--color-error);
          color: white;
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .remove-cancel-btn {
          padding: 4px 8px;
          border-radius: 5px;
          border: 1px solid var(--color-border-custom);
          background: none;
          color: var(--color-text-secondary);
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
      `}</style>
    </div>
  )
}
