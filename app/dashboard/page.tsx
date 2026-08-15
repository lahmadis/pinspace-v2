'use client'

import { Suspense, useCallback, useState, useRef, useEffect } from 'react'
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
import { DashboardActionDialogs } from '@/components/dashboard/DashboardActionDialogs'
import { Button, StatusState } from '@/components/ui'

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
  const [renamePending, setRenamePending] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [leavePending, setLeavePending] = useState(false)

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
    const initialScope = saved && valid.includes(saved)
      ? saved === 'wentworth' && !hasOrganization ? 'personal' : saved
      : hasOrganization ? 'wentworth' : 'personal'
    queueMicrotask(() => setCurrentScope(initialScope))
  }, [isLoaded, accountModeLoading, orgResolved, hasOrganization])

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchUserStudios = useCallback(async () => {
    try {
      setLoading(true)
      setFetchError(false)
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
  }, [router])

  useEffect(() => {
    if (authStatus === 'unauthenticated') { router.push('/sign-in'); return }
    if (authStatus === 'authenticated') {
      const fetchTimer = window.setTimeout(() => void fetchUserStudios(), 0)
      return () => window.clearTimeout(fetchTimer)
    }
  }, [authStatus, fetchUserStudios, router])

  // Institution from URL / sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedInstitution = window.sessionStorage.getItem(INSTITUTION_STORAGE_KEY) || null
      queueMicrotask(() => setInstitutionHome(storedInstitution))
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
      queueMicrotask(() => setInstitutionHome((prev) => prev || fromUrl))
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
  }, [user?.id, searchParams, router, setProfile])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleDelete = (id: string, name: string) => {
    setConfirmDeleteId(id)
    setConfirmDeleteName(name)
  }

  const executeDelete = async () => {
    if (!confirmDeleteId || deletePending) return
    try {
      setDeletePending(true)
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
      setDeletePending(false)
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
    if (!confirmLeaveId || leavePending) return
    try {
      setLeavePending(true)
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
      setLeavePending(false)
      setConfirmLeaveId(null)
      setConfirmLeaveName('')
    }
  }

  const submitRename = async () => {
    if (!renamingId || !renamingValue.trim() || renamePending) return
    try {
      setRenamePending(true)
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
      setRenamePending(false)
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

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isLoaded) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <StatusState status="loading" title="Loading dashboard" description="Getting your projects ready." />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <StatusState
          status="error"
          title="Failed to load your projects"
          description="Check your connection and try again."
          action={<Button type="button" onClick={fetchUserStudios}>Try again</Button>}
          className="w-full max-w-md"
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh max-w-full overflow-x-clip bg-background">
      <DashboardSidebar
        currentScope={currentScope}
        onScopeChange={handleScopeChange}
        hasOrganization={hasOrganization}
        orgName={organization?.name}
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
        <JoinClassModal onClose={() => setShowJoinModal(false)} />
      )}

      <DashboardActionDialogs
        rename={renamingId ? { id: renamingId, value: renamingValue } : null}
        deletion={confirmDeleteId ? { id: confirmDeleteId, name: confirmDeleteName } : null}
        leave={confirmLeaveId ? { id: confirmLeaveId, name: confirmLeaveName } : null}
        renamePending={renamePending}
        deletePending={deletePending}
        leavePending={leavePending}
        onRenameChange={setRenamingValue}
        onCancelRename={() => { setRenamingId(null); setRenamingValue('') }}
        onSubmitRename={submitRename}
        onCancelDelete={() => { setConfirmDeleteId(null); setConfirmDeleteName('') }}
        onConfirmDelete={executeDelete}
        onCancelLeave={() => { setConfirmLeaveId(null); setConfirmLeaveName('') }}
        onConfirmLeave={executeLeave}
      />
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background p-6">
          <StatusState status="loading" title="Loading dashboard" description="Getting your projects ready." />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  )
}
