'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import Link from 'next/link'
import { Building2, ExternalLink, Users, LayoutGrid, Image as ImageIcon, ChevronLeft } from 'lucide-react'

type UserRole = 'faculty' | 'student' | 'professional'

function roleDisplayLabel(role: UserRole): string {
  switch (role) {
    case 'faculty':
      return 'Professor'
    case 'student':
      return 'Student'
    case 'professional':
      return 'Professional working at a firm'
    default:
      return role
  }
}

type InstitutionStats = {
  institution: { id: string; name: string; slug: string; network_label?: string; allowed_email_domains?: string }
  summary: { total_users: number; faculty_count: number; student_count: number; professional_count?: number; studio_count: number; board_count: number }
  users: Array<{
    id: string
    email: string
    full_name: string
    role: UserRole
    major?: string
    year?: string
    age_range?: string
    created_at?: string
  }>
  studios: Array<{ id: string; name: string; owner_id: string; type?: string; created_at?: string }>
}

export default function InstitutionStatsPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params?.slug as string
  const [user, setUser] = useState<User | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [stats, setStats] = useState<InstitutionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session) router.push('/sign-in')
      else setUser(session.user)
      setIsLoaded(true)
    })
    return () => subscription.unsubscribe()
  }, [router])

  useEffect(() => {
    if (!isLoaded || !user?.id) return
    fetch('/api/admin/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { isAdmin?: boolean }) => setIsAdmin(Boolean(data?.isAdmin)))
      .catch(() => setIsAdmin(false))
  }, [isLoaded, user?.id])

  useEffect(() => {
    if (!isAdmin || !slug) return
    setLoading(true)
    setError('')
    fetch(`/api/admin/institutions/${slug}/stats`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Institution not found' : 'Failed to load')
        return r.json()
      })
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [isAdmin, slug])

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow border border-gray-200 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
          <p className="text-gray-600 mb-6">Only admins can view institution stats.</p>
          <Link href="/dashboard" className="text-indigo-600 hover:underline">← Back to Dashboard</Link>
        </div>
      </div>
    )
  }

  if (loading || !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600">{error || 'Loading…'}</p>
        </div>
      </div>
    )
  }

  const { institution, summary, users, studios } = stats

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-slate-50 to-indigo-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="p-2 hover:bg-white/80 rounded-lg transition-colors flex items-center gap-1"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
              <span className="text-gray-600">Back</span>
            </Link>
            <div className="flex items-center gap-2">
              <Building2 className="w-8 h-8 text-indigo-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{institution.name}</h1>
                <p className="text-sm text-gray-500">
                  {institution.slug}
                  {institution.network_label ? ` · ${institution.network_label}` : ''}
                </p>
              </div>
            </div>
          </div>
          <a
            href={`/i/${institution.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
          >
            Open explore <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <Users className="w-5 h-5" />
              <span className="text-sm font-medium">Total users</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{summary.total_users}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <span className="text-sm font-medium">Faculty</span>
            </div>
            <p className="text-2xl font-bold text-indigo-600">{summary.faculty_count}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <span className="text-sm font-medium">Students</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{summary.student_count}</p>
          </div>
          {(summary.professional_count ?? 0) > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <span className="text-sm font-medium">Professionals</span>
              </div>
              <p className="text-2xl font-bold text-amber-600">{summary.professional_count}</p>
            </div>
          )}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <LayoutGrid className="w-5 h-5" />
              <span className="text-sm font-medium">Studios</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{summary.studio_count}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <ImageIcon className="w-5 h-5" />
              <span className="text-sm font-medium">Boards</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{summary.board_count}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-900">Student stats</h2>
            <p className="text-sm text-gray-500">Name, email, and role (Student, Professor, or Professional working at a firm)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Email</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Role</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Major</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Year</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Age range</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      No users yet for this institution
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50/50">
                      <td className="px-6 py-3 font-medium text-gray-900">{u.full_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{u.email}</td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                            u.role === 'faculty'
                              ? 'bg-indigo-100 text-indigo-800'
                              : u.role === 'professional'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {roleDisplayLabel(u.role)}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">{u.major || '—'}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{u.year || '—'}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{u.age_range || '—'}</td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-900">Studio spaces</h2>
            <p className="text-sm text-gray-500">Workspaces created for this institution</p>
          </div>
          {studios.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No studios yet</div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {studios.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-6 py-3 hover:bg-gray-50/50">
                  <span className="font-medium text-gray-900">{s.name || 'Unnamed'}</span>
                  <span className="text-sm text-gray-500">
                    {s.type || 'class'} · {s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
