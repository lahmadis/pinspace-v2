'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import { Users, ShieldCheck, GraduationCap } from 'lucide-react'

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
    fetch('/api/admin/users', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data: { users?: AdminUser[] }) => setUsers(Array.isArray(data.users) ? data.users : []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-xl border border-gray-200">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">PinSpace Admin</h1>
            <p className="text-sm text-gray-500 mt-1">Sign in with your admin email</p>
          </div>
          <form onSubmit={handleAdminSignIn} className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                id="admin-email"
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                placeholder="you@gmail.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <PasswordInput
                id="admin-password"
                value={signInPassword}
                onChange={setSignInPassword}
                autoComplete="current-password"
              />
            </div>
            {signInError && <p className="text-sm text-red-600">{signInError}</p>}
            <button
              type="submit"
              disabled={signingIn}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow border border-gray-200 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
          <p className="text-gray-600 mb-6">This account is not in PINSPACE_ADMIN_EMAILS.</p>
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="text-indigo-600 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-slate-50 to-indigo-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="p-2 hover:bg-white/80 rounded-lg transition-colors text-gray-600">←</Link>
            <div className="flex items-center gap-2">
              <Users className="w-7 h-7 text-indigo-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Users &amp; roles</h1>
                <p className="text-sm text-gray-500">Promote users to instructor or demote to student</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-white/80 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 mx-auto" />
            </div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No users yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
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
                      <tr key={u.userId} className="border-b border-gray-100 last:border-0 hover:bg-indigo-50/30">
                        <td className="px-4 py-3 text-gray-900">{u.email || '—'}</td>
                        <td className="px-4 py-3 text-gray-700">{u.fullName || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{u.organization || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 capitalize">{u.role || '—'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                              isInstr ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
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
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                              isInstr
                                ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                                : 'bg-indigo-600 text-white hover:bg-indigo-700'
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

        <p className="text-xs text-gray-400 text-center mt-3">
          Only instructors can create classes and publish rooms to the network. The demographic column is informational
          (from onboarding) and does not grant access.
        </p>
      </div>
    </div>
  )
}
