'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent, User as AuthUser } from '@supabase/supabase-js'
import Link from 'next/link'
import { toast } from '@/lib/toast'
import { Workspace, Room } from '@/types'
import dynamic from 'next/dynamic'
import {
  ArrowLeft,
  Mail,
  Users,
  Lightbulb,
  Copy,
  Check,
  GraduationCap,
  User,
  ExternalLink,
  Archive,
  ArchiveRestore,
  Download,
  DoorOpen,
  Plus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'

const QRCodeSVG = dynamic(() => import('qrcode.react').then(mod => mod.QRCodeSVG), { ssr: false })

export default function WorkspaceSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const workspaceId = params.id as string
  
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Rooms section state. Phase 6.2a only — UI lives behind isInstructor gate.
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [editingRoomName, setEditingRoomName] = useState('')
  const [addingRoom, setAddingRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [roomBusy, setRoomBusy] = useState<string | null>(null) // id of room currently mutating, or 'new' / 'create'
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user || null)
      setIsLoaded(true)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
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
    } catch (error) {
      console.error('Error fetching workspace:', error)
      const errorMsg = error instanceof Error ? error.message : 'Failed to load workspace'
      toast.error(errorMsg)
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
      // Phase 6.2: send to the rooms list (the new primary navigation
      // surface) rather than dropping straight into the first room's studio.
      router.push(`/workspace/${workspace.id}`)
    }
  }

  const handleArchiveToggle = async (archive: boolean) => {
    if (!workspace) return
    try {
      setArchiving(true)
      setShowArchiveConfirm(false)
      const response = await fetch(`/api/workspaces/${workspace.id}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_archived: archive }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to update workspace')
      await fetchWorkspace()
      toast.success(archive ? 'Workspace archived' : 'Workspace unarchived')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update workspace')
    } finally {
      setArchiving(false)
    }
  }

  const handleExport = async () => {
    if (!workspace) return
    try {
      setExporting(true)
      const response = await fetch(`/api/workspaces/${workspace.id}/export`, {
        credentials: 'include',
      })
      if (!response.ok) {
        let message = 'Failed to export workspace'
        try {
          const data = await response.json()
          if (data?.error) message = data.error
        } catch { /* ignore — non-JSON error */ }
        toast.error(message)
        return
      }
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="?([^"]+)"?/i)
      const filename = match?.[1] || `${workspace.name || 'workspace'}_export.zip`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Export downloaded')
    } catch (error) {
      console.error('Export failed:', error)
      toast.error('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const handleCreateRoom = async () => {
    if (!workspace) return
    const trimmed = newRoomName.trim()
    if (!trimmed) {
      toast.error('Room name required')
      return
    }
    try {
      setRoomBusy('create')
      const response = await fetch(`/api/workspaces/${workspace.id}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Failed to create room')
      setAddingRoom(false)
      setNewRoomName('')
      await fetchWorkspace()
      toast.success(`Created room "${trimmed}"`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create room')
    } finally {
      setRoomBusy(null)
    }
  }

  const handleRenameRoom = async (room: Room) => {
    const trimmed = editingRoomName.trim()
    if (!trimmed) {
      toast.error('Room name required')
      return
    }
    if (trimmed === room.name) {
      setEditingRoomId(null)
      setEditingRoomName('')
      return
    }
    try {
      setRoomBusy(room.id)
      const response = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Failed to rename room')
      setEditingRoomId(null)
      setEditingRoomName('')
      await fetchWorkspace()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rename room')
    } finally {
      setRoomBusy(null)
    }
  }

  const handleSetWallColor = async (room: Room, wallColor: 'grey' | 'white') => {
    // No-op if already this color (avoids a needless PATCH + refetch).
    if ((room.wallColor ?? 'grey') === wallColor) return
    try {
      setRoomBusy(room.id)
      const response = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallColor }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Failed to update wall color')
      await fetchWorkspace()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update wall color')
    } finally {
      setRoomBusy(null)
    }
  }

  const handleConfirmDeleteRoom = async () => {
    if (!roomToDelete) return
    try {
      setRoomBusy(roomToDelete.id)
      const response = await fetch(`/api/rooms/${roomToDelete.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Failed to delete room')
      setRoomToDelete(null)
      await fetchWorkspace()
      toast.success(`Deleted room "${roomToDelete.name}"`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete room')
    } finally {
      setRoomBusy(null)
    }
  }

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading workspace...</p>
        </div>
      </div>
    )
  }

  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">Workspace not found</p>
        </div>
      </div>
    )
  }

  const isInstructor = workspace.members.find(m => m.userId === user?.id)?.role === 'instructor'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{workspace.name}</h1>
              <p className="text-sm text-gray-500 mt-0.5">Workspace Settings</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-8">
            {/* Invite Section — instructors only. The invite link, QR and code
                each hand out class access, so this matches the entry point on
                the rooms-list page, where the Settings link itself sits behind
                isInstructor. It was ungated, so any member reaching this URL
                directly could pass out access to a class they merely belong to. */}
            {isInstructor && (
            <div className="bg-white rounded-xl border border-gray-200 p-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2.5">
                <Mail className="w-5 h-5 text-indigo-600" />
                Invite Students
              </h2>
              
              <p className="text-sm text-gray-500 mb-6">
                Share this link or QR code with students to join your workspace
              </p>

              {/* Invite Link */}
              <div className="space-y-4">
                <div className="flex gap-2.5">
                  <input
                    type="text"
                    value={inviteLink}
                    readOnly
                    className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center gap-2 shadow-sm whitespace-nowrap"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy Link
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2.5 text-sm">
                  <span className="font-medium text-gray-600">Invite Code:</span>
                  <code className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-700 font-mono font-semibold">
                    {workspace.inviteCode}
                  </code>
                </div>
              </div>

              {/* QR Code */}
              <div className="mt-8 pt-8 border-t border-gray-200">
                <p className="text-sm text-gray-500 mb-4">Or scan this QR code:</p>
                <div className="inline-block p-4 bg-white border border-gray-200 rounded-lg">
                  <QRCodeSVG
                    value={inviteLink}
                    size={200}
                    level="M"
                    includeMargin={false}
                  />
                </div>
              </div>
            </div>
            )}

            {/* Rooms Section — instructors only. Publish controls live on the
                rooms-list page (/workspace/[id]) so they sit next to each room
                card; settings keeps room CRUD only. */}
            {isInstructor && (
              <div className="bg-white rounded-xl border border-gray-200 p-8">
                <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2.5">
                  <DoorOpen className="w-5 h-5 text-indigo-600" />
                  Rooms ({workspace.rooms?.length ?? 0})
                </h2>
                <p className="text-sm text-gray-500 mb-6">
                  Each room is its own 3D wall. Use rooms to separate pin-ups, milestones, or reviews.
                </p>

                <div className="space-y-3">
                  {(workspace.rooms ?? []).map((room) => {
                    const isEditing = editingRoomId === room.id
                    const isBusy = roomBusy === room.id
                    return (
                      <div
                        key={room.id}
                        className="flex flex-wrap items-center gap-3 p-4 rounded-lg border bg-gray-50 border-gray-100 transition-colors"
                      >
                        {/* Name (inline editable) */}
                        <div className="flex-1 min-w-[180px]">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingRoomName}
                                maxLength={100}
                                onChange={(e) => setEditingRoomName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameRoom(room)
                                  if (e.key === 'Escape') { setEditingRoomId(null); setEditingRoomName('') }
                                }}
                                disabled={isBusy}
                                autoFocus
                                className="flex-1 px-3 py-1.5 border border-indigo-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <button
                                onClick={() => handleRenameRoom(room)}
                                disabled={isBusy}
                                className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg disabled:opacity-50"
                                aria-label="Save name"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => { setEditingRoomId(null); setEditingRoomName('') }}
                                disabled={isBusy}
                                className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                                aria-label="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-gray-900">{room.name}</p>
                              <button
                                onClick={() => { setEditingRoomId(room.id); setEditingRoomName(room.name) }}
                                disabled={isBusy}
                                className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-white rounded disabled:opacity-50"
                                aria-label="Rename room"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        {!isEditing && (
                          <div className="flex items-center gap-3">
                            {/* Wall color — grey (default) or white. Persists via
                                PATCH /api/rooms/[id] (owner/superadmin enforced
                                server-side); everyone sees the color in the 3D room. */}
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400">Wall</span>
                              <div
                                className="flex items-center rounded-lg border border-gray-200 overflow-hidden"
                                role="group"
                                aria-label="Wall color"
                              >
                                {(['grey', 'white'] as const).map((c) => {
                                  const active = (room.wallColor ?? 'grey') === c
                                  return (
                                    <button
                                      key={c}
                                      onClick={() => handleSetWallColor(room, c)}
                                      disabled={isBusy}
                                      aria-pressed={active}
                                      className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50 ${
                                        active
                                          ? 'bg-indigo-600 text-white'
                                          : 'bg-white text-gray-600 hover:bg-gray-100'
                                      }`}
                                    >
                                      {c}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                            <button
                              onClick={() => setRoomToDelete(room)}
                              disabled={isBusy}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                              aria-label="Delete room"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Add Room input — inline so it doesn't disrupt page flow */}
                <div className="mt-4">
                  {addingRoom ? (
                    <div className="flex items-center gap-2 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <input
                        type="text"
                        value={newRoomName}
                        onChange={(e) => setNewRoomName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateRoom()
                          if (e.key === 'Escape') { setAddingRoom(false); setNewRoomName('') }
                        }}
                        placeholder="e.g. Pin-up 2, Midterm Review"
                        disabled={roomBusy === 'create'}
                        autoFocus
                        className="flex-1 px-3 py-2 border border-indigo-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        onClick={handleCreateRoom}
                        disabled={roomBusy === 'create' || !newRoomName.trim()}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm disabled:opacity-50"
                      >
                        {roomBusy === 'create' ? 'Creating…' : 'Create'}
                      </button>
                      <button
                        onClick={() => { setAddingRoom(false); setNewRoomName('') }}
                        disabled={roomBusy === 'create'}
                        className="p-2 text-gray-500 hover:bg-white rounded-lg disabled:opacity-50"
                        aria-label="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingRoom(true)}
                      className="w-full px-4 py-2.5 border border-dashed border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add Room
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Members Section */}
            <div className="bg-white rounded-xl border border-gray-200 p-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2.5">
                <Users className="w-5 h-5 text-indigo-600" />
                Members ({workspace.members.length})
              </h2>

              <div className="space-y-3 mt-6">
                {workspace.members.map((member) => (
                  <div 
                    key={member.userId}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm">
                        {member.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{member.name}</p>
                        <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-0.5">
                          {member.role === 'instructor' ? (
                            <>
                              <GraduationCap className="w-3.5 h-3.5" />
                              {workspace.type === 'personal' ? 'Owner' : 'Instructor'}
                            </>
                          ) : (
                            <>
                              <User className="w-3.5 h-3.5" />
                              Student
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="text-sm text-gray-400">
                      Joined {new Date(member.joinedAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Archive Section - Instructors only */}
            {isInstructor && (
              <div className="bg-white rounded-xl border border-gray-200 p-8">
                <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2.5">
                  <Archive className="w-5 h-5 text-gray-500" />
                  Archive Workspace
                </h2>

                {workspace.isArchived ? (
                  <div className="space-y-4 mt-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
                      <p className="font-medium mb-1">This workspace is archived.</p>
                      <p className="text-amber-700">
                        Members can view boards but cannot upload new content or leave comments.
                        {workspace.archivedAt && (
                          <> Archived on {new Date(workspace.archivedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.</>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => handleArchiveToggle(false)}
                      disabled={archiving}
                      className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {archiving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Unarchiving...
                        </>
                      ) : (
                        <>
                          <ArchiveRestore className="w-4 h-4" />
                          Unarchive Workspace
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4 mt-4">
                    <p className="text-sm text-gray-500">
                      Archiving puts the workspace in read-only mode. Students can still view boards, but no new uploads or comments are allowed. You can unarchive at any time.
                    </p>
                    {showArchiveConfirm ? (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
                        <p className="text-sm font-medium text-red-900">Archive &ldquo;{workspace.name}&rdquo;?</p>
                        <p className="text-sm text-red-700">This workspace will become view-only. You can unarchive it later.</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleArchiveToggle(true)}
                            disabled={archiving}
                            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium text-sm disabled:opacity-50"
                          >
                            {archiving ? 'Archiving...' : 'Yes, Archive'}
                          </button>
                          <button
                            onClick={() => setShowArchiveConfirm(false)}
                            className="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowArchiveConfirm(true)}
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                      >
                        <Archive className="w-4 h-4" />
                        Archive Workspace
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Rooms Link */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-2">Rooms</h3>
              <p className="text-sm text-gray-500 mb-4">
                View and enter rooms in this workspace
              </p>
              <button
                onClick={handleGoToStudio}
                className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center justify-center gap-2 shadow-sm"
              >
                <span>Open Rooms</span>
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>

            {/* Export — owner only */}
            {workspace.createdBy === user?.id && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-2">Export</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Download all boards in this room as a zip with image files and a manifest.
                </p>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {exporting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                      <span>Preparing zip…</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Download zip</span>
                    </>
                  )}
                </button>
                <p className="text-xs text-gray-400 mt-2">
                  Large rooms may take 10-30 seconds to build.
                </p>
              </div>
            )}

            {/* Info */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <div className="flex gap-3 mb-3">
                <Lightbulb className="w-5 h-5 text-indigo-600 mt-0.5 flex-shrink-0" />
                <h4 className="font-semibold text-indigo-900">Tips</h4>
              </div>
              <ul className="text-sm text-indigo-800 space-y-2">
                {/* Follows the Invite section's gate — without this, members who
                    can no longer see the invite link are still told to share it. */}
                {isInstructor && <li>• Share the invite link via email or course platform</li>}
                <li>• Students need to sign in before joining</li>
                <li>• All members can add boards to the studio</li>
                <li>• Any member of the studio can edit or delete any board.</li>
              </ul>
            </div>

            {/* Stats */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Workspace Info</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span className="font-medium text-gray-900">
                    {new Date(workspace.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className="font-medium text-gray-900 capitalize">{workspace.type}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Studio ID</span>
                  <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700">
                    {workspace.studioId.slice(0, 8)}...
                  </code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Room Confirmation. The DB cascade (boards.room_id ON DELETE
          CASCADE in migration 014) takes the room's boards with it — message
          spells that out so an instructor doesn't lose work by accident. */}
      {roomToDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete room?</h3>
            <p className="text-sm text-gray-700 mb-3">
              <strong>&ldquo;{roomToDelete.name}&rdquo;</strong> will be permanently deleted.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
              <p className="text-sm text-red-800">
                Every board in this room will be deleted along with it. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setRoomToDelete(null)}
                disabled={roomBusy === roomToDelete.id}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteRoom}
                disabled={roomBusy === roomToDelete.id}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50"
              >
                {roomBusy === roomToDelete.id ? 'Deleting…' : 'Delete room'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

