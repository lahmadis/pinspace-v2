'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import Link from 'next/link'
import { Building2, Settings, ExternalLink, LayoutDashboard, BarChart3, Briefcase, ChevronRight } from 'lucide-react'

type InstitutionWithCount = {
  id: string
  name: string
  slug: string
  network_label?: string | null
  allowed_email_domains?: string | null
  type?: 'institution' | 'firm' | null
  workspace_count: number
}

function StatBlock({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a)
  if (entries.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">{title}</h3>
        <p className="text-sm text-gray-500">No data yet</p>
      </div>
    )
  }
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-2">{title}</h3>
      <ul className="space-y-1">
        {entries.map(([key, count]) => (
          <li key={key} className="flex justify-between text-sm">
            <span className="text-gray-600 truncate max-w-[140px]">{key}</span>
            <span className="font-medium text-gray-900">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function AdminDashboardPage() {
  const [user, setUser] = useState<any>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [institutions, setInstitutions] = useState<InstitutionWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [signInError, setSignInError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [stats, setStats] = useState<{
    total: number
    by_year: Record<string, number>
    by_major: Record<string, number>
    by_age_range: Record<string, number>
    by_how_heard: Record<string, number>
  } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user ?? null)
      setIsLoaded(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null)
      setIsLoaded(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleAdminSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setSignInError('')
    if (!signInEmail.trim() || !signInPassword) {
      setSignInError('Email and password required')
      return
    }
    setSigningIn(true)
    const { error } = await supabase.auth.signInWithPassword({ email: signInEmail.trim(), password: signInPassword })
    setSigningIn(false)
    if (error) {
      setSignInError(error.message || 'Sign in failed')
      return
    }
  }

  useEffect(() => {
    if (!isLoaded || !user?.id) return
    fetch('/api/admin/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { isAdmin?: boolean }) => setIsAdmin(Boolean(data?.isAdmin)))
      .catch(() => setIsAdmin(false))
  }, [isLoaded, user?.id])

  useEffect(() => {
    if (!isAdmin) return
    setLoading(true)
    Promise.all([
      fetch('/api/admin/overview', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { institutions: [] })),
      fetch('/api/admin/stats', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([overviewData, statsData]) => {
      setInstitutions(Array.isArray(overviewData?.institutions) ? overviewData.institutions : [])
      setStats(statsData)
    }).catch(() => setInstitutions([]))
    .finally(() => setLoading(false))
  }, [isAdmin])

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    )
  }

  // Not logged in: show admin sign-in form (no institution required – use your Gmail)
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-xl border border-gray-200">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">PinSpace Admin</h1>
            <p className="text-sm text-gray-500 mt-1">Sign in with your admin email (e.g. Gmail)</p>
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
              <input
                id="admin-password"
                type="password"
                value={signInPassword}
                onChange={(e) => setSignInPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
          <p className="mt-4 text-xs text-gray-400 text-center">
            Admin link: <code className="bg-gray-100 px-1 rounded">/admin</code> — bookmark this page
          </p>
        </div>
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow border border-gray-200 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
          <p className="text-gray-600 mb-6">This account is not an admin. Only emails in PINSPACE_ADMIN_EMAILS can access.</p>
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
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="p-2 hover:bg-white/80 rounded-lg transition-colors">
              <span className="text-gray-600">←</span>
            </Link>
            <div className="flex items-center gap-2">
              <LayoutDashboard className="w-8 h-8 text-indigo-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
                <p className="text-sm text-gray-600">Overview of institutions and usage</p>
              </div>
            </div>
          </div>
          <Link
            href="/admin/institutions"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
          >
            <Settings className="w-4 h-4" />
            Manage institutions
          </Link>
        </div>

        {stats && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900">Student stats</h2>
              <span className="text-sm text-gray-500">({stats.total} profiles)</span>
            </div>
            <div className="p-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <StatBlock title="By year" data={stats.by_year} />
              <StatBlock title="By major" data={stats.by_major} />
              <StatBlock title="By age range" data={stats.by_age_range} />
              <StatBlock title="How they heard" data={stats.by_how_heard} />
            </div>
          </div>
        )}

        {(() => {
          const institutionsList = institutions.filter((i) => (i.type || 'institution') === 'institution')
          const firmsList = institutions.filter((i) => i.type === 'firm')
          const renderList = (list: InstitutionWithCount[], title: string, description: string, icon: React.ReactNode, emptyMsg: string) => (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-8">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
                {icon}
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                  <p className="text-sm text-gray-500">{description}</p>
                </div>
              </div>
              {loading ? (
                <div className="p-8 text-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">Loading…</p>
                </div>
              ) : list.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p className="font-medium text-gray-700">{emptyMsg}</p>
                  <p className="mt-1 text-sm">
                    Add schools or firms in <Link href="/admin/institutions" className="text-indigo-600 hover:underline">Manage institutions</Link> to see stats for everyone in each one.
                  </p>
                  <Link href="/admin/institutions" className="mt-4 inline-flex items-center gap-1 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm font-medium">
                    Add one
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              ) : (
                <>
                  <p className="px-6 py-2 text-sm text-gray-500 border-b border-gray-100">
                    Click an institution or firm to see stats for everyone in it (name, email, role, studios).
                  </p>
                  <ul className="divide-y divide-gray-200">
                    {list.map((inst) => (
                      <li key={inst.id}>
                        <Link
                          href={`/admin/institutions/${inst.slug}`}
                          className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-indigo-50/50 transition-colors group"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900 truncate group-hover:text-indigo-700">{inst.name}</p>
                            <p className="text-sm text-gray-500">
                              {inst.slug}
                              {inst.network_label ? ` · ${inst.network_label}` : ''}
                              {inst.allowed_email_domains ? ` · ${inst.allowed_email_domains}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-sm text-gray-500 whitespace-nowrap">
                              {inst.workspace_count} workspace{inst.workspace_count !== 1 ? 's' : ''}
                            </span>
                            <span className="inline-flex items-center gap-1 text-sm text-indigo-600 font-medium">
                              View stats
                              <ChevronRight className="w-4 h-4" />
                            </span>
                            <a
                              href={`/i/${inst.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 p-1 rounded"
                              title="Open explore in new tab"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )
          return (
            <>
              {renderList(
                institutionsList,
                'Institutions',
                'Schools and universities on PinSpace.',
                <Building2 className="w-5 h-5 text-indigo-600" />,
                'No institutions yet.'
              )}
              {renderList(
                firmsList,
                'Firms',
                'Architecture and design firms on PinSpace.',
                <Briefcase className="w-5 h-5 text-indigo-600" />,
                'No firms yet.'
              )}
            </>
          )
        })()}

        <p className="mt-4 text-sm text-gray-500">
          Use <strong>Manage institutions</strong> to add schools or firms. Each gets a link like <code className="bg-gray-100 px-1 rounded">/i/[slug]</code>.
        </p>
      </div>
    </div>
  )
}
