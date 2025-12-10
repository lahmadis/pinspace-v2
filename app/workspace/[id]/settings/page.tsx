'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import Link from 'next/link'
import { Workspace } from '@/types'
import dynamic from 'next/dynamic'
import PublishConfirmModal from '@/components/PublishConfirmModal'

const QRCodeSVG = dynamic(() => import('qrcode.react').then(mod => mod.QRCodeSVG), { ssr: false })

export default function WorkspaceSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const workspaceId = params.id as string
  
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null)
      setIsLoaded(true)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
      setIsLoaded(true)
    })
    
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (isLoaded && user) {
      fetchWorkspace()
    }
  }, [isLoaded, user, workspaceId])

  const fetchWorkspace = async () => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMsg = errorData.error || errorData.details || 'Failed to fetch workspace'
        throw new Error(errorMsg)
      }

      const data = await response.json()
      if (!data.workspace) {
        throw new Error('Workspace data not found in response')
      }
      setWorkspace(data.workspace)
    } catch (error: any) {
      console.error('Error fetching workspace:', error)
      const errorMsg = error?.message || 'Failed to load workspace'
      alert(errorMsg)
      router.push('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  const inviteLink = workspace 
    ? `${window.location.origin}/join/${workspace.inviteCode}`
    : ''

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleGoToStudio = () => {
    if (workspace) {
      router.push(`/studio/${workspace.studioId}`)
    }
  }

  const handlePublish = async (networkMetadata?: { department: string; year: string; instructor?: string }) => {
    if (!workspace) return

    try {
      setPublishing(true)
      setPublishError(null)
      setShowPublishModal(false)

      const response = await fetch(`/api/workspaces/${workspace.id}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPublic: true,
          networkMetadata: {
            department: networkMetadata?.department,
            year: networkMetadata?.year,
          },
          instructor: networkMetadata?.instructor,
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update workspace')
      }

      console.log('🌐 Published workspace with metadata', data.workspace.networkMetadata)
      
      // Refresh workspace data
      await fetchWorkspace()
    } catch (error) {
      console.error('Error:', error)
      setPublishError(error instanceof Error ? error.message : 'Failed to update workspace')
      alert(error instanceof Error ? error.message : 'Failed to update workspace')
    } finally {
      setPublishing(false)
    }
  }

  const handleUnpublish = async () => {
    if (!workspace) return

    try {
      setPublishing(true)
      setPublishError(null)
      setShowPublishModal(false)

      const response = await fetch(`/api/workspaces/${workspace.id}/publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPublic: false
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update workspace')
      }

      console.log('🔒 Unpublished workspace')
      
      // Refresh workspace data
      await fetchWorkspace()
    } catch (error) {
      console.error('Error:', error)
      setPublishError(error instanceof Error ? error.message : 'Failed to update workspace')
      alert(error instanceof Error ? error.message : 'Failed to update workspace')
    } finally {
      setPublishing(false)
    }
  }

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#4444ff]/20 border-t-[#4444ff] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading workspace...</p>
        </div>
      </div>
    )
  }

  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Workspace not found</p>
        </div>
      </div>
    )
  }

  const isInstructor = workspace.members.find(m => m.userId === user?.id)?.role === 'instructor'

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-gray-600" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                  <path d="M15 19l-7-7 7-7"></path>
                </svg>
              </button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{workspace.name}</h1>
              <p className="text-sm text-gray-600">Workspace Settings</p>
            </div>
          </div>
          
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.href = '/')}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Invite Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span>📨</span>
                Invite Students
              </h2>
              
              <p className="text-gray-600 mb-4">
                Share this link or QR code with students to join your workspace
              </p>

              {/* Invite Link */}
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inviteLink}
                    readOnly
                    className="flex-1 px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg font-mono text-sm"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-6 py-3 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] transition-colors font-semibold whitespace-nowrap"
                  >
                    {copied ? '✓ Copied!' : 'Copy Link'}
                  </button>
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="font-semibold">Invite Code:</span>
                  <code className="px-3 py-1 bg-gray-100 rounded text-[#4444ff] font-mono font-bold">
                    {workspace.inviteCode}
                  </code>
                </div>
              </div>

              {/* QR Code */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-sm text-gray-600 mb-3">Or scan this QR code:</p>
                <div className="inline-block p-4 bg-white border-2 border-gray-200 rounded-lg">
                  <QRCodeSVG 
                    value={inviteLink} 
                    size={200}
                    level="M"
                    includeMargin={false}
                  />
                </div>
              </div>
            </div>

            {/* Public Network Settings - Only for Instructors */}
            {isInstructor && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <span>{workspace.isPublic ? '🌐' : '🔒'}</span>
                  Public Network
                </h2>
                
                <div className="space-y-4">
                  {/* Status Display */}
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${workspace.isPublic ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {workspace.isPublic ? '🌐 Published to WIT Network' : '🔒 Private'}
                      </p>
                      <p className="text-sm text-gray-600">
                        {workspace.isPublic 
                          ? 'Visible in the WIT public network · Anyone can view (read-only)'
                          : 'Only members can access this workspace'
                        }
                      </p>
                    </div>
                  </div>

                  {workspace.isPublic && workspace.publishedAt && (
                    <p className="text-xs text-gray-500">
                      Published {new Date(workspace.publishedAt).toLocaleDateString('en-US', { 
                        month: 'long', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })}
                    </p>
                  )}

                  {/* Publish/Unpublish Button */}
                  <button
                    onClick={() => setShowPublishModal(true)}
                    disabled={publishing}
                    className={`w-full px-4 py-3 rounded-lg transition-all font-semibold ${
                      workspace.isPublic
                        ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                        : 'bg-[#4444ff] text-white hover:bg-[#3333ee]'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {publishing ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
                        Updating...
                      </span>
                    ) : workspace.isPublic ? (
                      '🔒 Remove from Public Network'
                    ) : (
                      '🌐 Publish to Public Network'
                    )}
                  </button>

                  {workspace.isPublic ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex gap-2">
                        <span className="text-lg">💡</span>
                        <div className="text-sm text-blue-900">
                          <p className="font-medium mb-1">Network Details</p>
                          <ul className="text-blue-800 space-y-1">
                            <li>• Department: <strong>{workspace.networkMetadata?.department || '—'}</strong></li>
                            <li>• Year: <strong>{workspace.networkMetadata?.year || '—'}</strong></li>
                            <li>• Instructor: <strong>{(workspace as any).instructor || '—'}</strong></li>
                          </ul>
                          <p className="mt-2 text-xs text-blue-700">
                            Studios with matching details will be connected in the network.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex gap-2">
                        <span className="text-lg">💡</span>
                        <div className="text-sm text-blue-900">
                          <p className="font-medium mb-1">What happens when you publish?</p>
                          <ul className="text-blue-800 space-y-1">
                            <li>• Appears in the WIT public network</li>
                            <li>• Anyone can view boards (read-only)</li>
                            <li>• Only members can edit and add boards</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Members Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span>👥</span>
                Members ({workspace.members.length})
              </h2>

              <div className="space-y-3">
                {workspace.members.map((member) => (
                  <div 
                    key={member.userId}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white font-bold">
                        {member.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{member.name}</p>
                        <p className="text-sm text-gray-600">
                          {member.role === 'instructor' ? '👨‍🏫 Instructor' : '🎓 Student'}
                        </p>
                      </div>
                    </div>
                    <div className="text-sm text-gray-500">
                      Joined {new Date(member.joinedAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Studio Link */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-3">3D Studio</h3>
              <p className="text-sm text-gray-600 mb-4">
                View and edit your shared studio room
              </p>
              <button
                onClick={handleGoToStudio}
                className="w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:from-blue-600 hover:to-indigo-600 transition-all font-semibold"
              >
                Open Studio →
              </button>
            </div>

            {/* Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex gap-2 mb-2">
                <span className="text-xl">💡</span>
                <h4 className="font-semibold text-blue-900">Tips</h4>
              </div>
              <ul className="text-sm text-blue-800 space-y-2">
                <li>• Share the invite link via email or course platform</li>
                <li>• Students need to sign in before joining</li>
                <li>• All members can add boards to the studio</li>
                <li>• Only board owners can edit/delete their boards</li>
              </ul>
            </div>

            {/* Stats */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Workspace Info</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Created</span>
                  <span className="font-medium">
                    {new Date(workspace.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Type</span>
                  <span className="font-medium capitalize">{workspace.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Studio ID</span>
                  <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                    {workspace.studioId}
                  </code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Publish Modal - handles both publish and unpublish */}
      {showPublishModal && workspace && (
        <PublishConfirmModal
          workspaceName={workspace.name}
          isCurrentlyPublic={workspace.isPublic}
          currentMetadata={workspace.networkMetadata ? {
            department: workspace.networkMetadata.department || '',
            year: workspace.networkMetadata.year || '',
            instructor: workspace.instructor || '',
          } : undefined}
          onConfirm={(metadata) => {
            if (workspace.isPublic) {
              handleUnpublish()
            } else if (metadata) {
              handlePublish({
                department: metadata.department,
                year: metadata.year,
                instructor: metadata.instructor,
              })
            }
          }}
          onCancel={() => setShowPublishModal(false)}
        />
      )}
    </div>
  )
}

