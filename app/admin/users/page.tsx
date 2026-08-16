'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import { ShieldCheck, GraduationCap } from 'lucide-react'
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
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label="Loading administrator session">
        <Spinner className="h-12 w-12 text-accent" aria-hidden="true" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
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
            <Button type="submit" variant="secondary" className="w-full" loading={signingIn}>
              Sign in
            </Button>
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

  return (
    <AdminShell
      currentPath="/admin/users"
      title="Users & roles"
      description="Promote users to instructor or return them to the student role."
      actions={
          <Button
            type="button"
            variant="ghost"
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
          >
            Sign out
          </Button>
      }
    >

        {error && <p className="text-sm text-danger mb-4">{error}</p>}

        <Card className="overflow-hidden p-0">
          <DataTable label="Users and roles">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Demographic</TableHead>
                <TableHead>Account role</TableHead>
                <TableHead align="right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableStateRow colSpan={6} status="loading" title="Loading users" />
              ) : loadError ? (
                <TableStateRow
                  colSpan={6}
                  status="error"
                  title={loadError}
                  description="The request failed; this is not an empty user list."
                  actionLabel="Try again"
                  onAction={loadUsers}
                />
              ) : users.length === 0 ? (
                <TableStateRow colSpan={6} status="empty" title="No users yet." />
              ) : (
                users.map((u) => {
                    const isInstr = u.accountRole === 'instructor'
                    return (
                      <TableRow key={u.userId}>
                        <TableCell>{u.email || '—'}</TableCell>
                        <TableCell>{u.fullName || '—'}</TableCell>
                        <TableCell className="text-text-secondary">{u.organization || '—'}</TableCell>
                        <TableCell className="capitalize text-text-secondary">{u.role || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={isInstr ? 'accent' : 'neutral'} className="gap-1">
                            {isInstr ? <ShieldCheck className="w-3 h-3" /> : <GraduationCap className="w-3 h-3" />}
                            {u.accountRole}
                          </Badge>
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            type="button"
                            onClick={() => toggleRole(u)}
                            loading={savingId === u.userId}
                            variant={isInstr ? 'ghost' : 'secondary'}
                            size="sm"
                          >
                            {isInstr
                              ? 'Demote to student'
                              : 'Promote to instructor'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                })
              )}
            </TableBody>
          </DataTable>
        </Card>

        <p className="text-xs text-text-dim text-center mt-3">
          Only instructors can create classes and publish rooms to the network. The demographic column is informational
          (from onboarding) and does not grant access.
        </p>
    </AdminShell>
  )
}
