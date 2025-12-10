'use client'

import { supabase } from '@/lib/supabase/client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Workspace } from '@/types'
import JoinClassModal from '@/components/JoinClassModal'

interface Studio {
  id: string
  name: string
  boardCount: number
  createdAt: string
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [studios, setStudios] = useState<Studio[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [showJoinModal, setShowJoinModal] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
      fetchUserStudios()
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#4444ff]/20 border-t-[#4444ff] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <h1 className="text-2xl font-bold text-gray-900">PinSpace</h1>
            <p className="text-sm text-gray-600">3D Studio Network</p>
          </Link>
          
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.href = '/')}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Welcome Section */}
        <div className="mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-2">
            Welcome back, {user?.user_metadata?.email?.split('@')[0] || 'there'}! 👋
          </h2>
          <p className="text-lg text-gray-600">
            Manage your architecture studios and showcase your work
          </p>
        </div>

        {/* My Classes Section */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <span>🎓</span>
                My Classes
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Shared studio spaces with your instructors and classmates
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowJoinModal(true)}
                className="px-4 py-2 border border-[#4444ff] text-[#4444ff] rounded-lg hover:bg-[#4444ff] hover:text-white transition-colors font-medium flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                  <path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path>
                </svg>
                Join a Class
              </button>
              <Link
                href="/workspace/new"
                className="px-4 py-2 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] transition-colors font-medium flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                  <path d="M12 4v16m8-8H4"></path>
                </svg>
                Create a Class
              </Link>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2].map(i => (
                <div key={i} className="bg-white rounded-xl p-6 shadow-sm animate-pulse">
                  <div className="h-32 bg-gray-200 rounded-lg mb-4"></div>
                  <div className="h-6 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </div>
              ))}
            </div>
          ) : workspaces.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="text-5xl mb-3">🎓</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No classes yet</h3>
              <p className="text-sm text-gray-600 mb-4">Join a class or create one to get started</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowJoinModal(true)}
                  className="px-4 py-2 border border-[#4444ff] text-[#4444ff] rounded-lg hover:bg-[#4444ff] hover:text-white transition-colors font-medium"
                >
                  Join a Class
                </button>
                <Link
                  href="/workspace/new"
                  className="px-4 py-2 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] transition-colors font-medium"
                >
                  Create a Class
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {workspaces.map((workspace: any) => {
                // Check if user is the owner
                const isOwner = workspace.owner_id === user?.id
                
                return (
                  <div
                    key={workspace.id}
                    className="bg-white rounded-xl shadow-sm hover:shadow-lg transition-all duration-200 border border-gray-200 overflow-hidden"
                  >
                    {/* Header */}
                    <div className="bg-gradient-to-br from-blue-500 to-indigo-500 p-6 text-white">
                      <div className="flex items-start justify-between mb-2">
                        <div className="text-3xl">🎓</div>
                        {isOwner && (
                          <span className="px-2 py-1 bg-white/20 rounded text-xs font-semibold">
                            Owner
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-bold mb-1">
                        {workspace.name || 'Unnamed Workspace'}
                      </h3>
                      <p className="text-sm text-blue-100">
                        {workspace.description || 'No description'}
                      </p>
                      {workspace.created_at && (
                        <p className="text-xs text-blue-200 mt-1">
                          Created {new Date(workspace.created_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-3">
                      <Link
                        href={`/studio/${workspace.id}`}
                        className="block w-full px-4 py-3 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] transition-colors font-semibold text-center"
                      >
                        Open Studio
                      </Link>
                      {isOwner && (
                        <Link
                          href={`/workspace/${workspace.id}/settings`}
                          className="block w-full px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold text-center"
                        >
                          Settings
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* My Personal Rooms Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <span>🏛️</span>
                My Personal Rooms
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Individual studio spaces for your personal work
              </p>
            </div>
            <Link
              href="/studio/new"
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M12 4v16m8-8H4"></path>
              </svg>
              Create New Room
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2].map(i => (
                <div key={i} className="bg-white rounded-xl p-6 shadow-sm animate-pulse">
                  <div className="h-40 bg-gray-200 rounded-lg mb-4"></div>
                  <div className="h-6 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </div>
              ))}
            </div>
          ) : studios.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="text-5xl mb-3">🏛️</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No personal rooms yet</h3>
              <p className="text-sm text-gray-600 mb-4">Create a room to organize your individual work</p>
              <Link
                href="/studio/new"
                className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
              >
                <svg className="w-5 h-5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                  <path d="M12 4v16m8-8H4"></path>
                </svg>
                Create Room
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {studios.map((studio) => (
                <Link
                  key={studio.id}
                  href={`/studio/${studio.id}`}
                  className="group bg-white rounded-xl shadow-sm hover:shadow-lg transition-all duration-200 overflow-hidden border border-gray-100"
                >
                  {/* Thumbnail */}
                  <div className="h-48 bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-6xl group-hover:scale-105 transition-transform">
                    🏛️
                  </div>
                  
                  {/* Content */}
                  <div className="p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-indigo-600 transition-colors">
                      {studio.name}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span className="flex items-center gap-1">
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

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="text-4xl mb-3">📊</div>
            <h4 className="font-semibold text-gray-900 mb-2">Analytics</h4>
            <p className="text-sm text-gray-600">View engagement and feedback metrics</p>
            <button className="mt-4 text-sm text-[#4444ff] font-medium hover:underline">
              Coming soon
            </button>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="text-4xl mb-3">👥</div>
            <h4 className="font-semibold text-gray-900 mb-2">Collaborators</h4>
            <p className="text-sm text-gray-600">Invite others to your studios</p>
            <button className="mt-4 text-sm text-[#4444ff] font-medium hover:underline">
              Coming soon
            </button>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div className="text-4xl mb-3">⚙️</div>
            <h4 className="font-semibold text-gray-900 mb-2">Settings</h4>
            <p className="text-sm text-gray-600">Manage your account and preferences</p>
            <button className="mt-4 text-sm text-[#4444ff] font-medium hover:underline">
              Coming soon
            </button>
          </div>
        </div>
      </div>

      {/* Join Class Modal */}
      {showJoinModal && <JoinClassModal onClose={() => setShowJoinModal(false)} />}
    </div>
  )
}

