'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { useAuthSession } from '@/hooks/useAuthSession'
import { useAccountMode, resetAccountModeCache } from '@/lib/useAccountMode'
import { useProfile } from '@/lib/ProfileContext'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import type { Scope } from '@/components/dashboard/DashboardSidebar'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Dialog, Input, StatusState } from '@/components/ui'
import { toast } from '@/lib/toast'
import {
  Camera, Bell, Building2, Monitor, Lock, HardDrive,
  Trash2, LogOut, KeyRound, Save,
} from 'lucide-react'

const SCOPE_KEY = 'pinspace-dashboard-scope'

// ── Shared UI ─────────────────────────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-pinspace-lg border border-border bg-background-card p-5 shadow-[var(--shadow-soft)] sm:p-6">
      {children}
    </section>
  )
}

function SectionHeader({
  icon, title, badge,
}: { icon: React.ReactNode; title: string; badge?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      <span className="text-text-dim">{icon}</span>
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {badge && (
        <span className="px-2 py-0.5 rounded-full bg-background-lighter text-text-secondary text-xs font-medium">
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
    <label className="flex min-h-11 cursor-pointer select-none items-start gap-3 rounded-pinspace p-1 focus-within:ring-2 focus-within:ring-accent">
      <div className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div
          className={`h-6 w-11 rounded-full transition-colors ${
            checked ? 'bg-accent' : 'bg-background-lighter'
          } ${disabled ? 'opacity-50' : ''}`}
        />
        <div
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background-light shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </div>
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {description && <p className="text-xs text-text-secondary mt-0.5">{description}</p>}
      </div>
    </label>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter()
  const { status: authStatus, user } = useAuthSession()
  const isLoaded = authStatus !== 'loading'
  const { mode: accountMode, resolved: accountModeResolved } = useAccountMode(user?.id, user?.email)
  const { setProfile } = useProfile()

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
  const [leavingOrganization, setLeavingOrganization] = useState(false)
  const [deleteStep, setDeleteStep] = useState<'idle' | 'warn' | 'confirm'>('idle')
  const [deleteText, setDeleteText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const deleteInputRef = useRef<HTMLInputElement>(null)

  const advanceDeleteConfirmation = () => {
    setDeleteStep('confirm')
    window.setTimeout(() => deleteInputRef.current?.focus(), 0)
  }

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
      setProfile({ avatarUrl: profile.avatar_url ?? null, fullName: name || null })

      const org = profile.organization
      setOrganization(org?.slug && org?.name
        ? { id: org.id, name: org.name, slug: org.slug }
        : null)
    }).catch(() => {})
  }, [setProfile, user?.id])

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
        setProfile({ fullName })
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
        const bustedUrl = `${publicUrl}?t=${Date.now()}`
        setAvatarUrl(bustedUrl)
        setProfile({ avatarUrl: bustedUrl })
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
    if (leavingOrganization) return
    setLeavingOrganization(true)
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
    } finally {
      setLeavingOrganization(false)
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
    if (deleteText.toLowerCase() !== 'delete' || deleting) return
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-accent/20 border-t-accent" />
      </div>
    )
  }

  // Same guard as the dashboard: an unresolved accountMode reports 'personal'
  // by default, and trusting that would hide the org tab in this sidebar too.
  const hasOrganization = Boolean(organization) || (accountModeResolved && accountMode !== 'personal')
  const displayName = firstName || user?.email?.split('@')[0] || 'You'
  const nameChanged = fullName !== savedName

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-background-light">
      <DashboardSidebar
        currentScope="personal"
        onScopeChange={handleScopeChange}
        hasOrganization={hasOrganization}
        orgName={organization?.name}
        firstName={firstName}
        userEmail={user?.email}
        isAdmin={isAdmin}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <PageHeader
          eyebrow="Account"
          title="Settings"
          description="Manage your profile, notifications, organization, and account security."
          className="shrink-0 pl-14 md:pl-6"
        />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 bg-background">
          <div className="max-w-2xl mx-auto space-y-5">

            {/* ── Profile ──────────────────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<Camera className="w-4 h-4" />} title="Profile" />

              {/* Avatar */}
              <div className="flex items-center gap-4 mb-5">
                <div className="relative w-16 h-16 shrink-0">
                  {avatarUrl ? (
                    // Supabase-hosted avatars are not covered by a stable image host allowlist.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt="Avatar"
                      className="w-16 h-16 rounded-full object-cover border border-border"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center text-background-light text-xl font-bold select-none">
                      {displayName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  {avatarUploading && (
                    <div className="absolute inset-0 rounded-full bg-pinspace-ink/40 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-background-light/40 border-t-background-light rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    disabled={avatarUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-11 px-3 py-2 text-sm font-medium border border-border rounded-pinspace focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent hover:bg-background transition-colors disabled:opacity-50"
                  >
                    {avatarUploading ? 'Uploading…' : 'Change photo'}
                  </button>
                  <p className="text-xs text-text-dim mt-1">JPG, PNG, or GIF · max 5 MB</p>
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
                <label htmlFor="settings-display-name" className="block text-sm font-medium text-text-primary">Display name</label>
                <input
                  id="settings-display-name"
                  type="text"
                  value={fullName}
                  maxLength={80}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              {/* Email */}
              <div className="space-y-1 mb-5">
                <label htmlFor="settings-email" className="block text-sm font-medium text-text-primary">Email</label>
                <input
                  id="settings-email"
                  type="email"
                  value={user?.email ?? ''}
                  readOnly
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background text-text-secondary cursor-default"
                />
              </div>

              <button
                type="button"
                disabled={!nameChanged || savingProfile}
                onClick={handleSaveProfile}
                className="flex min-h-11 items-center gap-1.5 rounded-pinspace bg-accent px-4 py-2 text-sm font-medium text-background-light transition-colors hover:bg-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
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
                    <dt className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-0.5">Organization</dt>
                    <dd className="text-sm text-text-primary">{organization.name}</dd>
                  </div>
                  {userRole && (
                    <div>
                      <dt className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-0.5">Role</dt>
                      <dd className="text-sm text-text-primary capitalize">{userRole}</dd>
                    </div>
                  )}
                  {joinedAt && (
                    <div>
                      <dt className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-0.5">Joined</dt>
                      <dd className="text-sm text-text-primary">
                        {new Date(joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                      </dd>
                    </div>
                  )}
                </dl>
                <Button type="button" variant="danger" onClick={() => setLeaveOrgConfirm(true)}>
                  Leave organization
                </Button>
                <Dialog
                  open={leaveOrgConfirm}
                  onOpenChange={(next) => { if (!leavingOrganization) setLeaveOrgConfirm(next) }}
                  closeOnOutsideClick={!leavingOrganization}
                  hideCloseButton={leavingOrganization}
                  title="Leave organization?"
                  description={<>You will lose access to rooms under <strong>{organization.name}</strong>. This action cannot be undone here.</>}
                >
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <Button type="button" variant="ghost" onClick={() => setLeaveOrgConfirm(false)} disabled={leavingOrganization}>Keep access</Button>
                    <Button type="button" variant="danger" loading={leavingOrganization} onClick={handleLeaveOrg} aria-label={leavingOrganization ? 'Leaving organization' : 'Leave organization'}>
                      {leavingOrganization ? 'Leaving…' : 'Leave organization'}
                    </Button>
                  </div>
                </Dialog>
              </SectionCard>
            )}

            {/* ── Display (placeholder) ─────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<Monitor className="w-4 h-4" />} title="Display" badge />
              <p className="text-sm text-text-secondary">
                Theme, units, and default room template settings coming soon.
              </p>
            </SectionCard>

            {/* ── Privacy (placeholder) ─────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<Lock className="w-4 h-4" />} title="Privacy" badge />
              <p className="text-sm text-text-secondary">
                Control who can see your personal rooms and set default sharing behavior. Coming soon.
              </p>
            </SectionCard>

            {/* ── Storage (placeholder) ─────────────────────────────────────── */}
            <SectionCard>
              <SectionHeader icon={<HardDrive className="w-4 h-4" />} title="Storage" badge />
              <p className="text-sm text-text-secondary">
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
                    className="flex min-h-11 items-center gap-2 px-4 py-2 text-sm font-medium border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg hover:bg-background transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-text-secondary" />
                    Change password
                  </button>
                  <p className="text-xs text-text-dim mt-1 ml-0.5">We&apos;ll send a reset link to your email.</p>
                </div>

                <div className="h-px bg-background-lighter" />

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex min-h-11 items-center gap-2 px-4 py-2 text-sm font-medium border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent text-text-primary rounded-lg hover:bg-background transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5 text-text-secondary" />
                  Sign out
                </button>

                <div className="h-px bg-background-lighter" />

                {/* Delete account */}
                <Button type="button" variant="danger" onClick={() => setDeleteStep('warn')}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete account
                </Button>
                <Dialog
                  open={deleteStep !== 'idle'}
                  onOpenChange={(next) => {
                    if (deleting) return
                    if (!next) { setDeleteStep('idle'); setDeleteText('') }
                  }}
                  closeOnOutsideClick={!deleting}
                  hideCloseButton={deleting}
                  title={deleteStep === 'confirm' ? 'Final account deletion confirmation' : 'Delete account?'}
                  description="Your account will be deactivated immediately. Your rooms and boards will become inaccessible."
                >
                  {deleteStep === 'warn' ? (
                    <div className="space-y-4">
                      <StatusState status="warning" title="This cannot be reversed in the app." />
                      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <Button type="button" variant="ghost" onClick={() => setDeleteStep('idle')}>Keep account</Button>
                        <Button type="button" variant="danger" onClick={advanceDeleteConfirmation}>Continue</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="delete-account-confirmation" className="mb-1 block text-sm font-semibold text-text-primary">
                          Type <strong>delete</strong> to confirm
                        </label>
                        <Input
                          ref={deleteInputRef}
                          id="delete-account-confirmation"
                          value={deleteText}
                          maxLength={20}
                          disabled={deleting}
                          onChange={(event) => setDeleteText(event.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <Button type="button" variant="ghost" onClick={() => { setDeleteStep('idle'); setDeleteText('') }} disabled={deleting}>Keep account</Button>
                        <Button type="button" variant="danger" loading={deleting} disabled={deleteText.toLowerCase() !== 'delete'} onClick={handleDeleteAccount} aria-label={deleting ? 'Deleting account' : 'Delete my account'}>
                          {deleting ? 'Deleting…' : 'Delete my account'}
                        </Button>
                      </div>
                    </div>
                  )}
                </Dialog>
              </div>
            </SectionCard>

          </div>
        </div>
      </div>
    </div>
  )
}
