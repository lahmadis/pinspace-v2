'use client'

import Link from 'next/link'
import { toast } from '@/lib/toast'
import { useEffect, useState, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Workspace } from '@/types'
import JoinClassModal from '@/components/JoinClassModal'
import { useAccountMode } from '@/lib/useAccountMode'
import { useAuthSession } from '@/hooks/useAuthSession'

const INSTITUTION_STORAGE_KEY = 'pinspace_institution'
import {
  GraduationCap,
  Building2,
  Plus,
  UserPlus,
  MoreVertical,
  Settings,
  Trash2,
  ExternalLink,
  Pencil,
  Archive,
  Network,
  Users
} from 'lucide-react'

type DashboardOrganization = {
  id?: string
  name: string
  slug: string
  type?: string | null
}

function shortOrgName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

interface Studio {
  id: string
  name: string
  boardCount: number
  createdAt: string
}

type DashboardWorkspace = Workspace & {
  owner_id?: string
  type?: string
  board_count?: number
  created_at?: string
  description?: string
  is_archived?: boolean
}

interface WorkspaceCardProps {
  workspace: DashboardWorkspace
  isOwner: boolean
  onDelete: (id: string, name: string) => void
  onRename: (id: string, currentName: string) => void
  openMenuId: string | null
  setOpenMenuId: (id: string | null) => void
  institutionSlug: string | null
}

function withInstitution(path: string, institutionSlug: string | null): string {
  if (!institutionSlug) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}institution=${encodeURIComponent(institutionSlug)}`
}

function WorkspaceCard({ workspace, isOwner, onDelete, onRename, openMenuId, setOpenMenuId, institutionSlug }: WorkspaceCardProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const isMenuOpen = openMenuId === workspace.id

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null)
      }
    }
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isMenuOpen, setOpenMenuId])

  const isArchived = Boolean(workspace.is_archived)

  return (
    <div className={`group bg-white rounded-xl border overflow-hidden transition-all duration-200 ${isArchived ? 'opacity-60 border-gray-200' : 'border-gray-200 hover:shadow-md hover:-translate-y-0.5'}`}>
      {/* Header */}
      <div className={`p-6 border-b border-gray-100 ${isArchived ? 'bg-gray-50' : 'bg-gradient-to-br from-indigo-50 to-blue-50'}`}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isArchived ? 'bg-gray-100' : 'bg-indigo-100'}`}>
              <GraduationCap className={`w-5 h-5 ${isArchived ? 'text-gray-400' : 'text-indigo-600'}`} />
            </div>
            {isArchived && (
              <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded-md text-xs font-medium flex items-center gap-1">
                <Archive className="w-3 h-3" />
                Archived
              </span>
            )}
            {isOwner && !isArchived && (
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-md text-xs font-medium">
                Owner
              </span>
            )}
          </div>
          {isOwner && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setOpenMenuId(isMenuOpen ? null : workspace.id)
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {isMenuOpen && (
                <div className="absolute right-0 top-9 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                  <Link
                    href={withInstitution(`/workspace/${workspace.id}/settings`, institutionSlug)}
                    onClick={() => setOpenMenuId(null)}
                    className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </Link>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onRename(workspace.id, workspace.name || 'Unnamed Workspace')
                      setOpenMenuId(null)
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    Rename
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onDelete(workspace.id, workspace.name || 'Unnamed Workspace')
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Studio
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1.5">
          {workspace.name || 'Unnamed Workspace'}
        </h3>
        <p className="text-sm text-gray-500 mb-2">
          {workspace.description || 'No description'}
        </p>
        {workspace.created_at && (
          <p className="text-xs text-gray-400">
            Created {new Date(workspace.created_at).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Content. Phase 6.2b: clicking opens the rooms list page (/workspace/[id])
          rather than going straight into a 3D studio. The studio is now a room,
          and a workspace can have multiple — let the user pick. */}
      <div className="p-6">
        <Link
          href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm shadow-sm"
        >
          <span>Open</span>
          <ExternalLink className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}

function DashboardContent() {
  const router = useRouter()
  const { status: authStatus, user } = useAuthSession()
  const isLoaded = authStatus !== 'loading'
  const [studios, setStudios] = useState<Studio[]>([])
  const [workspaces, setWorkspaces] = useState<DashboardWorkspace[]>([])
  const [sharedRooms, setSharedRooms] = useState<DashboardWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState('')
  const [fetchError, setFetchError] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/sign-in')
      return
    }
    if (authStatus === 'authenticated') {
      fetchUserStudios()
    }
  }, [authStatus, router])

  const fetchUserStudios = async () => {
    try {
      setLoading(true)
      
      // Fetch workspaces (both classes and personal rooms)
      const workspacesRes = await fetch('/api/workspaces')
      if (workspacesRes.ok) {
        const data = await workspacesRes.json()
        // API returns array directly, not {workspaces: []}
        const workspacesArray = Array.isArray(data) ? data : (data.workspaces || [])

        // Separate workspaces by type
        const classWorkspaces = workspacesArray.filter((w: { type?: string }) => w.type === 'class')
        const sharedWorkspaces = workspacesArray.filter((w: { type?: string }) => w.type === 'shared')
        const personalRooms = workspacesArray.filter((w: { type?: string }) => w.type === 'personal')

        setWorkspaces(classWorkspaces)
        setSharedRooms(sharedWorkspaces)

        // Convert personal rooms to studios format
        const personalStudios = personalRooms.map((w: { id: string; name: string; board_count?: number; created_at?: string }) => ({
          id: w.id,
          name: w.name,
          boardCount: w.board_count ?? 0,
          createdAt: w.created_at || new Date().toISOString()
        }))
        
        setStudios(personalStudios)
      } else if (workspacesRes.status === 401) {
        // Not authenticated, redirect to sign-in
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

  const handleDeleteWorkspace = (workspaceId: string, workspaceName: string) => {
    setConfirmDeleteId(workspaceId)
    setConfirmDeleteName(workspaceName)
    setOpenMenuId(null)
  }

  const executeDeleteWorkspace = async () => {
    if (!confirmDeleteId) return
    try {
      const res = await fetch(`/api/workspaces/${confirmDeleteId}`, { method: 'DELETE' })
      if (res.ok) {
        fetchUserStudios()
        toast.success('Studio deleted')
      } else {
        const error = await res.json()
        toast.error(`Failed to delete studio: ${error.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error deleting workspace:', err)
      toast.error('Failed to delete studio. Please try again.')
    } finally {
      setConfirmDeleteId(null)
      setConfirmDeleteName('')
    }
  }

  const handleRenameWorkspace = (workspaceId: string, currentName: string) => {
    setRenamingId(workspaceId)
    setRenamingValue(currentName)
    setOpenMenuId(null)
  }

  const submitRename = async () => {
    if (!renamingId || !renamingValue.trim()) return
    try {
      const res = await fetch(`/api/workspaces/${renamingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renamingValue.trim() })
      })
      if (res.ok) {
        fetchUserStudios()
        toast.success('Studio renamed')
      } else {
        const error = await res.json()
        toast.error(`Failed to rename: ${error.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error renaming workspace:', err)
      toast.error('Failed to rename studio. Please try again.')
    } finally {
      setRenamingId(null)
      setRenamingValue('')
    }
  }

  const searchParams = useSearchParams()
  const [institutionHome, setInstitutionHome] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [organization, setOrganization] = useState<DashboardOrganization | null>(null)
  const [firstName, setFirstName] = useState<string | null>(null)
  const { mode: accountMode, loading: accountModeLoading } = useAccountMode(user?.id, user?.email)
  const showSharedSection = accountMode !== 'personal'
  const sharedNoun = accountMode === 'firm' ? 'Room' : 'Class'
  const sharedSectionTitle = accountMode === 'firm' ? 'My Firm Rooms' : 'My Classes'
  const sharedSectionSubtitle =
    accountMode === 'firm'
      ? 'Shared studio spaces with your firm'
      : 'Shared studio spaces with your instructors and classmates'
  const sharedEmptyTitle = accountMode === 'firm' ? 'No rooms yet' : 'No classes yet'
  const sharedEmptyHint =
    accountMode === 'firm'
      ? 'Join a room with an invite code or create your own to get started'
      : 'Join a class with an invite code or create your own to get started'
  const joinModalVariant: 'class' | 'room' = accountMode === 'firm' ? 'room' : 'class'
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const slug = window.sessionStorage.getItem(INSTITUTION_STORAGE_KEY)
      setInstitutionHome(slug || null)
    }
  }, [])
  // Keep URL in sync with institution: if we have institution in context, ensure it's in the URL
  useEffect(() => {
    if (!institutionHome) return
    const inUrl = searchParams?.get('institution')
    if (inUrl === institutionHome) return
    router.replace(`/dashboard?institution=${encodeURIComponent(institutionHome)}`, { scroll: false })
  }, [institutionHome, searchParams, router])
  // When landing with ?institution= in URL, persist to sessionStorage
  useEffect(() => {
    const fromUrl = searchParams?.get('institution')
    if (fromUrl && typeof window !== 'undefined') {
      window.sessionStorage.setItem(INSTITUTION_STORAGE_KEY, fromUrl)
      setInstitutionHome((prev) => prev || fromUrl)
    }
  }, [searchParams])
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
      if (org?.slug && org?.name) {
        setOrganization({ id: org.id, name: org.name, slug: org.slug, type: org.type ?? null })
      } else {
        setOrganization(null)
      }
      const fullName = typeof profile?.full_name === 'string' ? profile.full_name.trim() : ''
      setFirstName(fullName ? fullName.split(/\s+/)[0] : null)
    }).catch(() => setIsAdmin(false))
  }, [user?.id, searchParams, router])

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-6">
          <p className="text-gray-900 font-semibold mb-2">Failed to load your workspaces</p>
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href={institutionHome ? `/i/${institutionHome}` : '/'} className="hover:opacity-80 transition-opacity inline-block">
            <h1 className="text-2xl font-semibold text-gray-900">PinSpace</h1>
            <p className="text-sm text-gray-500 mt-0.5">3D Studio Network</p>
          </Link>
          <div className="flex items-center gap-4">
            {organization?.slug && (
              <Link
                href={`/explore?institution=${encodeURIComponent(organization.slug)}`}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                <Network className="w-4 h-4" />
                {shortOrgName(organization.name)} Network
              </Link>
            )}
            {isAdmin && (
              <Link
                href="/admin"
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
              >
                Admin
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-16">
        {/* Welcome Section */}
        <div className="mb-16">
          <h2 className="text-3xl font-semibold text-gray-900 mb-2">
            Welcome back, {firstName || user?.email?.split('@')[0] || 'there'}
          </h2>
          <p className="text-base text-gray-600">
            Manage your studios and showcase your work
          </p>
        </div>

        {/* Network discovery card */}
        {organization?.slug && showSharedSection && !accountModeLoading && (
          <div className="mb-12">
            <Link
              href={`/explore?institution=${encodeURIComponent(organization.slug)}`}
              className="group flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-6 transition-all hover:border-indigo-500/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/10"
            >
              <div className="min-w-0">
                <h3 className="text-xl font-semibold text-white">
                  Explore the {shortOrgName(organization.name)} network
                </h3>
                <p className="text-sm text-slate-300 mt-1">
                  Browse studios across your {accountMode === 'firm' ? 'firm' : 'school'}
                </p>
              </div>
              <Network className="w-8 h-8 text-indigo-400 transition-transform group-hover:scale-110 shrink-0" />
            </Link>
          </div>
        )}

        {/* Shared (Classes / Firm Rooms) Section */}
        {showSharedSection && !accountModeLoading && (
        <div className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2.5 mb-1.5">
                <GraduationCap className="w-5 h-5 text-indigo-600" />
                {sharedSectionTitle}
              </h3>
              <p className="text-sm text-gray-500">
                {sharedSectionSubtitle}
              </p>
            </div>
            <div className="flex gap-2.5">
              {workspaces.some(w => w.is_archived) && (
                <button
                  onClick={() => setShowArchived(v => !v)}
                  className={`px-4 py-2 border rounded-lg transition-colors font-medium text-sm flex items-center gap-2 ${showArchived ? 'border-gray-400 bg-gray-100 text-gray-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                >
                  <Archive className="w-4 h-4" />
                  {showArchived ? 'Hide Archived' : 'Show Archived'}
                </button>
              )}
              <button
                onClick={() => setShowJoinModal(true)}
                className="px-4 py-2 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors font-medium text-sm flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Join a {sharedNoun}
              </button>
              <Link
                href={withInstitution('/workspace/new', institutionHome)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Create a {sharedNoun}
              </Link>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-xl p-8 border border-gray-200 animate-pulse">
                  <div className="h-32 bg-gray-100 rounded-lg mb-4"></div>
                  <div className="h-5 bg-gray-100 rounded mb-2"></div>
                  <div className="h-4 bg-gray-100 rounded w-2/3"></div>
                </div>
              ))}
            </div>
          ) : (() => {
            const visibleWorkspaces = showArchived ? workspaces : workspaces.filter(w => !w.is_archived)
            return visibleWorkspaces.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 mb-4">
                  <GraduationCap className="w-8 h-8 text-indigo-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{sharedEmptyTitle}</h3>
                <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">{sharedEmptyHint}</p>
                <div className="flex gap-2.5 justify-center">
                  <button
                    onClick={() => setShowJoinModal(true)}
                    className="px-4 py-2 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors font-medium text-sm flex items-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    Join a {sharedNoun}
                  </button>
                  <Link
                    href={withInstitution('/workspace/new', institutionHome)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Create a {sharedNoun}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {visibleWorkspaces.map((workspace) => (
                  <WorkspaceCard
                    key={workspace.id}
                    workspace={workspace}
                    isOwner={workspace.owner_id === user?.id}
                    onDelete={handleDeleteWorkspace}
                    onRename={handleRenameWorkspace}
                    openMenuId={openMenuId}
                    setOpenMenuId={setOpenMenuId}
                    institutionSlug={institutionHome}
                  />
                ))}
              </div>
            )
          })()}
        </div>
        )}

        {/* Shared Rooms Section — visible to all users */}
        <div className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2.5 mb-1.5">
                <Users className="w-5 h-5 text-indigo-600" />
                Shared Rooms
              </h3>
              <p className="text-sm text-gray-500">
                Collaborate with others on shared studio spaces
              </p>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowJoinModal(true)}
                className="px-4 py-2 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors font-medium text-sm flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Join with code
              </button>
              <Link
                href="/workspace/new?type=shared"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Create Shared Room
              </Link>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-xl p-8 border border-gray-200 animate-pulse">
                  <div className="h-32 bg-gray-100 rounded-lg mb-4"></div>
                  <div className="h-5 bg-gray-100 rounded mb-2"></div>
                  <div className="h-4 bg-gray-100 rounded w-2/3"></div>
                </div>
              ))}
            </div>
          ) : sharedRooms.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 mb-4">
                <Users className="w-8 h-8 text-indigo-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No shared rooms yet</h3>
              <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
                Create a shared room to collaborate with others, or join one with an invite code.
              </p>
              <div className="flex gap-2.5 justify-center">
                <button
                  onClick={() => setShowJoinModal(true)}
                  className="px-4 py-2 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors font-medium text-sm flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  Join with code
                </button>
                <Link
                  href="/workspace/new?type=shared"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  Create Shared Room
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sharedRooms.map((workspace) => (
                <WorkspaceCard
                  key={workspace.id}
                  workspace={workspace}
                  isOwner={workspace.owner_id === user?.id}
                  onDelete={handleDeleteWorkspace}
                  onRename={handleRenameWorkspace}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  institutionSlug={institutionHome}
                />
              ))}
            </div>
          )}
        </div>

        {/* Personal network card */}
        {!accountModeLoading && studios.length > 0 && (
          <div className="mb-12">
            <Link
              href="/network"
              className="group flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-6 transition-all hover:border-indigo-500/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/10"
            >
              <div className="min-w-0">
                <h3 className="text-xl font-semibold text-white">Your personal network</h3>
                <p className="text-sm text-slate-300 mt-1">See your personal rooms as a bubble network</p>
              </div>
              <Network className="w-8 h-8 text-indigo-400 transition-transform group-hover:scale-110 shrink-0" />
            </Link>
          </div>
        )}

        {/* Shared network card */}
        {!accountModeLoading && sharedRooms.length > 0 && (
          <div className="mb-12">
            <Link
              href="/network/shared"
              className="group flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-6 transition-all hover:border-indigo-500/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/10"
            >
              <div className="min-w-0">
                <h3 className="text-xl font-semibold text-white">Your shared network</h3>
                <p className="text-sm text-slate-300 mt-1">See your shared rooms as a bubble network</p>
              </div>
              <Network className="w-8 h-8 text-indigo-400 transition-transform group-hover:scale-110 shrink-0" />
            </Link>
          </div>
        )}

        {/* My Personal Rooms Section */}
        <div className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2.5 mb-1.5">
                <Building2 className="w-5 h-5 text-gray-700" />
                My Personal Rooms
              </h3>
              <p className="text-sm text-gray-500">
                Individual studio spaces for your personal work
              </p>
            </div>
            <Link
              href={withInstitution('/studio/new', institutionHome)}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Create New Room
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-xl p-8 border border-gray-200 animate-pulse">
                  <div className="h-40 bg-gray-100 rounded-lg mb-4"></div>
                  <div className="h-5 bg-gray-100 rounded mb-2"></div>
                  <div className="h-4 bg-gray-100 rounded w-2/3"></div>
                </div>
              ))}
            </div>
          ) : studios.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                <Building2 className="w-8 h-8 text-gray-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No personal rooms yet</h3>
              <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">Create a personal studio space to organize your individual work and projects</p>
              <Link
                href={withInstitution('/studio/new', institutionHome)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium text-sm shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Create Room
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {studios.map((studio) => (
                <Link
                  key={studio.id}
                  href={withInstitution(`/workspace/${studio.id}`, institutionHome)}
                  className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                >
                  {/* Thumbnail */}
                  <div className="h-40 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center group-hover:from-gray-100 group-hover:to-gray-200 transition-colors">
                    <Building2 className="w-12 h-12 text-gray-400 group-hover:text-gray-500 transition-colors" />
                  </div>
                  
                  {/* Content */}
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-gray-700 transition-colors">
                      {studio.name}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                          <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                        {studio.boardCount} boards
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Join Class / Room Modal */}
      {showJoinModal && (
        <JoinClassModal
          onClose={() => setShowJoinModal(false)}
          variant={joinModalVariant}
        />
      )}

      {/* Rename Modal */}
      {renamingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Rename Studio</h3>
            <input
              type="text"
              value={renamingValue}
              onChange={(e) => setRenamingValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { setRenamingId(null); setRenamingValue('') } }}
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

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Studio?</h3>
            <p className="text-sm text-gray-600 mb-6">
              <strong>{'"'}{confirmDeleteName}{'"'}</strong> and all its boards will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmDeleteId(null); setConfirmDeleteName('') }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={executeDeleteWorkspace}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Delete
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
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
