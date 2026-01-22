'use client'

import { supabase } from '@/lib/supabase/client'
import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Workspace } from '@/types'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import JoinClassModal from '@/components/JoinClassModal'
import { 
  GraduationCap, 
  Building2, 
  Plus, 
  UserPlus, 
  MoreVertical, 
  Settings, 
  Trash2, 
  ExternalLink
} from 'lucide-react'

interface Studio {
  id: string
  name: string
  boardCount: number
  createdAt: string
}

interface WorkspaceCardProps {
  workspace: any
  isOwner: boolean
  onDelete: (id: string, name: string) => void
  openMenuId: string | null
  setOpenMenuId: (id: string | null) => void
}

function WorkspaceCard({ workspace, isOwner, onDelete, openMenuId, setOpenMenuId }: WorkspaceCardProps) {
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

  return (
    <div className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 border-b border-gray-100">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-indigo-600" />
            </div>
            {isOwner && (
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
                    href={`/workspace/${workspace.id}/settings`}
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

      {/* Content */}
      <div className="p-6">
        <Link
          href={`/studio/${workspace.id}`}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm shadow-sm"
        >
          <span>Open Studio</span>
          <ExternalLink className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [studios, setStudios] = useState<Studio[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
      fetchUserStudios()
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
      fetchUserStudios()
    })
    
    return () => subscription.unsubscribe()
  }, [router])

  const fetchUserStudios = async () => {
    try {
      setLoading(true)
      
      // Fetch workspaces (both classes and personal rooms)
      const workspacesRes = await fetch('/api/workspaces')
      if (workspacesRes.ok) {
        const data = await workspacesRes.json()
        // API returns array directly, not {workspaces: []}
        const workspacesArray = Array.isArray(data) ? data : (data.workspaces || [])
        console.log('Fetched workspaces:', workspacesArray)
        
        // Separate classes from personal rooms
        // Personal rooms: type === 'personal' OR (no type field and owned by user with no members)
        const classes = workspacesArray.filter((w: any) => w.type !== 'personal')
        const personalRooms = workspacesArray.filter((w: any) => w.type === 'personal')
        
        setWorkspaces(classes)
        
        // Convert personal rooms to studios format
        const personalStudios = personalRooms.map((w: any) => ({
          id: w.id,
          name: w.name,
          boardCount: 0, // TODO: fetch actual board count
          createdAt: w.created_at || new Date().toISOString()
        }))
        
        setStudios(personalStudios)
      } else if (workspacesRes.status === 401) {
        // Not authenticated, redirect to sign-in
        router.push('/sign-in')
      } else {
        // Log error for debugging
        const errorData = await workspacesRes.json().catch(() => ({}))
        console.error('Error fetching workspaces:', workspacesRes.status, errorData)
      }
    } catch (err) {
      console.error('Error fetching studios:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteWorkspace = async (workspaceId: string, workspaceName: string) => {
    if (confirm(`Are you sure you want to delete "${workspaceName}"? This action cannot be undone and will delete all boards in this studio.`)) {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}`, {
          method: 'DELETE'
        })
        if (res.ok) {
          fetchUserStudios()
          setOpenMenuId(null)
        } else {
          const error = await res.json()
          alert(`Failed to delete studio: ${error.error || 'Unknown error'}`)
        }
      } catch (err) {
        console.error('Error deleting workspace:', err)
        alert('Failed to delete studio. Please try again.')
      }
    }
  }

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <Link href="/" className="hover:opacity-80 transition-opacity inline-block">
            <h1 className="text-2xl font-semibold text-gray-900">PinSpace</h1>
            <p className="text-sm text-gray-500 mt-0.5">3D Studio Network</p>
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-16">
        {/* Welcome Section */}
        <div className="mb-16">
          <h2 className="text-3xl font-semibold text-gray-900 mb-2">
            Welcome back, {user?.user_metadata?.email?.split('@')[0] || 'there'}
          </h2>
          <p className="text-base text-gray-600">
            Manage your architecture studios and showcase your work
          </p>
        </div>

        {/* My Classes Section */}
        <div className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2.5 mb-1.5">
                <GraduationCap className="w-5 h-5 text-indigo-600" />
                My Classes
              </h3>
              <p className="text-sm text-gray-500">
                Shared studio spaces with your instructors and classmates
              </p>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowJoinModal(true)}
                className="px-4 py-2 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors font-medium text-sm flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Join a Class
              </button>
              <Link
                href="/workspace/new"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Create a Class
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
          ) : workspaces.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 mb-4">
                <GraduationCap className="w-8 h-8 text-indigo-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No classes yet</h3>
              <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">Join a class with an invite code or create your own to get started</p>
              <div className="flex gap-2.5 justify-center">
                <button
                  onClick={() => setShowJoinModal(true)}
                  className="px-4 py-2 border border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors font-medium text-sm flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  Join a Class
                </button>
                <Link
                  href="/workspace/new"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  Create a Class
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {workspaces.map((workspace: any) => (
                <WorkspaceCard
                  key={workspace.id}
                  workspace={workspace}
                  isOwner={workspace.owner_id === user?.id}
                  onDelete={handleDeleteWorkspace}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                />
              ))}
            </div>
          )}
        </div>

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
              href="/studio/new"
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
                href="/studio/new"
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
                  href={`/studio/${studio.id}`}
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

      {/* Join Class Modal */}
      {showJoinModal && <JoinClassModal onClose={() => setShowJoinModal(false)} />}
    </div>
  )
}

