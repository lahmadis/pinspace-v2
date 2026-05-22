'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { useAuthSession } from '@/hooks/useAuthSession'
import { useAccountMode, resetAccountModeCache } from '@/lib/useAccountMode'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import type { Scope } from '@/components/dashboard/DashboardSidebar'
import { toast } from '@/lib/toast'
import {
  Camera, Bell, Building2, Monitor, Lock, HardDrive,
  Trash2, LogOut, KeyRound, Save, X,
} from 'lucide-react'

const SCOPE_KEY = 'pinspace-dashboard-scope'

// ── Shared UI ─────────────────────────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {children}
    </div>
  )
}

function SectionHeader({
  icon, title, badge,
}: { icon: React.ReactNode; title: string; badge?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      <span className="text-gray-400">{icon}</span>
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {badge && (
        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
          Coming soon
        </span>
      )}
    </div>
  )
}

function Toggle({
  checked, onChange, label, description, disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <div className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div
          className={`w-9 h-5 rounded-full transition-colors ${
            checked ? 'bg-indigo-600' : 'bg-gray-200'
          } ${disabled ? 'opacity-50' : ''}`}
        />
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
    </label>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter()
  const { status: authStatus, user } = useAuthSession()
  const isLoaded = authStatus !== 'loading'
  const { mode: accountMode } = useAccountMode(user?.id, user?.email)

  // Profile
  const [fullName, setFullName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Notifications
  const [notifyInvites, setNotifyInvites] = useState(true)
  const [notifyUpdates, setNotifyUpdates] = useState(true)

  // Organization
  const [organization, setOrganization] = useState<{
    id: string; name: string; slug: string
  } | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [joinedAt, setJoinedAt] = useState<string | null>(null)

  // Admin / sidebar
  const [firstName, setFirstName] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Dialogs
  const [leaveOrgConfirm, setLeaveOrgConfirm] = useState(false)
  const [deleteStep, setDeleteStep] = useState<'idle' | 'warn' | 'confirm'>('idle')
  const [deleteText, setDeleteText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // ── Auth guard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/sign-in')
  }, [authStatus, router])

  // ── Load profile ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return
    Promise.all([
      fetch('/api/user-profile', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/admin/me', { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([profile, adminData]) => {
      setIsAdmin(Boolean(adminData?.isAdmin))
      if (!profile) return

      const name = typeof profile.full_name === 'string' ? profile.full_name : ''
      setFullName(name)
      setSavedName(name)
      setAvatarUrl(profile.avatar_url ?? null)
      setNotifyInvites(profile.notify_room_invites !== false)
      setNotifyUpdates(profile.notify_platform_updates !== false)
      setUserRole(profile.role ?? null)
      setJoinedAt(profile.created_at ?? null)
      setFirstName(name.trim().split(/\s+/)[0] || null)

      const org = profile.organization
      setOrganization(org?.slug && org?.name
        ? { id: org.id, name: org.name, slug: org.slug }
        : null)
    }).catch(() => {})
  }, [user?.id])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleScopeChange = (scope: Scope) => {
    if (typeof window !== 'undefined') localStorage.setItem(SCOPE_KEY, scope)
    router.push('/dashboard')
  }

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName }),
      })
      if (res.ok) {
        setSavedName(fullName)
        setFirstName(fullName.trim().split(/\s+/)[0] || null)
        toast.success('Profile saved')
      } else {
        toast.error('Failed to save profile')
      }
    } catch {
      toast.error('Failed to save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user?.id) return
    setAvatarUploading(true)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${user.id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (uploadErr) throw uploadErr

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      const publicUrl = urlData.publicUrl

      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: publicUrl }),
      })
      if (res.ok) {
        setAvatarUrl(`${publicUrl}?t=${Date.now()}`)
        toast.success('Avatar updated')
      } else {
        toast.error('Failed to save avatar')
      }
    } catch {
      toast.error('Avatar upload failed')
    } finally {
      setAvatarUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleToggleNotification = async (
    key: 'notify_room_invites' | 'notify_platform_updates',
    value: boolean,
  ) => {
    // Optimistic update
    if (key === 'notify_room_invites') setNotifyInvites(value)
    else setNotifyUpdates(value)

    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
      if (!res.ok) throw new Error()
    } catch {
      // Rollback
      if (key === 'notify_room_invites') setNotifyInvites(!value)
      else setNotifyUpdates(!value)
      toast.error('Failed to save preference')
    }
  }

  const handleLeaveOrg = async () => {
    try {
      const res = await fetch('/api/settings/leave-organization', { method: 'POST' })
      if (res.ok) {
        setOrganization(null)
        setLeaveOrgConfirm(false)
        toast.success('Left organization')
        resetAccountModeCache()
      } else {
        toast.error('Failed to leave organization')
      }
    } catch {
      toast.error('Failed to leave organization')
    }
  }

  const handleChangePassword = async () => {
    if (!user?.email) return
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/sign-in`,
      })
      if (error) toast.error(error.message)
      else toast.success('Password reset email sent — check your inbox')
    } catch {
      toast.error('Failed to send reset email')
    }
  }

  const handleSignOut = async () => {
    resetAccountModeCache()
    await supabase.auth.signOut()
    router.push('/sign-in')
  }

  const handleDeleteAccount = async () => {
    if (deleteText.toLowerCase() !== 'delete') return
    setDeleting(true)
    try {
      const res = await fetch('/api/settings/delete-account', { method: 'POST' })
      if (res.ok) {
        router.push('/sign-in')
      } else {
        toast.error('Failed to delete account. Please try again.')
        setDeleting(false)
      }
    } catch {
      toast.error('Failed to delete account. Please try again.')
      setDeleting(false)
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500" />
      </div>
    )
  }

  const hasOrganization = accountMode !== 'personal' || Boolean(organization)
  const displayName = firstName || user?.email?.split('@')[0] || 'You'
  const nameChanged = fullName !== savedName

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <DashboardSidebar
        currentScope="personal"
        onScopeChange={handleScopeChange}
        hasOrganization={hasOrganization}
        orgName={organization?.name}
        accountMode={accountMode}
        firstName={firstName}
        userEmail={user?.email}
        isAdmin={isAdmin}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="shrink-0 h-16 flex items-center px-6 border-b border-gray-200 bg-white">
          <span className="text-base font-semibold text-gray-900 pl-10 md:pl-0">Settings</span>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          <div className="max-w-2xl mx-auto space-y-5">

            {/* ── Profile ──────────────────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<Camera className="w-4 h-4" />} title="Profile" />

              {/* Avatar */}
              <div className="flex items-center gap-4 mb-5">
                <div className="relative w-16 h-16 shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Avatar"
                      className="w-16 h-16 rounded-full object-cover border border-gray-200"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xl font-bold select-none">
                      {displayName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  {avatarUploading && (
                    <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    disabled={avatarUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    {avatarUploading ? 'Uploading…' : 'Change photo'}
                  </button>
                  <p className="text-xs text-gray-400 mt-1">JPG, PNG, or GIF · max 5 MB</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </div>

              {/* Display name */}
              <div className="space-y-1 mb-4">
                <label className="block text-sm font-medium text-gray-700">Display name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Email */}
              <div className="space-y-1 mb-5">
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={user?.email ?? ''}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-default"
                />
              </div>

              <button
                type="button"
                disabled={!nameChanged || savingProfile}
                onClick={handleSaveProfile}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {savingProfile ? 'Saving…' : 'Save'}
              </button>
            </SectionCard>

            {/* ── Notifications ─────────────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<Bell className="w-4 h-4" />} title="Notifications" />
              <div className="space-y-4">
                <Toggle
                  checked={notifyInvites}
                  onChange={(v) => handleToggleNotification('notify_room_invites', v)}
                  label="Email me when invited to a room"
                />
                <Toggle
                  checked={notifyUpdates}
                  onChange={(v) => handleToggleNotification('notify_platform_updates', v)}
                  label="Email me about platform updates"
                />
              </div>
            </SectionCard>

            {/* ── Institution ───────────────────────────────────────────────── */}
            {organization && (
              <SectionCard>
                <SectionHeader icon={<Building2 className="w-4 h-4" />} title="Institution" />
                <dl className="space-y-3 mb-5">
                  <div>
                    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Organization</dt>
                    <dd className="text-sm text-gray-900">{organization.name}</dd>
                  </div>
                  {userRole && (
                    <div>
                      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Role</dt>
                      <dd className="text-sm text-gray-900 capitalize">{userRole}</dd>
                    </div>
                  )}
                  {joinedAt && (
                    <div>
                      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">Joined</dt>
                      <dd className="text-sm text-gray-900">
                        {new Date(joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                      </dd>
                    </div>
                  )}
                </dl>
                {!leaveOrgConfirm ? (
                  <button
                    type="button"
                    onClick={() => setLeaveOrgConfirm(true)}
                    className="px-4 py-2 text-sm font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Leave organization
                  </button>
                ) : (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                    <p className="text-sm text-red-700 mb-3">
                      You&apos;ll lose access to all rooms under <strong>{organization.name}</strong>. This cannot be undone from here.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setLeaveOrgConfirm(false)}
                        className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleLeaveOrg}
                        className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                      >
                        Leave
                      </button>
                    </div>
                  </div>
                )}
              </SectionCard>
            )}

            {/* ── Display (placeholder) ─────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<Monitor className="w-4 h-4" />} title="Display" badge />
              <p className="text-sm text-gray-500">
                Theme, units, and default room template settings coming soon.
              </p>
            </SectionCard>

            {/* ── Privacy (placeholder) ─────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<Lock className="w-4 h-4" />} title="Privacy" badge />
              <p className="text-sm text-gray-500">
                Control who can see your personal rooms and set default sharing behavior. Coming soon.
              </p>
            </SectionCard>

            {/* ── Storage (placeholder) ─────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<HardDrive className="w-4 h-4" />} title="Storage" badge />
              <p className="text-sm text-gray-500">
                View storage usage and quotas. Coming soon.
              </p>
            </SectionCard>

            {/* ── Account ───────────────────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<KeyRound className="w-4 h-4" />} title="Account" />
              <div className="space-y-3">
                <div>
                  <button
                    type="button"
                    onClick={handleChangePassword}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-gray-500" />
                    Change password
                  </button>
                  <p className="text-xs text-gray-400 mt-1 ml-0.5">We&apos;ll send a reset link to your email.</p>
                </div>

                <div className="h-px bg-gray-100" />

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5 text-gray-500" />
                  Sign out
                </button>

                <div className="h-px bg-gray-100" />

                {/* Delete account */}
                {deleteStep === 'idle' && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setDeleteStep('warn')}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete account
                    </button>
                  </div>
                )}

                {deleteStep === 'warn' && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-semibold text-red-800">Are you sure?</p>
                      <button type="button" onClick={() => setDeleteStep('idle')} className="p-0.5 hover:bg-red-100 rounded">
                        <X className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                    <p className="text-sm text-red-700 mb-3">
                      Your account will be deactivated immediately. All your rooms and boards will
                      become inaccessible. This action cannot be reversed from the app.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleteStep('idle')}
                        className="px-3 py-1.5 text-sm font-medium border border-gray-300 bg-white rounded-lg hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteStep('confirm')}
                        className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {deleteStep === 'confirm' && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-semibold text-red-800">Final confirmation</p>
                      <button
                        type="button"
                        onClick={() => { setDeleteStep('idle'); setDeleteText('') }}
                        className="p-0.5 hover:bg-red-100 rounded"
                      >
                        <X className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                    <p className="text-sm text-red-700 mb-3">
                      Type <strong>delete</strong> to confirm.
                    </p>
                    <input
                      type="text"
                      value={deleteText}
                      onChange={(e) => setDeleteText(e.target.value)}
                      placeholder="delete"
                      autoFocus
                      className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-3 bg-white"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setDeleteStep('idle'); setDeleteText('') }}
                        className="px-3 py-1.5 text-sm font-medium border border-gray-300 bg-white rounded-lg hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={deleteText.toLowerCase() !== 'delete' || deleting}
                        onClick={handleDeleteAccount}
                        className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {deleting ? 'Deleting…' : 'Delete my account'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>

          </div>
        </div>
      </div>
    </div>
  )
}
