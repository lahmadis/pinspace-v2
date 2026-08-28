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
import type { Department, YearLevel } from '@/lib/constants/departments'
import type { Studio } from '@/lib/constants/studios'
import GridPreview from '@/components/ui/GridPreview'
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
      toast.error('Space name required')
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
      if (!res.ok) throw new Error(data?.error || 'Failed to create space')
      setAddingRoom(false)
      setNewRoomName('')
      await fetchWorkspace()
      toast.success(`Created space "${trimmed}"`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create space')
    } finally {
      // Re-enable on success and failure so a failed create can be retried.
      creatingRoomRef.current = false
      setRoomBusy(null)
    }
  }

  const handleRenameRoom = async (room: Room) => {
    const trimmed = editingRoomName.trim()
    if (!trimmed) {
      toast.error('Space name required')
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
      if (!res.ok) throw new Error(data?.error || 'Failed to rename space')
      setEditingRoomId(null)
      setEditingRoomName('')
      await fetchWorkspace()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to rename space')
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
      if (!res.ok) throw new Error(data?.error || 'Failed to delete space')
      setRoomToDelete(null)
      await fetchWorkspace()
      toast.success(`Deleted space "${roomToDelete.name}"`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete space')
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
      if (!res.ok) throw new Error(data?.error || 'Failed to update space')
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
      toast.error(e instanceof Error ? e.message : 'Failed to update space')
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
          throw new Error(data?.error || 'Failed to reorder spaces')
        }
      })
      .catch((e) => {
        setOrderedRooms(previous)
        toast.error(e instanceof Error ? e.message : 'Failed to reorder spaces')
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
          studio: metadata.studio,
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
          // Cast to the canonical types rather than re-spelling both unions
          // inline — the inline copy is what had to be edited by hand every
          // time either list changed.
          networkMetadata: {
            department: metadata.department as Department,
            year: metadata.year as YearLevel,
            studio: metadata.studio as Studio | undefined,
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
          <p className="text-gray-600">Loading spaces...</p>
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
    <div className="min-h-screen bg-[#F4F6FB]">
      {/* Header. Same ink/accent tokens and pill shapes as the dashboard — this
          page was still on the old gray/indigo palette, which made stepping
          into a studio look like leaving the product. */}
      <div className="mx-auto max-w-5xl px-6 pt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href="/dashboard"
              aria-label="Back to Dashboard"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#16181D]/10 bg-white text-[#5A5E6B] transition-colors hover:border-[#3B6EF6] hover:text-[#3B6EF6]"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="truncate text-[30px] font-extrabold tracking-[-0.035em] text-[#16181D]">
                  {workspace.name}
                </h1>
                {/* Real field, shown only when set — academic_year is populated
                    on about half of workspaces. */}
                {workspace.academicYear && (
                  <span className="rounded-full bg-[#3B6EF6]/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[#3B6EF6]">
                    {workspace.academicYear}
                  </span>
                )}
              </div>
              {instructorName && (
                <p className="mt-1 truncate text-sm text-[#8A8FA0]">Owner: {instructorName}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/workspace/${workspaceId}/people`}
              className="flex items-center gap-2 rounded-full border border-[#16181D]/10 bg-white px-4 py-2.5 text-sm font-semibold text-[#16181D] transition-colors hover:border-[#3B6EF6] hover:text-[#3B6EF6]"
            >
              <Contact className="h-4 w-4 text-[#8A8FA0]" />
              People
            </Link>
            {isInstructor && (
              <>
                {orgModeAllowsPublish && canPublish && (
                  <button
                    onClick={() => setNetworkSettingsOpen(true)}
                    className="flex items-center gap-2 rounded-full border border-[#16181D]/10 bg-white px-4 py-2.5 text-sm font-semibold text-[#16181D] transition-colors hover:border-[#3B6EF6] hover:text-[#3B6EF6]"
                    title="Edit network metadata (department, year, instructor)"
                  >
                    <Network className="h-4 w-4 text-[#8A8FA0]" />
                    Network
                  </button>
                )}
                <Link
                  href={`/workspace/${workspaceId}/settings`}
                  className="flex items-center gap-2 rounded-full border border-[#16181D]/10 bg-white px-4 py-2.5 text-sm font-semibold text-[#16181D] transition-colors hover:border-[#3B6EF6] hover:text-[#3B6EF6]"
                >
                  <Settings className="h-4 w-4 text-[#8A8FA0]" />
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
          <div className="mx-auto max-w-5xl px-6 pt-6">
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-[#E0B44A]/40 bg-[#FDF6E7] p-4">
              <p className="text-sm text-[#7A5A12]">
                <strong className="font-bold">This class is published but missing network info.</strong>{' '}
                Add it so students can find your studio on the Wentworth Network.
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setNetworkSettingsOpen(true)}
                  className="rounded-full bg-[#7A5A12] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#16181D]"
                >
                  Add network settings
                </button>
                <button
                  onClick={() => setBannerDismissed(true)}
                  className="rounded-full p-1.5 text-[#7A5A12] transition-colors hover:bg-[#7A5A12]/10"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Body */}
      <div className="mx-auto max-w-5xl px-6 pb-16 pt-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-extrabold tracking-[-0.03em] text-[#16181D]">Spaces</h2>
            <p className="mt-1 text-sm text-[#8A8FA0]">Click a space to enter its 3D studio.</p>
          </div>
          <span className="shrink-0 text-sm text-[#8A8FA0]">
            {orderedRooms.length} space{orderedRooms.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
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
                className="group relative rounded-3xl border border-[#16181D]/[0.08] bg-white p-3 shadow-[0_8px_24px_rgba(22,24,29,0.05)] transition-shadow duration-200 hover:shadow-[0_16px_40px_rgba(22,24,29,0.10)]"
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
              <div className="flex flex-col gap-3 rounded-3xl border border-[#3B6EF6]/25 bg-[#3B6EF6]/[0.04] p-6">
                <p className="text-sm font-bold text-[#16181D]">Name your new space</p>
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
                  className="w-full rounded-xl border border-[#16181D]/[0.12] bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6EF6]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateRoom}
                    disabled={roomBusy === 'create' || !newRoomName.trim()}
                    className="flex-1 rounded-full bg-[#3B6EF6] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#16181D] disabled:opacity-50"
                  >
                    {roomBusy === 'create' ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    onClick={() => { setAddingRoom(false); setNewRoomName('') }}
                    disabled={roomBusy === 'create'}
                    className="rounded-full border border-[#16181D]/[0.12] px-4 py-2.5 text-sm font-semibold text-[#5A5E6B] transition-colors hover:bg-[#16181D]/5 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingRoom(true)}
                className="group flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-[#16181D]/[0.12] p-6 transition-colors hover:border-[#3B6EF6] hover:bg-[#3B6EF6]/5"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#3B6EF6]/10 transition-colors group-hover:bg-[#3B6EF6]/20">
                  <Plus className="h-5 w-5 text-[#3B6EF6]" />
                </div>
                <span className="mt-1 text-[15px] font-bold text-[#16181D]">Add space</span>
                <span className="text-xs text-[#8A8FA0]">Another set of walls</span>
              </button>
            )
          )}
        </div>

        {orderedRooms.length === 0 && !canAddRoom && (
          <div className="rounded-3xl border border-[#16181D]/[0.08] bg-white py-16 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#16181D]/[0.06]">
              <DoorOpen className="h-7 w-7 text-[#8A8FA0]" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-[#16181D]">No spaces yet</h3>
            <p className="mx-auto max-w-sm text-sm text-[#5A5E6B]">
              The instructor hasn&apos;t set up any spaces in this workspace yet. Check back later.
            </p>
          </div>
        )}

        {/* Add students by email — class owner only. Enrolls students who
            already have a pinspace account into workspace_members (which is
            what actually grants room access; org membership alone does not). */}
        {isOwner && workspace.type === 'class' && (
          <div className="mt-10 rounded-3xl border border-[#16181D]/[0.08] bg-white p-6 shadow-[0_8px_24px_rgba(22,24,29,0.04)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2.5 text-[17px] font-extrabold tracking-[-0.02em] text-[#16181D]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#3B6EF6]/10">
                    <UserPlus className="h-4 w-4 text-[#3B6EF6]" />
                  </span>
                  Add students
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#5A5E6B]">
                  Enroll students by email. They must already have a pinspace account —
                  anyone without one is listed below so you can ask them to sign up first.
                </p>
              </div>
              {!enrollOpen && (
                <button
                  onClick={() => { setEnrollOpen(true); setEnrollResult(null) }}
                  className="flex shrink-0 items-center gap-2 rounded-full bg-[#3B6EF6] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#16181D]"
                >
                  <UserPlus className="h-4 w-4" />
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
                  className="w-full rounded-2xl border border-[#16181D]/[0.12] px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] disabled:opacity-50"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleEnrollStudents}
                    disabled={enrollBusy || !enrollText.trim()}
                    className="rounded-full bg-[#3B6EF6] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#16181D] disabled:opacity-50"
                  >
                    {enrollBusy ? 'Adding…' : 'Add students'}
                  </button>
                  <button
                    onClick={() => { setEnrollOpen(false); setEnrollText('') }}
                    disabled={enrollBusy}
                    className="rounded-full border border-[#16181D]/[0.12] px-5 py-2.5 text-sm font-semibold text-[#5A5E6B] transition-colors hover:bg-[#16181D]/5 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {enrollResult && (
              <div className="mt-4 rounded-2xl border border-[#16181D]/[0.08] bg-[#F4F6FB] p-4">
                <p className="text-sm font-bold text-[#16181D]">
                  {enrollResult.enrolled.length} enrolled
                  <span className="text-[#B6BAC4]"> · </span>
                  {enrollResult.alreadyMember.length} already in
                  <span className="text-[#B6BAC4]"> · </span>
                  {enrollResult.notFound.length} have no account yet
                </p>
                {enrollResult.notFound.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8FA0]">
                      No account yet — ask them to sign up first
                    </p>
                    <ul className="space-y-0.5 text-sm text-[#5A5E6B]">
                      {enrollResult.notFound.map((email) => (
                        <li key={email} className="break-all font-mono text-xs">{email}</li>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#16181D]/30 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-[0_30px_90px_rgba(22,24,29,0.3)]">
            <h3 className="mb-2 text-lg font-extrabold text-[#16181D]">Delete space?</h3>
            <p className="mb-3 text-sm text-[#5A5E6B]">
              <strong className="text-[#16181D]">&ldquo;{roomToDelete.name}&rdquo;</strong> will be permanently deleted.
            </p>
            <div className="mb-6 rounded-2xl border border-[#C2452D]/20 bg-[#C2452D]/[0.06] p-3">
              <p className="text-sm text-[#C2452D]">
                Every board in this space will be deleted along with it. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setRoomToDelete(null)}
                disabled={roomBusy === roomToDelete.id}
                className="flex-1 rounded-full border border-[#16181D]/[0.12] px-4 py-2.5 font-semibold text-[#5A5E6B] transition-colors hover:bg-[#16181D]/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteRoom}
                disabled={roomBusy === roomToDelete.id}
                className="flex-1 rounded-full bg-[#C2452D] px-4 py-2.5 font-bold text-white transition-colors hover:bg-[#a5391f] disabled:opacity-50"
              >
                {roomBusy === roomToDelete.id ? 'Deleting…' : 'Delete space'}
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
  const boards = room.boardCount ?? 0

  return (
    <>
      {/* Preview panel. The room has no rendered thumbnail, so the tile is the
          ruling the work sits on — the same cursor-reactive grid the landing
          page and the dashboard cards use. It replaces a door icon, which was
          identical on every space and said nothing about any of them.

          The grid fills the panel rather than sitting centred as the icon did,
          so it runs to the edges; the published badge and the edit affordances
          are absolutely placed and still sit over it. */}
      <Link href={`/studio/${room.id}`} className="block cursor-pointer">
        <div
          className="relative aspect-[4/3] overflow-hidden rounded-2xl"
          style={{ background: 'linear-gradient(150deg, #EEF3FC, #DCE5F5)' }}
        >
          <GridPreview className="h-full w-full" />
          {/* Bottom-left, not top-left as in the reference: the owner's drag
              handle occupies the top-left corner and the affordances the
              top-right, and those two only appear on the cards most likely to
              be published. */}
          {room.isPublished && (
            <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#1F7A4D] backdrop-blur-sm">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#22A366]" />
              Published
            </span>
          )}
        </div>
      </Link>

      {/* Edit affordances, over the preview's top-right corner rather than in a
          row of their own — a row that appears on hover shifts the card's
          height, and this card is in a grid where that nudges its neighbours.

          Faintly visible at rest rather than opacity-0: hover never fires on a
          touch screen, which put publish, rename and delete permanently out of
          reach on a phone. Rename is open to any member (Phase 10); publish and
          delete stay owner-only. */}
      {canRename && !isEditing && (
        <div className="absolute right-5 top-5 flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
          {canShowPublish && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePublish(room) }}
              disabled={isBusy}
              className={`rounded-full bg-white/90 p-1.5 shadow-sm backdrop-blur-sm transition-colors disabled:opacity-50 ${
                room.isPublished
                  ? 'text-[#1F7A4D] hover:text-[#5A5E6B]'
                  : 'text-[#8A8FA0] hover:text-[#1F7A4D]'
              }`}
              aria-label={room.isPublished ? 'Unpublish space' : 'Publish to Wentworth'}
              title={room.isPublished ? 'Unpublish' : 'Publish to Wentworth'}
            >
              <Globe className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStartEdit(room) }}
            disabled={isBusy}
            className="rounded-full bg-white/90 p-1.5 text-[#8A8FA0] shadow-sm backdrop-blur-sm transition-colors hover:text-[#3B6EF6] disabled:opacity-50"
            aria-label="Rename space"
            title="Rename space"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {isInstructor && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRequestDelete(room) }}
              disabled={isBusy}
              className="rounded-full bg-white/90 p-1.5 text-[#8A8FA0] shadow-sm backdrop-blur-sm transition-colors hover:text-[#C2452D] disabled:opacity-50"
              aria-label="Delete space"
              title="Delete space"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Name row, or the inline rename that replaces it */}
      {isEditing ? (
        <div className="flex items-center gap-2 px-1 pb-1 pt-3">
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
            className="min-w-0 flex-1 rounded-xl border border-[#16181D]/[0.12] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6EF6]"
          />
          <button
            onClick={() => onSaveRename(room)}
            disabled={isBusy}
            className="rounded-full p-2 text-[#3B6EF6] transition-colors hover:bg-[#3B6EF6]/[0.08] disabled:opacity-50"
            aria-label="Save name"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={onCancelEdit}
            disabled={isBusy}
            className="rounded-full p-2 text-[#8A8FA0] transition-colors hover:bg-[#16181D]/5 disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Link href={`/studio/${room.id}`} className="flex items-end justify-between gap-2 px-2 pb-1 pt-3.5">
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-extrabold tracking-[-0.02em] text-[#16181D] transition-colors group-hover:text-[#3B6EF6]">
              {room.name}
            </span>
            <span className="mt-0.5 block text-[13px] text-[#8A8FA0]">
              {boards} {boards === 1 ? 'board' : 'boards'}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-[#B6BAC4] transition-all group-hover:translate-x-0.5 group-hover:text-[#3B6EF6]" />
        </Link>
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
      className="group relative rounded-3xl border border-[#16181D]/[0.08] bg-white p-3 shadow-[0_8px_24px_rgba(22,24,29,0.05)] transition-shadow duration-200 hover:shadow-[0_16px_40px_rgba(22,24,29,0.10)]"
    >
      {!props.isEditing && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="absolute left-5 top-5 z-20 cursor-grab touch-none rounded-full bg-white/90 p-1.5 text-[#8A8FA0] opacity-60 shadow-sm backdrop-blur-sm transition-opacity hover:text-[#16181D] active:cursor-grabbing group-hover:opacity-100"
          aria-label={`Drag to reorder ${props.room.name}`}
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <RoomCardInner {...props} />
    </div>
  )
}
