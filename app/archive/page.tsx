'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive as ArchiveIcon } from 'lucide-react'
import { useAuthSession } from '@/hooks/useAuthSession'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import type { Scope } from '@/components/dashboard/DashboardSidebar'
import type { DashboardWorkspace } from '@/components/dashboard/DashboardMain'
import { currentAcademicYear } from '@/lib/academicYear'

const SCOPE_KEY = 'pinspace-dashboard-scope'

const TYPE_LABEL: Record<DashboardWorkspace['type'], string> = {
  class: 'Class',
  shared: 'Shared',
  personal: 'Personal',
}

export default function ArchivePage() {
  const router = useRouter()
  const { status: authStatus, user } = useAuthSession()

  const [workspaces, setWorkspaces] = useState<DashboardWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [firstName, setFirstName] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [organization, setOrganization] = useState<{ name: string; slug: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/sign-in')
  }, [authStatus, router])

  useEffect(() => {
    if (authStatus !== 'authenticated') return
    fetch('/api/workspaces', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const arr: DashboardWorkspace[] = Array.isArray(data) ? data : (data?.workspaces ?? [])
        setWorkspaces(arr)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [authStatus])

  useEffect(() => {
    if (!user?.id) return
    Promise.all([
      fetch('/api/admin/me', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/user-profile', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([adminData, profile]) => {
      setIsAdmin(Boolean(adminData?.isAdmin))
      const fullName = typeof profile?.full_name === 'string' ? profile.full_name : null
      setFirstName(fullName ? (fullName.trim().split(/\s+/)[0] || null) : null)
      const org = profile?.organization
      setOrganization(org?.slug && org?.name ? { name: org.name, slug: org.slug } : null)
    }).catch(() => {})
  }, [user?.id])

  const handleScopeChange = (scope: Scope) => {
    if (typeof window !== 'undefined') localStorage.setItem(SCOPE_KEY, scope)
    router.push('/dashboard')
  }

  // Group by academic_year, newest first. Rows with no year (created before the
  // backfill, or never resolved) land in their own trailing "Undated" group
  // rather than being silently dropped.
  const groups = new Map<string, DashboardWorkspace[]>()
  for (const w of workspaces) {
    const key = w.academic_year && w.academic_year.trim() ? w.academic_year.trim() : 'Undated'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(w)
  }
  const thisYear = currentAcademicYear()
  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === 'Undated') return 1
    if (b === 'Undated') return -1
    return b.localeCompare(a)
  })

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <DashboardSidebar
        currentScope="personal"
        onScopeChange={handleScopeChange}
        hasOrganization={Boolean(organization)}
        orgName={organization?.name}
        firstName={firstName}
        userEmail={user?.email}
        isAdmin={isAdmin}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="shrink-0 h-16 flex items-center px-6 border-b border-[#16181D]/8 bg-white/70 backdrop-blur-sm">
          <span className="text-base font-bold text-[#16181D] pl-10 md:pl-0">Archive</span>
        </div>

        <div className="flex-1 overflow-y-auto p-6" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
          <div className="max-w-4xl mx-auto">
            <p className="text-sm text-[#5A5E6B] mb-6">Every semester&rsquo;s projects, kept exactly as they were.</p>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-white/60 rounded-2xl border border-[#16181D]/8 animate-pulse" />
                ))}
              </div>
            ) : workspaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-[#16181D]/6 flex items-center justify-center mb-4">
                  <ArchiveIcon className="w-7 h-7 text-[#8A8FA0]" />
                </div>
                <h3 className="text-lg font-bold text-[#16181D] mb-2">Nothing here yet</h3>
                <p className="text-sm text-[#5A5E6B] max-w-xs">Your projects will show up here, grouped by term, once you have some.</p>
              </div>
            ) : (
              orderedKeys.map((key) => (
                <div key={key} className="mb-7">
                  <div className="text-[11px] font-bold tracking-[0.08em] uppercase text-[#8A8FA0] mb-2.5">
                    {key === thisYear ? `Current — ${key}` : key}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {groups.get(key)!.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => router.push(`/workspace/${w.id}`)}
                        className="bg-white/80 border border-[#16181D]/8 rounded-2xl px-5 py-4 text-left flex items-center justify-between gap-3 shadow-[0_8px_24px_rgba(22,24,29,0.06)] hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(22,24,29,0.1)] transition-all"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[#16181D] truncate">{w.name || 'Unnamed'}</div>
                          <div className="text-xs text-[#8A8FA0] mt-0.5">
                            {TYPE_LABEL[w.type]} · {w.board_count ?? 0} board{w.board_count === 1 ? '' : 's'}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 text-[11px] font-bold rounded-full px-2.5 py-1 ${
                            w.is_archived ? 'bg-[#16181D]/8 text-[#5A5E6B]' : 'bg-[#3B6EF6] text-white'
                          }`}
                        >
                          {w.is_archived ? 'Archived' : 'Live'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
