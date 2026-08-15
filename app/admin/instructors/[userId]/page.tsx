'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import { ChevronLeft, GraduationCap, Mail, Building2, AlertTriangle } from 'lucide-react'
import { toast } from '@/lib/toast'
import CreateStudioForm from '@/components/admin/CreateStudioForm'
import type { UserSearchResult } from '@/components/admin/InstructorPicker'
import { AdminShell } from '@/components/admin/AdminShell'

/**
 * Admin view of ONE instructor: who they are, and the class studios they own.
 *
 * NOT impersonation. Nothing on this page creates, borrows or swaps a session,
 * and nothing renders the studio as the instructor would see it. It is a report
 * an admin reads about a person, built from data the admin can already query.
 *
 * CLASS STUDIOS ONLY — enforced in /api/admin/instructors/[userId], not here, so
 * a personal or shared workspace cannot reach this component even if the markup
 * changed. Those are private and deliberately out of scope.
 */

type InstructorDetail = {
  userId: string
  fullName: string | null
  email: string | null
  organization: string | null
  accountRole: 'instructor' | 'student'
  hasProfile: boolean
}

type InstructorStudio = {
  id: string
  name: string
  type: string
  department: string | null
  yearLevel: string | null
  academicYear: string | null
  memberCount: number
  createdAt: string
  provisionedByAdmin: boolean
  isArchived: boolean
  adminIsMember: boolean
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AdminInstructorPage() {
  const params = useParams<{ userId: string }>()
  const [user, setUser] = useState<User | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [instructor, setInstructor] = useState<InstructorDetail | null>(null)
  const [studios, setStudios] = useState<InstructorStudio[]>([])
  const [membershipResolved, setMembershipResolved] = useState(true)
  const [profileResolved, setProfileResolved] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  // Admin sign-in (mirrors /admin and /admin/users)
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [signInError, setSignInError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user ?? null)
      setIsLoaded(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null)
      setIsLoaded(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!isLoaded || !user?.id) return
    fetch('/api/admin/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { isAdmin?: boolean }) => setIsAdmin(Boolean(data?.isAdmin)))
      .catch(() => setIsAdmin(false))
  }, [isLoaded, user?.id])

  const loadInstructor = () => {
    if (!isAdmin) return
    setLoading(true)
    setLoadError('')
    // Encoded: an unencoded segment lets a crafted id (%2e%2e%2f) retarget this
    // fetch at a different admin route. No privilege is gained — everything
    // under /api/admin is admin-gated — but the page would then render another
    // endpoint's payload as if it were an instructor.
    fetch(`/api/admin/instructors/${encodeURIComponent(params.userId)}`, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.error || 'Failed to load instructor')
        return data
      })
      .then((data: {
        instructor?: InstructorDetail
        studios?: InstructorStudio[]
        membershipResolved?: boolean
        profileResolved?: boolean
      }) => {
        setInstructor(data.instructor ?? null)
        setStudios(Array.isArray(data.studios) ? data.studios : [])
        setMembershipResolved(data.membershipResolved !== false)
        setProfileResolved(data.profileResolved !== false)
      })
      .catch((e: Error) => {
        setInstructor(null)
        setStudios([])
        setLoadError(e.message || 'Failed to load instructor')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    // The request lifecycle intentionally owns loading and error state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInstructor()
  }, [isAdmin, params.userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdminSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setSignInError('')
    if (!signInEmail.trim() || !signInPassword) {
      setSignInError('Email and password required')
      return
    }
    setSigningIn(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email: signInEmail.trim(), password: signInPassword })
    setSigningIn(false)
    if (err) setSignInError(err.message || 'Sign in failed')
  }

  // Reuses the commit-2 membership route unchanged — the admin joins as
  // themselves, exactly as from the Studios card. No impersonation.
  const toggleMembership = async (studio: InstructorStudio) => {
    setBusyId(studio.id)
    try {
      const res = await fetch(`/api/admin/studios/${studio.id}/membership`, {
        method: studio.adminIsMember ? 'DELETE' : 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to update membership')
        return
      }
      loadInstructor()
    } catch {
      toast.error('Request failed')
    } finally {
      setBusyId(null)
    }
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-accent border-t-accent" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl bg-background-light p-8 shadow-xl border border-border">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary">PinSpace Admin</h1>
            <p className="text-sm text-text-secondary mt-1">Sign in with your admin email</p>
          </div>
          <form onSubmit={handleAdminSignIn} className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-sm font-medium text-text-primary mb-1">Email</label>
              <input
                id="admin-email"
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                placeholder="you@gmail.com"
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="block text-sm font-medium text-text-primary mb-1">Password</label>
              <PasswordInput
                id="admin-password"
                value={signInPassword}
                onChange={setSignInPassword}
                autoComplete="current-password"
              />
            </div>
            {signInError && <p className="text-sm text-danger">{signInError}</p>}
            <button
              type="submit"
              disabled={signingIn}
              className="w-full py-2.5 bg-accent text-background-light rounded-lg hover:bg-accent-light disabled:opacity-50 font-medium"
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Checking administrator access">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-accent border-t-transparent" />
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl bg-background-light p-8 shadow border border-border text-center">
          <h1 className="text-xl font-bold text-text-primary mb-2">Access denied</h1>
          <p className="text-text-secondary mb-6">This account is not in PINSPACE_ADMIN_EMAILS.</p>
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="text-accent hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  const displayName = instructor?.fullName || instructor?.email || 'Instructor'

  // The locked instructor handed to the creation form. Shaped as a
  // UserSearchResult so CreateStudioForm takes it without a second code path;
  // organizationId is unused by the form (the route resolves the org itself).
  const lockedInstructor: UserSearchResult | null = instructor
    ? {
        userId: instructor.userId,
        email: instructor.email,
        fullName: instructor.fullName,
        organizationId: null,
        hasProfile: instructor.hasProfile,
      }
    : null

  return (
    <AdminShell
      currentPath={`/admin/instructors/${params.userId}`}
      title="Instructor details"
      description="Review identity, studio ownership, and your administrative access."
    >
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-6"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to admin
        </Link>

        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-accent border-t-accent mx-auto" />
          </div>
        ) : loadError || !instructor ? (
          <div className="bg-background-light rounded-xl border border-border shadow-sm p-8 text-center">
            <h1 className="text-lg font-semibold text-text-primary mb-1">Instructor not found</h1>
            <p className="text-sm text-text-secondary">{loadError || 'No account matches this id.'}</p>
          </div>
        ) : (
          <>
            {/* Identity */}
            <div className="bg-background-light rounded-xl border border-border shadow-sm p-6 mb-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold text-text-primary truncate">{displayName}</h1>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-text-secondary">
                    {instructor.email && (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5" />
                        {instructor.email}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      {instructor.organization || 'No organization'}
                    </span>
                  </div>
                  {/* Both badges below are claims about a person, and both are
                      derived from the profile row. If that read FAILED the row
                      reads as absent, which is indistinguishable from "never
                      onboarded" — so withhold the claims rather than assert a
                      lookup failure as a finding. */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    {profileResolved ? (
                      <>
                        {/* Owns a class but cannot create another: POST /api/workspaces
                            gates class creation on account_role. Fixable from /admin/users. */}
                        {instructor.accountRole !== 'instructor' && (
                          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-warning/15 text-warning">
                            No instructor role
                          </span>
                        )}
                        {!instructor.hasProfile && (
                          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-background-lighter text-text-secondary">
                            Has not onboarded
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Profile could not be loaded — role and onboarding status unknown.
                      </span>
                    )}
                  </div>
                </div>
                {lockedInstructor && (
                  <div className="shrink-0">
                    <CreateStudioForm
                      onCreated={loadInstructor}
                      lockedInstructor={lockedInstructor}
                      triggerLabel="Create studio"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Class studios */}
            <div className="bg-background-light rounded-xl border border-border shadow-sm overflow-hidden mb-6">
              <div className="px-6 py-3 border-b border-border bg-background flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-accent" />
                <h2 className="text-sm font-semibold text-text-primary">Class studios</h2>
                <span className="text-xs text-text-dim ml-1">newest first</span>
              </div>

              {!membershipResolved && (
                <div className="px-6 py-2.5 bg-warning/10 border-b border-warning/40 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                  <p className="text-xs text-warning">
                    Member counts and your own membership could not be loaded — the numbers below
                    may be wrong. Reload to try again.
                  </p>
                </div>
              )}

              {studios.length === 0 ? (
                <div className="p-8 text-center text-text-secondary">
                  No class studios yet. Use “Create studio” to provision one for them.
                </div>
              ) : (
                <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" tabIndex={0} role="region" aria-label="Instructor studios table">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-background border-b border-border text-left text-xs uppercase tracking-wide text-text-dim">
                        <th className="px-4 py-3 font-medium">Studio</th>
                        <th className="px-4 py-3 font-medium">Department</th>
                        <th className="px-4 py-3 font-medium">Year</th>
                        <th className="px-4 py-3 font-medium text-right">Members</th>
                        <th className="px-4 py-3 font-medium">Created</th>
                        <th className="px-4 py-3 font-medium">Origin</th>
                        <th className="px-4 py-3 font-medium text-right">Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studios.map((s) => (
                        <tr key={s.id} className="border-b border-border last:border-0 hover:bg-primary-muted">
                          <td className="px-4 py-3">
                            <p className="font-medium text-text-primary">{s.name}</p>
                            {s.isArchived && (
                              <p className="text-xs text-text-dim mt-0.5">archived</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-text-secondary">{s.department || '—'}</td>
                          <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{s.academicYear || '—'}</td>
                          <td className="px-4 py-3 text-right text-text-primary tabular-nums">
                            {membershipResolved ? s.memberCount : '—'}
                          </td>
                          <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{formatDate(s.createdAt)}</td>
                          <td className="px-4 py-3">
                            {s.provisionedByAdmin ? (
                              <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-primary-muted text-accent">
                                Provisioned
                              </span>
                            ) : (
                              <span className="text-xs text-text-dim">Organic</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => toggleMembership(s)}
                              disabled={busyId === s.id || !membershipResolved}
                              title={!membershipResolved ? 'Membership state unknown — reload first' : undefined}
                              className={`min-h-11 rounded-pinspace px-2.5 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                                s.adminIsMember
                                  ? 'border border-border text-text-primary hover:bg-background'
                                  : 'bg-accent text-background-light hover:bg-accent-light'
                              }`}
                            >
                              {busyId === s.id ? '…' : s.adminIsMember ? 'Leave' : 'Join'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
    </AdminShell>
  )
}
