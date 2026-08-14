'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import { ShieldCheck, GraduationCap } from 'lucide-react'
import { AdminShell } from '@/components/admin/AdminShell'
import { Button, StatusState } from '@/components/ui'

type AccountRole = 'student' | 'instructor'

interface AdminUser {
  userId: string
  email: string | null
  fullName: string | null
  organization: string | null
  role: string | null // demographic
  accountRole: AccountRole
}

export default function AdminUsersPage() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  // Admin sign-in (mirrors /admin)
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

  const loadUsers = () => {
    if (!isAdmin) return
    setLoading(true)
    setLoadError('')
    fetch('/api/admin/users', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load users')
        return r.json()
      })
      .then((data: { users?: AdminUser[] }) => setUsers(Array.isArray(data.users) ? data.users : []))
      .catch(() => {
        setUsers([])
        setLoadError('Failed to load users')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    // The request lifecycle intentionally owns loading and error state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers()
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const toggleRole = async (u: AdminUser) => {
    const next: AccountRole = u.accountRole === 'instructor' ? 'student' : 'instructor'
    setSavingId(u.userId)
    setError('')
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.userId, accountRole: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to update role')
        return
      }
      setUsers((prev) => prev.map((x) => (x.userId === u.userId ? { ...x, accountRole: next } : x)))
    } catch {
      setError('Request failed')
    } finally {
      setSavingId(null)
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

  return (
    <AdminShell
      currentPath="/admin/users"
      title="Users & roles"
      description="Promote users to instructor or return them to the student role."
      actions={
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="inline-flex min-h-11 items-center rounded-kova px-3 py-2 text-sm font-semibold text-text-secondary hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Sign out
          </button>
      }
    >

        {error && <p className="text-sm text-danger mb-4">{error}</p>}

        <div className="bg-background-light rounded-xl border border-border shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-accent mx-auto" />
            </div>
          ) : loadError ? (
            <StatusState
              className="m-6"
              status="error"
              title={loadError}
              description="The request failed; this is not an empty user list."
              action={<Button type="button" variant="secondary" onClick={loadUsers}>Try again</Button>}
            />
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">No users yet.</div>
          ) : (
            <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" tabIndex={0} role="region" aria-label="Users and roles table">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-background border-b border-border text-left text-xs uppercase tracking-wide text-text-dim">
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Organization</th>
                    <th className="px-4 py-3 font-medium">Demographic</th>
                    <th className="px-4 py-3 font-medium">Account role</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isInstr = u.accountRole === 'instructor'
                    return (
                      <tr key={u.userId} className="border-b border-border last:border-0 hover:bg-primary-muted">
                        <td className="px-4 py-3 text-text-primary">{u.email || '—'}</td>
                        <td className="px-4 py-3 text-text-primary">{u.fullName || '—'}</td>
                        <td className="px-4 py-3 text-text-secondary">{u.organization || '—'}</td>
                        <td className="px-4 py-3 text-text-secondary capitalize">{u.role || '—'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                              isInstr ? 'bg-primary-muted text-accent' : 'bg-background-lighter text-text-secondary'
                            }`}
                          >
                            {isInstr ? <ShieldCheck className="w-3 h-3" /> : <GraduationCap className="w-3 h-3" />}
                            {u.accountRole}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => toggleRole(u)}
                            disabled={savingId === u.userId}
                            className={`min-h-11 rounded-kova px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
                              isInstr
                                ? 'border border-border text-text-primary hover:bg-background'
                                : 'bg-accent text-background-light hover:bg-accent-light'
                            }`}
                          >
                            {savingId === u.userId
                              ? 'Saving…'
                              : isInstr
                              ? 'Demote to student'
                              : 'Promote to instructor'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-text-dim text-center mt-3">
          Only instructors can create classes and publish rooms to the network. The demographic column is informational
          (from onboarding) and does not grant access.
        </p>
    </AdminShell>
  )
}
