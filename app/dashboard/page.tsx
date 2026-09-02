'use client'

import { Suspense, useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from '@/lib/toast'
import JoinClassModal from '@/components/JoinClassModal'
import FeedbackButton from '@/components/FeedbackButton'
import { useAccountMode } from '@/lib/useAccountMode'
import { useAuthSession } from '@/hooks/useAuthSession'
import { useProfile } from '@/lib/ProfileContext'
import DashboardTopBar from '@/components/dashboard/DashboardTopBar'
import { DashboardMain } from '@/components/dashboard/DashboardMain'
import { scopeConfig } from '@/components/dashboard/dashboardScope'
import CreateSectionModal from '@/components/dashboard/CreateSectionModal'
import type { DashboardWorkspace } from '@/components/dashboard/DashboardMain'
import type { Scope } from '@/components/dashboard/dashboardScope'
import { getOrgBrand } from '@/lib/constants/orgBranding'
import { supabase } from '@/lib/supabase/client'
import { resetAccountModeCache } from '@/lib/useAccountMode'

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
  const { profile, setProfile } = useProfile()

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
  const { mode: accountMode, loading: accountModeLoading, resolved: accountModeResolved } =
    useAccountMode(user?.id, user?.email)

  // UI
  const [showJoinModal, setShowJoinModal] = useState(false)
  /**
   * The new-section dialog.
   *
   * Lifted out of DashboardMain along with the button that opens it: the
   * trigger is in the sidebar now, and a dialog owned by the pane beside it
   * would be a dialog the trigger cannot reach.
   */
  const [showCreateSection, setShowCreateSection] = useState(false)
  /** Which studio the top bar's switcher points at. See currentWorkspace. */
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
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
    // 'shared' is no longer a scope. A saved value of it falls through to the
    // default below rather than sticking someone on a tab that no longer
    // exists — localStorage outlives the release that removed it.
    const valid: Scope[] = ['wentworth', 'personal']
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
      // firstName went with the sidebar's profile row; the avatar menu shows the
      // email, and ProfileContext still carries the full name for everyone else.
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
    // NOT `type === 'personal'`. Migration 041 collapses the old 'shared' type
    // into 'personal', and migrations here are applied by hand — so until it is
    // run, nine real workspaces still carry type='shared' and matching on
    // 'personal' alone would strand every one of them with no tab to reach them
    // from. Anything that is not a class belongs to the person who owns it —
    // except the desk-crit container, which is not a space at all.
    if (currentScope === 'personal') return w.type !== 'class' && w.type !== 'deskcrit'
    return false
  })

  // The sidebar now renders this scope's studio list and its own "New studio"
  // button, so it needs the same create gate and the same hrefs the main pane
  // derives. Both read them from dashboardScope rather than one passing the
  // other's copy down.
  const canCreate = currentScope !== 'wentworth' || profile.accountRole === 'instructor'
  const sidebarCfg = scopeConfig(currentScope, organization, institutionHome, canCreate)

  /**
   * The studio the main pane's Current card is showing — the most recent live
   * one. Resolved HERE rather than in either component because both need it:
   * the card renders it, and the sidebar marks its row with the filled dot. Two
   * copies of "the first non-archived room" would be one refactor away from
   * pointing at different studios.
   */
  /**
   * The studio the page is about — picked in the top bar, not inferred.
   *
   * Held here because both halves need it: the switcher shows which one is
   * chosen and the Current studio card renders it. Null until a choice is made
   * or the list arrives, and the effect below settles it on the newest live
   * studio so the card is never empty on a first load.
   */
  const liveRooms = scopedRooms.filter((w) => !w.is_archived)
  const currentWorkspace =
    liveRooms.find((w) => w.id === selectedWorkspaceId) ?? liveRooms[0] ?? null

  const handleSignOut = async () => {
    resetAccountModeCache()
    await supabase.auth.signOut()
    router.push('/sign-in')
  }

  /**
   * "New" is a dialog on the class tab and a page everywhere else — the class
   * tab asks for a studio, department, year and term at creation (see
   * CreateSectionModal), and the other scopes ask for a name. One button in the
   * sidebar, branching here on the scope's own config rather than the sidebar
   * having to know which scopes have dialogs.
   */
  const handleCreate = () => {
    if (sidebarCfg.newMode === 'section-dialog') setShowCreateSection(true)
    else router.push(sidebarCfg.newHref)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#3B6EF6]/20 border-t-[#3B6EF6] mx-auto mb-4" />
          <p className="text-[#5A5E6B]">Loading...</p>
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
        <div className="text-center max-w-sm px-6">
          <p className="text-[#16181D] font-bold mb-2">Failed to load your projects</p>
          <p className="text-[#8A8FA0] text-sm mb-4">Check your connection and try again.</p>
          <button
            onClick={() => { setFetchError(false); fetchUserStudios() }}
            className="px-5 py-2.5 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] transition-colors text-sm font-bold"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F4F6FA]">
      {/* The bar carries its own gutter (see ChromeBar), so this is only the
          row it sits in. It was briefly bled to the page edges to get the tabs
          over the content column; the column is offset to meet the tabs
          instead, which buys the same alignment and keeps the bar an object on
          the page rather than the page's top edge. */}
      <div className="shrink-0">
        <div className="w-full">
          <DashboardTopBar
            currentScope={currentScope}
            onScopeChange={handleScopeChange}
            hasOrganization={hasOrganization}
            orgLabel={organization?.name?.split(' ')[0] || 'Network'}
            brand={currentScope === 'wentworth' ? getOrgBrand(organization?.slug) : null}
            sections={liveRooms}
            currentWorkspaceId={currentWorkspace?.id ?? null}
            onSelectWorkspace={setSelectedWorkspaceId}
            canCreate={canCreate}
            onCreate={handleCreate}
            createLabel={sidebarCfg.newLabel}
            showJoin={sidebarCfg.showJoin}
            onShowJoinModal={() => setShowJoinModal(true)}
            userEmail={user?.email}
            isAdmin={isAdmin}
            onSignOut={handleSignOut}
            userId={user?.id}
            onRename={handleRename}
            onDelete={handleDelete}
            onLeave={handleLeave}
          />
        </div>
      </div>

      <DashboardMain
        scope={currentScope}
        rooms={scopedRooms}
        institutionHome={institutionHome}
        loading={loading}
        organization={organization}
        currentWorkspaceId={currentWorkspace?.id ?? null}
      />

      {/* Persistent feedback button — fixed bottom-right, opens its own modal. */}
      <FeedbackButton />

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {showJoinModal && (
        <JoinClassModal onClose={() => setShowJoinModal(false)} />
      )}

      {/* Mounted unconditionally under canCreate rather than beside the sidebar
          button: it renders nothing while closed, and hanging it off the button
          would unmount the open dialog the moment creating a section changed
          the list the button sits under. */}
      {canCreate && sidebarCfg.newMode === 'section-dialog' && (
        <CreateSectionModal
          open={showCreateSection}
          onOpenChange={setShowCreateSection}
          defaultInstructorName={profile.fullName}
        />
      )}

      {renamingId && (
        <div className="fixed inset-0 bg-[#16181D]/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-[0_30px_90px_rgba(22,24,29,0.3)] max-w-sm w-full p-7">
            <h3 className="text-lg font-extrabold text-[#16181D] mb-4">Rename Project</h3>
            <input
              type="text"
              value={renamingValue}
              maxLength={100}
              onChange={(e) => setRenamingValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') { setRenamingId(null); setRenamingValue('') }
              }}
              className="w-full px-4 py-3 border border-[#16181D]/[0.12] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setRenamingId(null); setRenamingValue('') }}
                className="flex-1 px-4 py-2.5 border border-[#16181D]/[0.12] text-[#5A5E6B] rounded-full hover:bg-[#16181D]/5 transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={submitRename}
                disabled={!renamingValue.trim()}
                className="flex-1 px-4 py-2.5 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] disabled:opacity-50 transition-colors font-bold"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 bg-[#16181D]/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-[0_30px_90px_rgba(22,24,29,0.3)] max-w-sm w-full p-7">
            <h3 className="text-lg font-extrabold text-[#16181D] mb-2">Delete Project?</h3>
            <p className="text-sm text-[#5A5E6B] mb-6">
              <strong className="text-[#16181D]">&ldquo;{confirmDeleteName}&rdquo;</strong> and all its boards will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmDeleteId(null); setConfirmDeleteName('') }}
                className="flex-1 px-4 py-2.5 border border-[#16181D]/[0.12] text-[#5A5E6B] rounded-full hover:bg-[#16181D]/5 transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                className="flex-1 px-4 py-2.5 bg-[#C2452D] text-white rounded-full hover:bg-[#a5391f] transition-colors font-bold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmLeaveId && (
        <div className="fixed inset-0 bg-[#16181D]/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-[0_30px_90px_rgba(22,24,29,0.3)] max-w-sm w-full p-7">
            <h3 className="text-lg font-extrabold text-[#16181D] mb-2">Leave this project?</h3>
            <p className="text-sm text-[#5A5E6B] mb-6">
              You&rsquo;ll lose access to <strong className="text-[#16181D]">&ldquo;{confirmLeaveName}&rdquo;</strong> until you&rsquo;re invited again. Boards you created stay with the project.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmLeaveId(null); setConfirmLeaveName('') }}
                className="flex-1 px-4 py-2.5 border border-[#16181D]/[0.12] text-[#5A5E6B] rounded-full hover:bg-[#16181D]/5 transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={executeLeave}
                className="flex-1 px-4 py-2.5 bg-[#C2452D] text-white rounded-full hover:bg-[#a5391f] transition-colors font-bold"
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
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#3B6EF6]/20 border-t-[#3B6EF6] mx-auto mb-4" />
            <p className="text-[#5A5E6B]">Loading...</p>
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  )
}
