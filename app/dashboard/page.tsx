'use client'

import { Suspense, useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from '@/lib/toast'
import JoinClassModal from '@/components/JoinClassModal'
import FeedbackButton from '@/components/FeedbackButton'
import { useAccountMode } from '@/lib/useAccountMode'
import { useAuthSession } from '@/hooks/useAuthSession'
import { useProfile } from '@/lib/ProfileContext'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import { DashboardMain } from '@/components/dashboard/DashboardMain'
import type { DashboardWorkspace } from '@/components/dashboard/DashboardMain'
import type { Scope } from '@/components/dashboard/DashboardSidebar'

const INSTITUTION_STORAGE_KEY = 'pinspace_institution'
const SCOPE_STORAGE_KEY = 'pinspace-dashboard-scope'

type DashboardOrganization = {
  id?: string
  name: string
  slug: string
  type?: string | null
}

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status: authStatus, user } = useAuthSession()
  const isLoaded = authStatus !== 'loading'
  const { setProfile } = useProfile()

  // Data
  const [allWorkspaces, setAllWorkspaces] = useState<DashboardWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  // Profile / org
  const [institutionHome, setInstitutionHome] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [organization, setOrganization] = useState<DashboardOrganization | null>(null)
  // Whether the profile fetch below has SETTLED — not whether it found an org.
  // `organization` is null both while loading and when the user genuinely has
  // none, and the scope-init effect must be able to tell those apart.
  const [orgResolved, setOrgResolved] = useState(false)
  const [firstName, setFirstName] = useState<string | null>(null)
  const { mode: accountMode, loading: accountModeLoading, resolved: accountModeResolved } =
    useAccountMode(user?.id, user?.email)

  // UI
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState('')
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null)
  const [confirmLeaveName, setConfirmLeaveName] = useState('')

  // Scope state — persisted to localStorage
  const [currentScope, setCurrentScope] = useState<Scope>('personal')
  const scopeInitRef = useRef(false)

  // A FAILED accountMode load still reports mode 'personal' (the default) with
  // resolved=false. Reading that as a real personal account is what hid the org
  // tab from university users after one transient fetch error, so accountMode
  // only counts once it resolved. `organization` is the more direct signal
  // anyway — it comes straight from the profile's joined org row.
  const hasOrganization = Boolean(organization) || (accountModeResolved && accountMode !== 'personal')

  const handleScopeChange = (scope: Scope) => {
    setCurrentScope(scope)
    if (typeof window !== 'undefined') localStorage.setItem(SCOPE_STORAGE_KEY, scope)
    setSidebarOpen(false)
  }

  // Init scope from localStorage once account mode AND the profile fetch have
  // both settled. Committing scopeInitRef on the earlier pass used to bounce a
  // university user to Personal: hasOrg was computed from an `organization`
  // that simply hadn't arrived yet, and the ref guard then stopped the effect
  // reconsidering when it did. Waiting on orgResolved keeps the commit one-shot
  // while making sure the one shot sees both inputs.
  useEffect(() => {
    if (!isLoaded || accountModeLoading || !orgResolved || scopeInitRef.current) return
    scopeInitRef.current = true
    const saved = typeof window !== 'undefined'
      ? (localStorage.getItem(SCOPE_STORAGE_KEY) as Scope | null)
      : null
    const valid: Scope[] = ['wentworth', 'shared', 'personal']
    if (saved && valid.includes(saved)) {
      setCurrentScope(saved === 'wentworth' && !hasOrganization ? 'personal' : saved)
    } else {
      setCurrentScope(hasOrganization ? 'wentworth' : 'personal')
    }
  }, [isLoaded, accountModeLoading, orgResolved, hasOrganization])

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchUserStudios = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/workspaces')
      if (res.ok) {
        const data = await res.json()
        const arr: DashboardWorkspace[] = Array.isArray(data) ? data : (data.workspaces ?? [])
        setAllWorkspaces(arr)
      } else if (res.status === 401) {
        router.push('/sign-in')
      } else {
        setFetchError(true)
      }
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authStatus === 'unauthenticated') { router.push('/sign-in'); return }
    if (authStatus === 'authenticated') fetchUserStudios()
  }, [authStatus, router])

  // Institution from URL / sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setInstitutionHome(window.sessionStorage.getItem(INSTITUTION_STORAGE_KEY) || null)
    }
  }, [])
  useEffect(() => {
    if (!institutionHome) return
    const inUrl = searchParams?.get('institution')
    if (inUrl !== institutionHome) {
      router.replace(`/dashboard?institution=${encodeURIComponent(institutionHome)}`, { scroll: false })
    }
  }, [institutionHome, searchParams, router])
  useEffect(() => {
    const fromUrl = searchParams?.get('institution')
    if (fromUrl && typeof window !== 'undefined') {
      window.sessionStorage.setItem(INSTITUTION_STORAGE_KEY, fromUrl)
      setInstitutionHome((prev) => prev || fromUrl)
    }
  }, [searchParams])

  // Profile + admin
  useEffect(() => {
    if (!user?.id) return
    const inst = searchParams?.get('institution')
    const redirectPath = inst ? `/dashboard?institution=${encodeURIComponent(inst)}` : '/dashboard'
    Promise.all([
      fetch('/api/admin/me', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/user-profile', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([adminData, profile]) => {
      setIsAdmin(Boolean(adminData?.isAdmin))
      if (!adminData?.isAdmin && !profile?.user_id) {
        router.replace(`/onboarding?redirect=${encodeURIComponent(redirectPath)}`)
      }
      const org = profile?.organization
      setOrganization(org?.slug && org?.name
        ? { id: org.id, name: org.name, slug: org.slug, type: org.type ?? null }
        : null)
      const fullName = typeof profile?.full_name === 'string' ? profile.full_name : null
      setFirstName(fullName ? (fullName.trim().split(/\s+/)[0] || null) : null)
      setProfile({ avatarUrl: profile?.avatar_url ?? null, fullName })
      setOrgResolved(true)
    }).catch(() => {
      // Mark resolved on failure too. This is the scope-init effect's release
      // latch, and blocking it forever would leave the dashboard stuck on its
      // initial Personal scope with no retry — worse than committing on the
      // (degraded) information we have.
      setIsAdmin(false)
      setOrgResolved(true)
    })
  }, [user?.id, searchParams, router])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleDelete = (id: string, name: string) => {
    setConfirmDeleteId(id)
    setConfirmDeleteName(name)
  }

  const executeDelete = async () => {
    if (!confirmDeleteId) return
    try {
      const res = await fetch(`/api/workspaces/${confirmDeleteId}`, { method: 'DELETE' })
      if (res.ok) {
        await fetchUserStudios()
        toast.success('Project deleted')
      } else {
        const err = await res.json()
        toast.error(`Failed to delete: ${err.error || 'Unknown error'}`)
      }
    } catch {
      toast.error('Failed to delete. Please try again.')
    } finally {
      setConfirmDeleteId(null)
      setConfirmDeleteName('')
    }
  }

  const handleRename = (id: string, name: string) => {
    setRenamingId(id)
    setRenamingValue(name)
  }

  const handleLeave = (id: string, name: string) => {
    setConfirmLeaveId(id)
    setConfirmLeaveName(name)
  }

  const executeLeave = async () => {
    if (!confirmLeaveId) return
    try {
      const res = await fetch(`/api/workspaces/${confirmLeaveId}/leave`, { method: 'POST' })
      if (res.ok) {
        await fetchUserStudios()
        toast.success('Left project')
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(`Failed to leave: ${err.error || 'Unknown error'}`)
      }
    } catch {
      toast.error('Failed to leave. Please try again.')
    } finally {
      setConfirmLeaveId(null)
      setConfirmLeaveName('')
    }
  }

  const submitRename = async () => {
    if (!renamingId || !renamingValue.trim()) return
    try {
      const res = await fetch(`/api/workspaces/${renamingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renamingValue.trim() }),
      })
      if (res.ok) {
        await fetchUserStudios()
        toast.success('Project renamed')
      } else {
        const err = await res.json()
        toast.error(`Failed to rename: ${err.error || 'Unknown error'}`)
      }
    } catch {
      toast.error('Failed to rename. Please try again.')
    } finally {
      setRenamingId(null)
      setRenamingValue('')
    }
  }

  // ── Filtered rooms for current scope ─────────────────────────────────────

  const scopedRooms = allWorkspaces.filter((w) => {
    if (currentScope === 'wentworth') return w.type === 'class'
    if (currentScope === 'shared') return w.type === 'shared'
    if (currentScope === 'personal') return w.type === 'personal'
    return false
  })

  const joinModalVariant: 'class' | 'room' = accountMode === 'firm' ? 'room' : 'class'

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-6">
          <p className="text-gray-900 font-semibold mb-2">Failed to load your projects</p>
          <p className="text-gray-500 text-sm mb-4">Check your connection and try again.</p>
          <button
            onClick={() => { setFetchError(false); fetchUserStudios() }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <DashboardSidebar
        currentScope={currentScope}
        onScopeChange={handleScopeChange}
        hasOrganization={hasOrganization}
        orgName={organization?.name}
        accountMode={accountMode}
        firstName={firstName}
        userEmail={user?.email}
        isAdmin={isAdmin}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      <DashboardMain
        scope={currentScope}
        rooms={scopedRooms}
        userId={user?.id}
        accountMode={accountMode}
        institutionHome={institutionHome}
        loading={loading}
        organization={organization}
        onDelete={handleDelete}
        onRename={handleRename}
        onLeave={handleLeave}
        onShowJoinModal={() => setShowJoinModal(true)}
      />

      {/* Persistent feedback button — fixed bottom-right, opens its own modal. */}
      <FeedbackButton />

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {showJoinModal && (
        <JoinClassModal
          onClose={() => setShowJoinModal(false)}
          variant={joinModalVariant}
        />
      )}

      {renamingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Rename Project</h3>
            <input
              type="text"
              value={renamingValue}
              maxLength={100}
              onChange={(e) => setRenamingValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') { setRenamingId(null); setRenamingValue('') }
              }}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setRenamingId(null); setRenamingValue('') }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={submitRename}
                disabled={!renamingValue.trim()}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Project?</h3>
            <p className="text-sm text-gray-600 mb-6">
              <strong>&ldquo;{confirmDeleteName}&rdquo;</strong> and all its boards will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmDeleteId(null); setConfirmDeleteName('') }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmLeaveId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Leave this project?</h3>
            <p className="text-sm text-gray-600 mb-6">
              You&rsquo;ll lose access to <strong>&ldquo;{confirmLeaveName}&rdquo;</strong> until you&rsquo;re invited again. Boards you created stay with the project.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmLeaveId(null); setConfirmLeaveName('') }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={executeLeave}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 mx-auto mb-4" />
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  )
}
