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
import {
  Badge,
  Button,
  Card,
  DataTable,
  FormField,
  Input,
  Spinner,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableStateRow,
} from '@/components/ui'

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
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label="Loading administrator session">
        <Spinner className="h-12 w-12 text-accent" aria-hidden="true" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary">PinSpace Admin</h1>
            <p className="text-sm text-text-secondary mt-1">Sign in with your admin email</p>
          </div>
          <form onSubmit={handleAdminSignIn} className="space-y-4">
            <FormField id="admin-email" label="Email">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  type="email"
                  value={signInEmail}
                  onChange={(event) => setSignInEmail(event.target.value)}
                  placeholder="you@gmail.com"
                  autoComplete="email"
                />
              )}
            </FormField>
            <FormField id="admin-password" label="Password">
              {(controlProps) => (
                <PasswordInput
                  {...controlProps}
                  value={signInPassword}
                  onChange={setSignInPassword}
                  autoComplete="current-password"
                />
              )}
            </FormField>
            {signInError && <p role="alert" className="text-sm text-danger">{signInError}</p>}
            <Button type="submit" variant="secondary" className="w-full" loading={signingIn}>Sign in</Button>
          </form>
        </Card>
      </div>
    )
  }

  if (isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Checking administrator access">
        <Spinner className="h-12 w-12 text-accent" aria-hidden="true" />
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="text-xl font-bold text-text-primary mb-2">Access denied</h1>
          <p className="text-text-secondary mb-6">This account is not in PINSPACE_ADMIN_EMAILS.</p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
          >
            Sign out
          </Button>
        </Card>
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
          <div className="p-12 text-center" role="status" aria-label="Loading instructor">
            <Spinner className="h-10 w-10 text-accent" aria-hidden="true" />
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
            <Card className="mb-6 overflow-hidden p-0">
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
                <DataTable label="Instructor studios">
                  <TableBody>
                    <TableStateRow colSpan={7} status="empty" title="No class studios yet" description="Use Create studio to provision one for them." />
                  </TableBody>
                </DataTable>
              ) : (
                <DataTable label="Instructor studios">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Studio</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Year</TableHead>
                        <TableHead align="right">Members</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Origin</TableHead>
                        <TableHead align="right">Access</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {studios.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>
                            <p className="font-medium text-text-primary">{s.name}</p>
                            {s.isArchived && (
                              <p className="text-xs text-text-dim mt-0.5">archived</p>
                            )}
                          </TableCell>
                          <TableCell className="text-text-secondary">{s.department || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-text-secondary">{s.academicYear || '—'}</TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {membershipResolved ? s.memberCount : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-text-secondary">{formatDate(s.createdAt)}</TableCell>
                          <TableCell>
                            {s.provisionedByAdmin ? (
                              <Badge variant="accent">Provisioned</Badge>
                            ) : (
                              <Badge variant="neutral">Organic</Badge>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              type="button"
                              onClick={() => toggleMembership(s)}
                              disabled={busyId === s.id || !membershipResolved}
                              loading={busyId === s.id}
                              title={!membershipResolved ? 'Membership state unknown — reload first' : undefined}
                              variant={s.adminIsMember ? 'ghost' : 'secondary'}
                              size="sm"
                            >
                              {s.adminIsMember ? 'Leave' : 'Join'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                </DataTable>
              )}
            </Card>
          </>
        )}
    </AdminShell>
  )
}
