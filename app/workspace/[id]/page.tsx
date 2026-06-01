'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from '@/lib/toast'
import { Workspace, Room } from '@/types'
import { useAuthSession } from '@/hooks/useAuthSession'
import { useAccountMode } from '@/lib/useAccountMode'
import { useProfile } from '@/lib/ProfileContext'
import PublishConfirmModal, { NetworkMetadata } from '@/components/PublishConfirmModal'
import {
  ArrowLeft,
  Settings,
  DoorOpen,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Globe,
  ChevronRight,
  Network,
} from 'lucide-react'

export default function WorkspaceRoomsPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.id as string

  const { status: authStatus, user } = useAuthSession()
  const { mode: accountMode } = useAccountMode(user?.id, user?.email)
  const { profile } = useProfile()
  const isAuthLoaded = authStatus !== 'loading'
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Owner-only mutation state
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [editingRoomName, setEditingRoomName] = useState('')
  const [addingRoom, setAddingRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [roomBusy, setRoomBusy] = useState<string | null>(null) // room id, or 'create'
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null)

  // Publish modal: null = closed; room = waiting to flip is_published after metadata; 'settings' = editing existing metadata only
  const [publishModalRoom, setPublishModalRoom] = useState<Room | null>(null)
  const [networkSettingsOpen, setNetworkSettingsOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      // Preserve the target so post-login we land back here, which then routes
      // shared-room visitors into the join prompt.
      router.push(`/sign-in?redirect=${encodeURIComponent(`/workspace/${workspaceId}`)}`)
    }
  }, [authStatus, router, workspaceId])

  useEffect(() => {
    if (isAuthLoaded && user) fetchWorkspace()
  }, [isAuthLoaded, user, workspaceId])

  const fetchWorkspace = async () => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`)
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err?.error || 'Failed to load workspace')
      }
      const data = await response.json()
      // Non-member arriving at a shared workspace by link: bounce to the join
      // prompt (/join/{code}) which handles sign-in + membership insertion.
      if (data.canJoin && data.inviteCode) {
        router.replace(`/join/${encodeURIComponent(data.inviteCode)}`)
        return
      }
      if (!data.workspace) throw new Error('Workspace data missing in response')
      setWorkspace(data.workspace)
      setErrorMsg(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load workspace'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  const isInstructor = !!workspace && workspace.members.some(m => m.userId === user?.id && m.role === 'instructor')
  // Publishing to the network is an instructor-only ACCOUNT power, layered on top
  // of workspace ownership. Mirrors the server gate in PATCH /api/rooms/[id].
  const isAccountInstructor = profile.accountRole === 'instructor'
  const canPublish = isInstructor && isAccountInstructor
  // Adding rooms is allowed for any collaborator on a SHARED project, not just
  // the owner. Shared projects join new collaborators as `student`-role members
  // (see /api/workspaces/[id]/join), so an instructor-only gate hides the
  // affordance from people who are explicitly invited to collaborate. Class
  // workspaces keep the instructor-only behavior.
  const isSharedProject = workspace?.type === 'shared'
  const isAnyMember = !!workspace && workspace.members.some(m => m.userId === user?.id)
  const canAddRoom = isInstructor || (isSharedProject && isAnyMember)
  // Phase 10: any workspace member (owner or invited collaborator, any role)
  // may rename rooms. Other room controls (publish, delete) stay owner-only.
  const canRename = isAnyMember

  const handleCreateRoom = async () => {
    const trimmed = newRoomName.trim()
    if (!trimmed) {
      toast.error('Room name required')
      return
    }
    try {
      setRoomBusy('create')
      const res = await fetch(`/api/workspaces/${workspaceId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to create room')
      setAddingRoom(false)
      setNewRoomName('')
      await fetchWorkspace()
      toast.success(`Created room "${trimmed}"`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create room')
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
      const res = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to rename room')
      setEditingRoomId(null)
      setEditingRoomName('')
      await fetchWorkspace()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to rename room')
    } finally {
      setRoomBusy(null)
    }
  }

  const handleConfirmDeleteRoom = async () => {
    if (!roomToDelete) return
    try {
      setRoomBusy(roomToDelete.id)
      const res = await fetch(`/api/rooms/${roomToDelete.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to delete room')
      setRoomToDelete(null)
      await fetchWorkspace()
      toast.success(`Deleted room "${roomToDelete.name}"`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete room')
    } finally {
      setRoomBusy(null)
    }
  }

  const flipRoomPublish = async (room: Room, next: boolean) => {
    setWorkspace((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        rooms: (prev.rooms ?? []).map((r) =>
          r.id === room.id ? { ...r, isPublished: next } : r
        ),
      }
    })
    try {
      const res = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to update room')
      toast.success(next ? `Published "${room.name}" to Wentworth` : `Unpublished "${room.name}"`)
    } catch (e) {
      setWorkspace((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          rooms: (prev.rooms ?? []).map((r) =>
            r.id === room.id ? { ...r, isPublished: !next } : r
          ),
        }
      })
      toast.error(e instanceof Error ? e.message : 'Failed to update room')
    }
  }

  const saveNetworkMetadata = async (metadata: NetworkMetadata): Promise<boolean> => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/network-metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department: metadata.department,
          yearLevel: metadata.year,
          instructor: metadata.instructor,
          academicYear: metadata.academicYear,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to save network metadata')
      // Update local workspace state so subsequent publishes skip the modal
      setWorkspace((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          networkMetadata: {
            department: metadata.department as 'Aerospace Engineering' | 'Architecture' | 'Civil Engineering' | 'Electrical Engineering' | 'Industrial Design' | 'Interior Design' | 'Mechanical Engineering' | 'Robotics Engineering',
            year: metadata.year as 'Year 1' | 'Year 2' | 'Year 3' | 'Year 4' | 'Year 5' | 'Masters',
          },
          academicYear: metadata.academicYear,
          instructor: metadata.instructor,
        }
      })
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save network settings')
      return false
    }
  }

  const handleTogglePublish = async (room: Room) => {
    if (!workspace) return
    const next = !room.isPublished

    if (!next) {
      // Unpublishing — no metadata needed
      await flipRoomPublish(room, false)
      return
    }

    // Publishing ON: check if workspace already has metadata
    const hasMetadata = !!(workspace.networkMetadata?.department && workspace.networkMetadata?.year)
    if (hasMetadata) {
      await flipRoomPublish(room, true)
    } else {
      // First publish in workspace — open modal to collect metadata
      setPublishModalRoom(room)
    }
  }

  const handlePublishModalConfirm = async (metadata?: NetworkMetadata) => {
    setPublishModalRoom(null)
    if (!publishModalRoom || !metadata) return
    const saved = await saveNetworkMetadata(metadata)
    if (saved) {
      await flipRoomPublish(publishModalRoom, true)
    }
  }

  const handleNetworkSettingsConfirm = async (metadata?: NetworkMetadata) => {
    setNetworkSettingsOpen(false)
    if (!metadata) return
    await saveNetworkMetadata(metadata)
    toast.success('Network settings saved')
  }

  if (!isAuthLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading rooms...</p>
        </div>
      </div>
    )
  }

  if (errorMsg || !workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <div className="text-center max-w-sm">
          <p className="text-gray-900 font-semibold mb-2">Failed to load workspace</p>
          <p className="text-gray-500 text-sm mb-4">{errorMsg || 'Unknown error'}</p>
          <Link href="/dashboard" className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium">
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  const rooms = workspace.rooms ?? []
  const instructorName = workspace.members.find(m => m.role === 'instructor')?.name ?? null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Back to Dashboard">
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{workspace.name}</h1>
              {instructorName && (
                <p className="text-sm text-gray-500 mt-0.5">Owner: {instructorName}</p>
              )}
            </div>
          </div>
          {isInstructor && (
            <div className="flex items-center gap-2">
              {accountMode !== 'personal' && canPublish && (
                <button
                  onClick={() => setNetworkSettingsOpen(true)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm flex items-center gap-2"
                  title="Edit network metadata (department, year, instructor)"
                >
                  <Network className="w-4 h-4" />
                  Network
                </button>
              )}
              <Link
                href={`/workspace/${workspaceId}/settings`}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Settings
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Backfill banner — shown to owners with published rooms but missing network metadata */}
      {(() => {
        const hasPublishedRoom = (workspace.rooms ?? []).some((r) => r.isPublished)
        const missingMetadata = !workspace.networkMetadata?.department || !workspace.academicYear
        if (!isInstructor || !hasPublishedRoom || !missingMetadata || bannerDismissed) return null
        return (
          <div className="max-w-5xl mx-auto px-6 pt-6">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start justify-between gap-4">
              <p className="text-sm text-amber-900">
                <strong>This class is published but missing network info.</strong>{' '}
                Add it so students can find your studio on the Wentworth Network.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setNetworkSettingsOpen(true)}
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Add network settings
                </button>
                <button
                  onClick={() => setBannerDismissed(true)}
                  className="p-1.5 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Body */}
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 flex items-center gap-2.5">
            <DoorOpen className="w-6 h-6 text-indigo-600" />
            Rooms
          </h2>
          <p className="text-sm text-gray-500 mt-1.5">
            Click a room to enter its 3D studio.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {rooms.map((room) => {
            const isEditing = editingRoomId === room.id
            const isBusy = roomBusy === room.id
            return (
              <div
                key={room.id}
                className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              >
                {/* Card body — entire card is the click target unless we're inline editing */}
                {isEditing ? (
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-4">
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
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-50"
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
                  </div>
                ) : (
                  <Link
                    href={`/studio/${room.id}`}
                    className="block p-6 cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                        <DoorOpen className="w-5 h-5 text-indigo-600" />
                      </div>
                      {room.isPublished && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-md text-xs font-medium flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          Published
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1.5 group-hover:text-indigo-700 transition-colors">
                      {room.name}
                    </h3>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-500">
                        {(room.boardCount ?? 0)} {(room.boardCount ?? 0) === 1 ? 'board' : 'boards'}
                      </p>
                      <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </Link>
                )}

                {/* Edit affordances. Visible on hover so they don't crowd the
                    card. Hover effects suppressed when editing. Rename is open
                    to any member (Phase 10); publish + delete stay owner-only. */}
                {canRename && !isEditing && (
                  <div className="px-6 pb-4 flex items-center justify-end gap-1 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {accountMode !== 'personal' && canPublish && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleTogglePublish(room) }}
                        disabled={isBusy}
                        className={`p-1.5 rounded-lg disabled:opacity-50 ${
                          room.isPublished
                            ? 'text-green-700 hover:text-gray-700 hover:bg-gray-50'
                            : 'text-gray-500 hover:text-green-700 hover:bg-green-50'
                        }`}
                        aria-label={room.isPublished ? 'Unpublish room' : 'Publish to Wentworth'}
                        title={room.isPublished ? 'Unpublish' : 'Publish to Wentworth'}
                      >
                        <Globe className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingRoomId(room.id); setEditingRoomName(room.name) }}
                      disabled={isBusy}
                      className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-50"
                      aria-label="Rename room"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {isInstructor && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRoomToDelete(room) }}
                        disabled={isBusy}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                        aria-label="Delete room"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Add Room card — owner/instructor on class workspaces; any member on shared projects */}
          {canAddRoom && (
            addingRoom ? (
              <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-6 flex flex-col gap-3">
                <p className="text-sm font-semibold text-indigo-900">Name your new room</p>
                <input
                  type="text"
                  value={newRoomName}
                  maxLength={100}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateRoom()
                    if (e.key === 'Escape') { setAddingRoom(false); setNewRoomName('') }
                  }}
                  placeholder="e.g. Pin-up 2, Midterm Review"
                  disabled={roomBusy === 'create'}
                  autoFocus
                  className="w-full px-3 py-2 border border-indigo-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateRoom}
                    disabled={roomBusy === 'create' || !newRoomName.trim()}
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm disabled:opacity-50"
                  >
                    {roomBusy === 'create' ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    onClick={() => { setAddingRoom(false); setNewRoomName('') }}
                    disabled={roomBusy === 'create'}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingRoom(true)}
                className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors min-h-[180px]"
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <Plus className="w-5 h-5" />
                </div>
                <span className="font-medium text-sm">Add Room</span>
              </button>
            )
          )}
        </div>

        {rooms.length === 0 && !canAddRoom && (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
              <DoorOpen className="w-8 h-8 text-gray-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No rooms yet</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              The instructor hasn&apos;t set up any rooms in this workspace yet. Check back later.
            </p>
          </div>
        )}
      </div>

      {/* Publish confirm modal — shown when publishing first room in workspace */}
      {publishModalRoom && workspace && (
        <PublishConfirmModal
          workspaceName={workspace.name}
          isCurrentlyPublic={false}
          currentMetadata={
            workspace.networkMetadata
              ? {
                  department: workspace.networkMetadata.department,
                  year: workspace.networkMetadata.year,
                  instructor: workspace.instructor || '',
                  academicYear: workspace.academicYear || '',
                }
              : undefined
          }
          onConfirm={handlePublishModalConfirm}
          onCancel={() => setPublishModalRoom(null)}
        />
      )}

      {/* Network settings modal — re-open from header button to edit existing metadata */}
      {networkSettingsOpen && workspace && (
        <PublishConfirmModal
          workspaceName={workspace.name}
          isCurrentlyPublic={false}
          currentMetadata={
            workspace.networkMetadata
              ? {
                  department: workspace.networkMetadata.department,
                  year: workspace.networkMetadata.year,
                  instructor: workspace.instructor || '',
                  academicYear: workspace.academicYear || '',
                }
              : undefined
          }
          onConfirm={handleNetworkSettingsConfirm}
          onCancel={() => setNetworkSettingsOpen(false)}
        />
      )}

      {/* Delete confirmation. Boards in the room cascade-delete via the
          boards.room_id FK. Spell that out so an instructor doesn't lose work
          by accident. */}
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
