'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from '@/lib/toast'
import { Workspace, Room } from '@/types'
import { useAuthSession } from '@/hooks/useAuthSession'
import { useAccountMode } from '@/lib/useAccountMode'
import { useProfile } from '@/lib/ProfileContext'
import PublishConfirmModal, { NetworkMetadata } from '@/components/PublishConfirmModal'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
  GripVertical,
  UserPlus,
  Contact,
} from 'lucide-react'

export default function WorkspaceRoomsPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.id as string

  const { status: authStatus, user } = useAuthSession()
  const { mode: accountMode, resolved: accountModeResolved } = useAccountMode(user?.id, user?.email)
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
  // In-flight guard for room creation. A ref, not `roomBusy`: the button's
  // disabled state and the Enter handler both read the render's stale value, so a
  // double-click / double-Enter in one tick would fire two create POSTs before a
  // re-render. The ref, set synchronously, stops the second one.
  const creatingRoomRef = useRef(false)
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null)

  // Publish modal: null = closed; room = waiting to flip is_published after metadata; 'settings' = editing existing metadata only
  const [publishModalRoom, setPublishModalRoom] = useState<Room | null>(null)
  const [networkSettingsOpen, setNetworkSettingsOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // Enroll-students-by-email (class owner only)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrollText, setEnrollText] = useState('')
  const [enrollBusy, setEnrollBusy] = useState(false)
  const [enrollResult, setEnrollResult] = useState<{
    enrolled: { email: string; name: string | null }[]
    alreadyMember: string[]
    notFound: string[]
  } | null>(null)

  // --- Drag-to-reorder (owner only) ----------------------------------------
  // `orderedRooms` is the local, reorderable copy the grid renders from, so a
  // drag can reorder instantly without a server round-trip. We reconcile it
  // from workspace.rooms DURING render (flash-free, unlike a post-paint
  // effect): whenever the server list reference changes we keep the owner's
  // current local order if the room SET is unchanged — so an optimistic
  // reorder or a publish-toggle re-render doesn't clobber it — and otherwise
  // adopt the server order (first load, room added/removed). Either way we pull
  // fresh per-room fields (e.g. isPublished) from the server copy.
  const [orderedRooms, setOrderedRooms] = useState<Room[]>([])
  const [syncedRooms, setSyncedRooms] = useState<Room[] | null>(null)
  const sourceRooms = workspace?.rooms ?? null
  if (sourceRooms !== syncedRooms) {
    const source = sourceRooms ?? []
    const byId = new Map(source.map((r) => [r.id, r] as const))
    const sameSet =
      orderedRooms.length === source.length && orderedRooms.every((r) => byId.has(r.id))
    setOrderedRooms(sameSet ? orderedRooms.map((r) => byId.get(r.id) ?? r) : source)
    setSyncedRooms(sourceRooms)
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

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
  // accountMode reads 'personal' both for a real personal account and for one
  // whose load FAILED (resolved=false). Publishing is already gated on
  // canPublish — workspace instructor AND instructor account — so an unresolved
  // mode must not additionally strip the control from someone whose membership
  // role has already earned it. Only a positively resolved personal account
  // hides it, which is the pre-existing behaviour for genuine personal accounts.
  const orgModeAllowsPublish = !accountModeResolved || accountMode !== 'personal'
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
    // Refuse a second create while one is in flight — see creatingRoomRef. Must
    // run before any await (and before the name check is fine either way).
    if (creatingRoomRef.current) return
    const trimmed = newRoomName.trim()
    if (!trimmed) {
      toast.error('Room name required')
      return
    }
    try {
      creatingRoomRef.current = true
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
      // Re-enable on success and failure so a failed create can be retried.
      creatingRoomRef.current = false
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

  // Optimistic reorder FIRST, then persist in the background — mirrors
  // flipRoomPublish's optimistic-with-rollback. On success we deliberately do
  // NOT await fetchWorkspace: the local order already matches what we wrote, so
  // a refetch would only flash the list through a server round-trip (T2).
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedRooms.findIndex((r) => r.id === active.id)
    const newIndex = orderedRooms.findIndex((r) => r.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const previous = orderedRooms
    const next = arrayMove(orderedRooms, oldIndex, newIndex)
    setOrderedRooms(next)

    fetch(`/api/workspaces/${workspaceId}/rooms/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedRoomIds: next.map((r) => r.id) }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error || 'Failed to reorder rooms')
        }
      })
      .catch((e) => {
        setOrderedRooms(previous)
        toast.error(e instanceof Error ? e.message : 'Failed to reorder rooms')
      })
  }

  const handleEnrollStudents = async () => {
    // Accept comma- or newline-separated emails. The server re-normalizes
    // (trim/lowercase/dedupe/cap) and is the source of truth for validation.
    const emails = enrollText.split(/[\n,]/).map((e) => e.trim()).filter(Boolean)
    if (emails.length === 0) {
      toast.error('Enter at least one email address')
      return
    }
    try {
      setEnrollBusy(true)
      const res = await fetch(`/api/workspaces/${workspaceId}/members/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to add students')
      const result = {
        enrolled: Array.isArray(data.enrolled) ? data.enrolled : [],
        alreadyMember: Array.isArray(data.alreadyMember) ? data.alreadyMember : [],
        notFound: Array.isArray(data.notFound) ? data.notFound : [],
      }
      setEnrollResult(result)
      setEnrollText('')
      if (result.enrolled.length > 0) {
        toast.success(`Added ${result.enrolled.length} student${result.enrolled.length === 1 ? '' : 's'}`)
        // Refresh the member list. Not a hot path — a refetch is fine here.
        await fetchWorkspace()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add students')
    } finally {
      setEnrollBusy(false)
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

  const instructorName = workspace.members.find(m => m.role === 'instructor')?.name ?? null
  // Reorder UI is an owner-only power. `createdBy` is the workspace owner_id.
  const isOwner = workspace.createdBy === user?.id

  // Owner hardening, mirroring app/studio/[id]/page.tsx:403-407: `createdBy` is
  // owner_id and needs only the session, so the owner keeps their powers even
  // when the members array is missing or malformed. Every predicate feeding the
  // card affordance row is otherwise derived purely from workspace.members, and
  // the whole row hangs off canRename — so one bad members payload silently
  // strips the real owner of rename, publish AND delete at once. Widens to the
  // OWNER only; non-owners are unaffected, and publish still additionally
  // requires an instructor ACCOUNT (isAccountInstructor), which is the server
  // gate in PATCH /api/rooms/[id].
  const ownerOrInstructor = isInstructor || isOwner

  // Shared per-card handlers/flags. Per-room props (room, isEditing, isBusy)
  // are supplied at each call site.
  const cardHandlers: RoomCardHandlers = {
    editingRoomName,
    setEditingRoomName,
    onSaveRename: handleRenameRoom,
    onCancelEdit: () => { setEditingRoomId(null); setEditingRoomName('') },
    onStartEdit: (r) => { setEditingRoomId(r.id); setEditingRoomName(r.name) },
    canRename: canRename || isOwner,
    canShowPublish: orgModeAllowsPublish && ownerOrInstructor && isAccountInstructor,
    isInstructor: ownerOrInstructor,
    onTogglePublish: (r) => { handleTogglePublish(r) },
    onRequestDelete: (r) => setRoomToDelete(r),
  }

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
          <div className="flex items-center gap-2">
            <Link
              href={`/workspace/${workspaceId}/people`}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm flex items-center gap-2"
            >
              <Contact className="w-4 h-4" />
              People
            </Link>
            {isInstructor && (
              <>
                {orgModeAllowsPublish && canPublish && (
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
              </>
            )}
          </div>
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
          {/* Room cards. Owners get drag-to-reorder (each card carries its own
              handle); everyone else gets the same cards statically. The Add
              Room card stays OUTSIDE the sortable context (S3) so it never
              participates in reordering. */}
          {isOwner ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedRooms.map((r) => r.id)}
                strategy={rectSortingStrategy}
              >
                {orderedRooms.map((room) => (
                  <SortableRoomCard
                    key={room.id}
                    room={room}
                    isEditing={editingRoomId === room.id}
                    isBusy={roomBusy === room.id}
                    {...cardHandlers}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            orderedRooms.map((room) => (
              <div
                key={room.id}
                className="relative group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              >
                <RoomCardInner
                  room={room}
                  isEditing={editingRoomId === room.id}
                  isBusy={roomBusy === room.id}
                  {...cardHandlers}
                />
              </div>
            ))
          )}

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

        {orderedRooms.length === 0 && !canAddRoom && (
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

        {/* Add students by email — class owner only. Enrolls students who
            already have a PinSpace account into workspace_members (which is
            what actually grants room access; org membership alone does not). */}
        {isOwner && workspace.type === 'class' && (
          <div className="mt-12 bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-indigo-600" />
                  Add students
                </h2>
                <p className="text-sm text-gray-500 mt-1 max-w-xl">
                  Enroll students by email. They must already have a PinSpace account —
                  anyone without one is listed below so you can ask them to sign up first.
                </p>
              </div>
              {!enrollOpen && (
                <button
                  onClick={() => { setEnrollOpen(true); setEnrollResult(null) }}
                  className="shrink-0 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  Add students
                </button>
              )}
            </div>

            {enrollOpen && (
              <div className="mt-4">
                <textarea
                  value={enrollText}
                  onChange={(e) => setEnrollText(e.target.value)}
                  rows={4}
                  placeholder={'Paste student emails, separated by commas or new lines\ne.g. jane@wit.edu, john@wit.edu'}
                  disabled={enrollBusy}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleEnrollStudents}
                    disabled={enrollBusy || !enrollText.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm disabled:opacity-50"
                  >
                    {enrollBusy ? 'Adding…' : 'Add students'}
                  </button>
                  <button
                    onClick={() => { setEnrollOpen(false); setEnrollText('') }}
                    disabled={enrollBusy}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {enrollResult && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-medium text-gray-900">
                  {enrollResult.enrolled.length} enrolled
                  <span className="text-gray-400"> · </span>
                  {enrollResult.alreadyMember.length} already in
                  <span className="text-gray-400"> · </span>
                  {enrollResult.notFound.length} have no account yet
                </p>
                {enrollResult.notFound.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      No account yet — ask them to sign up first
                    </p>
                    <ul className="text-sm text-gray-700 space-y-0.5">
                      {enrollResult.notFound.map((email) => (
                        <li key={email} className="font-mono text-xs break-all">{email}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
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

// Handlers/flags shared by every room card, independent of which room. The
// parent builds one of these and spreads it into each card.
type RoomCardHandlers = {
  editingRoomName: string
  setEditingRoomName: (v: string) => void
  onSaveRename: (room: Room) => void
  onCancelEdit: () => void
  onStartEdit: (room: Room) => void
  canRename: boolean
  canShowPublish: boolean
  isInstructor: boolean
  onTogglePublish: (room: Room) => void
  onRequestDelete: (room: Room) => void
}

type RoomCardProps = RoomCardHandlers & {
  room: Room
  isEditing: boolean
  isBusy: boolean
}

// Presentational card innards (the Link/inline-edit block + the hover
// affordances row). Rendered inside whichever outer wrapper the caller
// provides — a sortable div for owners, a plain div for everyone else — so the
// card markup lives in exactly one place.
function RoomCardInner({
  room,
  isEditing,
  isBusy,
  editingRoomName,
  setEditingRoomName,
  onSaveRename,
  onCancelEdit,
  onStartEdit,
  canRename,
  canShowPublish,
  isInstructor,
  onTogglePublish,
  onRequestDelete,
}: RoomCardProps) {
  return (
    <>
      {/* Card body — the Link is the click target unless we're inline editing */}
      {isEditing ? (
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <input
              type="text"
              value={editingRoomName}
              maxLength={100}
              onChange={(e) => setEditingRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveRename(room)
                if (e.key === 'Escape') onCancelEdit()
              }}
              disabled={isBusy}
              autoFocus
              className="flex-1 px-3 py-1.5 border border-indigo-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={() => onSaveRename(room)}
              disabled={isBusy}
              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-50"
              aria-label="Save name"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={onCancelEdit}
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

      {/* Edit affordances. Visible on hover so they don't crowd the card.
          Hover effects suppressed when editing. Rename is open to any member
          (Phase 10); publish + delete stay owner-only. */}
      {canRename && !isEditing && (
        <div className="px-6 pb-4 flex items-center justify-end gap-1 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {canShowPublish && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePublish(room) }}
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
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStartEdit(room) }}
            disabled={isBusy}
            className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-50"
            aria-label="Rename room"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {isInstructor && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRequestDelete(room) }}
              disabled={isBusy}
              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
              aria-label="Delete room"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </>
  )
}

// Owner-only sortable wrapper. The drag handle is the ONLY draggable surface
// (S2) — the rest of the card stays a working Link. The handle sits in the
// left padding gutter (vertically centered) and carries a higher z-index, so
// its pointer events never reach the underlying Link and it doesn't overlap the
// Link's content. Hidden while inline-renaming to avoid an accidental drag.
function SortableRoomCard(props: RoomCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.room.id })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 20 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
    >
      {!props.isEditing && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-20 p-1 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100 cursor-grab active:cursor-grabbing touch-none"
          aria-label={`Drag to reorder ${props.room.name}`}
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      <RoomCardInner {...props} />
    </div>
  )
}
