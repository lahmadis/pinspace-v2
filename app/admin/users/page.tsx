'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import PasswordInput from '@/components/ui/PasswordInput'
import { AdminShell } from '@/components/admin/AdminShell'
import { UserMetricsStrip } from '@/components/admin/users/UserMetricsStrip'
import { UsersTable } from '@/components/admin/users/UsersTable'
import { getAdminMeApi, getAdminUsersApi } from '@/lib/api/admin'
import type { AdminUser } from '@/types/admin'
import { Button, Card, FormField, Input } from '@/components/ui'

export default function AdminUsersPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
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

  const checkAdmin = useCallback(async () => {
    try {
      const data = await getAdminMeApi()
      if (!data.isAdmin) {
        setIsAdmin(false)
        return false
      }
      setIsAdmin(true)
      return true
    } catch {
      setIsAdmin(false)
      return false
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await getAdminUsersApi()
      setUsers(Array.isArray(data.users) ? data.users : [])
    } catch {
      setUsers([])
      setLoadError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isLoaded && user?.id) {
      checkAdmin().then((ok) => {
        if (ok) loadData()
      })
    }
  }, [isLoaded, user?.id, checkAdmin, loadData])

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

  if (!isLoaded) {
    return (
      <AdminShell
        currentPath="/admin/users"
        title="Users & roles"
        description="Promote users to instructor or return them to the student role."
      >
        <UserMetricsStrip users={[]} loading={true} />
        <UsersTable users={[]} loading={true} loadError="" onChanged={() => {}} />
      </AdminShell>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary">pinspace Admin</h1>
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
      <AdminShell
        currentPath="/admin/users"
        title="Users & roles"
        description="Promote users to instructor or return them to the student role."
      >
        <UserMetricsStrip users={[]} loading={true} />
        <UsersTable users={[]} loading={true} loadError="" onChanged={() => {}} />
      </AdminShell>
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
      <UserMetricsStrip users={users} loading={loading} />
      <UsersTable users={users} loading={loading} loadError={loadError} onChanged={loadData} />
      <p className="text-xs text-text-dim text-center mt-3">
        Only instructors can create classes and publish rooms to the network. The demographic column is informational
        (from onboarding) and does not grant access.
      </p>
    </AdminShell>
  )
}
