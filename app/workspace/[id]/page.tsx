'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  DoorOpen,
  Globe,
  LayoutDashboard,
  MoreVertical,
  Network,
  PanelsTopLeft,
  Pencil,
  Plus,
  Settings,
  Share2,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'

import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Select,
  Skeleton,
  StatusState,
} from '@/components/ui'
import { WorkspaceRoomsShimmer } from '@/components/workspace/WorkspaceRoomsShimmer'
import { useAuthSession } from '@/hooks/useAuthSession'
import { academicYearOptions, currentAcademicYear } from '@/lib/academicYear'
import { useProfile } from '@/lib/ProfileContext'
import { toast } from '@/lib/toast'
import { useAccountMode } from '@/lib/useAccountMode'
import type { Room, Workspace } from '@/types'

const navigation = [
  { href: '/dashboard', label: 'Projects', icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { href: '/my-boards', label: 'My boards', icon: <PanelsTopLeft className="h-4 w-4" />, exact: true },
]

const footerNavigation = [
  { href: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
]

const actionLink = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-pinspace border border-border bg-background-light px-4 py-2 text-sm font-semibold text-text-primary shadow-[var(--shadow-soft)] hover:border-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

type NetworkMetadata = { department: string; year: string; instructor: string; academicYear: string }
const departments = ['Aerospace Engineering', 'Architecture', 'Civil Engineering', 'Electrical Engineering', 'Industrial Design', 'Interior Design', 'Mechanical Engineering', 'Robotics Engineering']
const yearLevels = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters']

function NetworkSettingsDialog({ current, publishing, onOpenChange, onConfirm }: { current?: NetworkMetadata; publishing: boolean; onOpenChange: (open: boolean) => void; onConfirm: (metadata: NetworkMetadata) => Promise<void> }) {
  const [metadata, setMetadata] = useState<NetworkMetadata>(current ?? { department: '', year: '', instructor: '', academicYear: currentAcademicYear() })
  const [validationError, setValidationError] = useState('')
  const [pending, setPending] = useState(false)

  const submit = async () => {
    if (pending) return
    if (!metadata.department || !metadata.year || !metadata.academicYear || !metadata.instructor.trim()) {
      setValidationError('Complete every network field before saving')
      return
    }
    setPending(true)
    setValidationError('')
    try {
      await onConfirm({ ...metadata, instructor: metadata.instructor.trim() })
      onOpenChange(false)
    } catch (caughtError) {
      setValidationError(caughtError instanceof Error ? caughtError.message : 'Failed to save network settings')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!pending) onOpenChange(next) }} closeOnOutsideClick={!pending} hideCloseButton={pending} title={publishing ? 'Publish room to network' : 'Network settings'} description="Add the metadata used to organize this room in the Wentworth network.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label htmlFor="network-department" className="mb-1.5 block text-sm font-semibold text-text-primary">Department</label><Select id="network-department" value={metadata.department} disabled={pending} aria-invalid={Boolean(validationError && !metadata.department)} aria-describedby={validationError && !metadata.department ? 'network-form-error' : undefined} onChange={(event) => setMetadata((value) => ({ ...value, department: event.target.value }))}><option value="">Select department</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</Select></div>
        <div><label htmlFor="network-year" className="mb-1.5 block text-sm font-semibold text-text-primary">Year level</label><Select id="network-year" value={metadata.year} disabled={pending} aria-invalid={Boolean(validationError && !metadata.year)} aria-describedby={validationError && !metadata.year ? 'network-form-error' : undefined} onChange={(event) => setMetadata((value) => ({ ...value, year: event.target.value }))}><option value="">Select year</option>{yearLevels.map((year) => <option key={year} value={year}>{year}</option>)}</Select></div>
        <div><label htmlFor="network-academic-year" className="mb-1.5 block text-sm font-semibold text-text-primary">Academic year</label><Select id="network-academic-year" value={metadata.academicYear} disabled={pending} onChange={(event) => setMetadata((value) => ({ ...value, academicYear: event.target.value }))}>{academicYearOptions().map((year) => <option key={year} value={year}>{year}</option>)}</Select></div>
        <div><label htmlFor="network-instructor" className="mb-1.5 block text-sm font-semibold text-text-primary">Instructor name</label><Input id="network-instructor" value={metadata.instructor} maxLength={80} disabled={pending} aria-invalid={Boolean(validationError && !metadata.instructor.trim())} aria-describedby={validationError && !metadata.instructor.trim() ? 'network-form-error' : undefined} onChange={(event) => setMetadata((value) => ({ ...value, instructor: event.target.value }))} /></div>
      </div>
      {validationError && <StatusState id="network-form-error" role="alert" status="error" title={validationError} className="mt-4" />}
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" loading={pending} onClick={() => void submit()}>{publishing ? 'Save and publish' : 'Save settings'}</Button></div>
    </Dialog>
  )
}

type RoomCardProps = {
  room: Room
  index: number
  total: number
  busy: boolean
  editing: boolean
  editingName: string
  nameError: boolean
  canRename: boolean
  canShare: boolean
  canPublish: boolean
  canDelete: boolean
  canReorder: boolean
  onEditingNameChange: (name: string) => void
  onStartRename: (room: Room) => void
  onShare: (room: Room) => void
  onSaveRename: (room: Room) => void
  onCancelRename: () => void
  onTogglePublish: (room: Room) => void
  onDelete: (room: Room) => void
  onMove: (index: number, direction: -1 | 1) => void
}

function RoomCard({
  room,
  index,
  total,
  busy,
  editing,
  editingName,
  nameError,
  canRename,
  canShare,
  canPublish,
  canDelete,
  canReorder,
  onEditingNameChange,
  onStartRename,
  onShare,
  onSaveRename,
  onCancelRename,
  onTogglePublish,
  onDelete,
  onMove,
}: RoomCardProps) {
  return (
    <Card className="relative flex min-w-0 flex-col overflow-visible p-0">
      <div className="absolute right-2 top-2 z-10">
        {(canRename || canShare || canPublish || canDelete || canReorder) && (
          <Menu>
            <MenuTrigger aria-label={`Actions for ${room.name}`} className="min-h-11 min-w-11 bg-background-light/95 p-0 text-text-secondary">
              <MoreVertical className="h-5 w-5" aria-hidden="true" />
            </MenuTrigger>
            <MenuContent aria-label={`Actions for ${room.name}`}>
              {canRename && <MenuItem className="min-h-11" onSelect={() => onStartRename(room)}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Rename</MenuItem>}
              {canShare && <MenuItem className="min-h-11" onSelect={() => onShare(room)}><Share2 className="mr-2 h-4 w-4" aria-hidden="true" />Share room</MenuItem>}
              {canPublish && <MenuItem className="min-h-11" onSelect={() => onTogglePublish(room)}><Globe className="mr-2 h-4 w-4" aria-hidden="true" />{room.isPublished ? 'Unpublish from network' : 'Publish to network'}</MenuItem>}
              {canReorder && index > 0 && <MenuItem className="min-h-11" onSelect={() => onMove(index, -1)}><ArrowUp className="mr-2 h-4 w-4" aria-hidden="true" />Move earlier</MenuItem>}
              {canReorder && index < total - 1 && <MenuItem className="min-h-11" onSelect={() => onMove(index, 1)}><ArrowDown className="mr-2 h-4 w-4" aria-hidden="true" />Move later</MenuItem>}
              {canDelete && (
                <MenuItem onSelect={() => onDelete(room)} className="min-h-11 text-[rgb(var(--color-danger))] focus:bg-[rgb(var(--color-danger)/0.1)]">
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Delete room
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        )}
      </div>

      {editing ? (
        <form
          className="flex min-h-48 min-w-0 flex-col justify-center gap-3 p-5 pr-16"
          onSubmit={(event) => { event.preventDefault(); onSaveRename(room) }}
        >
          <label htmlFor={`rename-${room.id}`} className="text-sm font-semibold text-text-primary">Room name</label>
          <Input
            id={`rename-${room.id}`}
            value={editingName}
            maxLength={100}
            disabled={busy}
            autoFocus
            aria-invalid={nameError}
            aria-describedby={nameError ? 'room-error' : undefined}
            onChange={(event) => onEditingNameChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') onCancelRename() }}
          />
          <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" className="min-h-11" loading={busy}>Save name</Button>
          <Button type="button" size="sm" className="min-h-11" variant="ghost" disabled={busy} onClick={onCancelRename}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Link
          href={`/studio/${room.id}`}
          aria-label={`Enter ${room.name}`}
          className="flex min-h-48 min-w-0 flex-1 flex-col rounded-pinspace-lg p-5 pr-16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-pinspace bg-primary-muted text-accent">
            <DoorOpen className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="mt-auto min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-lg font-bold text-text-primary">{room.name}</h3>
              {room.isPublished && <Badge variant="success">Published</Badge>}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm text-text-secondary">
              <span>{room.boardCount ?? 0} {(room.boardCount ?? 0) === 1 ? 'board' : 'boards'}</span>
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </div>
          </div>
        </Link>
      )}
    </Card>
  )
}

export default function WorkspaceRoomsPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.id as string
  const { status: authStatus, user } = useAuthSession()
  const { mode: accountMode, resolved: accountModeResolved } = useAccountMode(user?.id, user?.email)
  const { profile } = useProfile()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingRoom, setAddingRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [roomError, setRoomError] = useState('')
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [editingRoomName, setEditingRoomName] = useState('')
  const [roomBusy, setRoomBusy] = useState<string | null>(null)
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null)
  const [roomToShare, setRoomToShare] = useState<Room | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [shareError, setShareError] = useState('')
  const [shareCopied, setShareCopied] = useState(false)
  const [publishModalRoom, setPublishModalRoom] = useState<Room | null>(null)
  const [networkSettingsOpen, setNetworkSettingsOpen] = useState(false)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrollText, setEnrollText] = useState('')
  const [enrollBusy, setEnrollBusy] = useState(false)
  const [enrollResult, setEnrollResult] = useState<{ enrolled: { email: string; name: string | null }[]; alreadyMember: string[]; notFound: string[] } | null>(null)
  const creatingRoomRef = useRef(false)
  const reorderingRef = useRef(false)

  const fetchWorkspace = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to load workspace')
      if (!data.workspace) throw new Error('Workspace data missing in response')
      setWorkspace(data.workspace)
      setRooms(Array.isArray(data.workspace.rooms) ? data.workspace.rooms : [])
      setError('')
    } catch (caughtError) {
      setWorkspace(null)
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push(`/sign-in?redirect=${encodeURIComponent(`/workspace/${workspaceId}`)}`)
      return
    }
    if (authStatus === 'authenticated') {
      const fetchTimer = window.setTimeout(() => void fetchWorkspace(), 0)
      return () => window.clearTimeout(fetchTimer)
    }
  }, [authStatus, fetchWorkspace, router, workspaceId])

  const member = workspace?.members.some((item) => item.userId === user?.id) ?? false
  const instructorMember = workspace?.members.some((item) => item.userId === user?.id && item.role === 'instructor') ?? false
  const owner = workspace?.createdBy === user?.id
  const accountInstructor = profile.accountRole === 'instructor'
  const canRename = member || owner
  const canDelete = owner
  const canShare = owner
  const canPublish = accountInstructor && owner && (!accountModeResolved || accountMode !== 'personal')
  const canAddRoom = instructorMember || owner || (workspace?.type === 'shared' && member)

  const refresh = async () => { await fetchWorkspace() }

  const handleCreateRoom = async () => {
    if (creatingRoomRef.current) return
    const name = newRoomName.trim()
    if (!name) { setRoomError('Enter a space name'); return }
    creatingRoomRef.current = true
    setRoomBusy('create')
    setRoomError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to create space')
      setNewRoomName('')
      setAddingRoom(false)
      await refresh()
      toast.success(`Created space "${name}"`)
    } catch (caughtError) {
      setRoomError(caughtError instanceof Error ? caughtError.message : 'Failed to create space')
    } finally {
      creatingRoomRef.current = false
      setRoomBusy(null)
    }
  }

  const handleRenameRoom = async (room: Room) => {
    const name = editingRoomName.trim()
    if (!name) { setRoomError('Enter a space name'); return }
    if (name === room.name) { setEditingRoomId(null); return }
    setRoomBusy(room.id)
    try {
      const response = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to rename space')
      setEditingRoomId(null)
      setEditingRoomName('')
      await refresh()
    } catch (caughtError) {
      setRoomError(caughtError instanceof Error ? caughtError.message : 'Failed to rename space')
    } finally {
      setRoomBusy(null)
    }
  }

  const handleDeleteRoom = async () => {
    if (!roomToDelete || roomBusy) return
    const room = roomToDelete
    setRoomBusy(room.id)
    try {
      const response = await fetch(`/api/rooms/${room.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to delete space')
      setRoomToDelete(null)
      await refresh()
      toast.success(`Deleted space "${room.name}"`)
    } catch (caughtError) {
      setRoomError(caughtError instanceof Error ? caughtError.message : 'Failed to delete space')
    } finally {
      setRoomBusy(null)
    }
  }

  const handleShareRoom = async (room: Room) => {
    if (shareBusy) return
    setRoomToShare(room)
    setShareBusy(true)
    setShareUrl('')
    setShareError('')
    setShareCopied(false)
    try {
      const response = await fetch(`/api/rooms/${room.id}/share`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || typeof data.shareUrl !== 'string') throw new Error(data.error || 'Failed to create share link')
      setShareUrl(data.shareUrl)
    } catch (caughtError) {
      setShareError(caughtError instanceof Error ? caughtError.message : 'Failed to create share link')
    } finally {
      setShareBusy(false)
    }
  }

  const copyShareLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 2000)
    } catch {
      toast.error('Could not copy the share link')
    }
  }

  const updatePublish = async (room: Room, isPublished: boolean) => {
    setRooms((current) => current.map((item) => item.id === room.id ? { ...item, isPublished } : item))
    try {
      const response = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPublished }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to update room')
      toast.success(isPublished ? `Published "${room.name}" to Wentworth` : `Unpublished "${room.name}"`)
    } catch (caughtError) {
      setRooms((current) => current.map((item) => item.id === room.id ? { ...item, isPublished: !isPublished } : item))
      toast.error(caughtError instanceof Error ? caughtError.message : 'Failed to update room')
    }
  }

  const handleTogglePublish = async (room: Room) => {
    if (room.isPublished) { await updatePublish(room, false); return }
    if (workspace?.networkMetadata?.department && workspace.networkMetadata.year) await updatePublish(room, true)
    else setPublishModalRoom(room)
  }

  const saveNetworkMetadata = async (metadata: NetworkMetadata) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/network-metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department: metadata.department, yearLevel: metadata.year, instructor: metadata.instructor, academicYear: metadata.academicYear }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Failed to save network metadata')
    setWorkspace((current) => current ? {
      ...current,
      networkMetadata: { department: metadata.department as Workspace['networkMetadata'] extends infer T ? T extends { department: infer D } ? D : never : never, year: metadata.year as Workspace['networkMetadata'] extends infer T ? T extends { year: infer Y } ? Y : never : never },
      academicYear: metadata.academicYear,
      instructor: metadata.instructor,
    } : current)
  }

  const moveRoom = (index: number, direction: -1 | 1) => {
    if (reorderingRef.current) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= rooms.length) return
    reorderingRef.current = true
    const previous = rooms
    const next = [...rooms]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    setRooms(next)
    fetch(`/api/workspaces/${workspaceId}/rooms/reorder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedRoomIds: next.map((room) => room.id) }),
    }).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to reorder rooms')
      }
    }).catch((caughtError) => {
      setRooms(previous)
      toast.error(caughtError instanceof Error ? caughtError.message : 'Failed to reorder rooms')
    }).finally(() => { reorderingRef.current = false })
  }

  const handleEnroll = async () => {
    const emails = enrollText.split(/[\n,]/).map((email) => email.trim()).filter(Boolean)
    if (!emails.length) { setRoomError('Enter at least one email address'); return }
    setEnrollBusy(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/members/enroll`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to add students')
      const result = {
        enrolled: Array.isArray(data.enrolled) ? data.enrolled : [],
        alreadyMember: Array.isArray(data.alreadyMember) ? data.alreadyMember : [],
        notFound: Array.isArray(data.notFound) ? data.notFound : [],
      }
      setEnrollResult(result)
      setEnrollText('')
      if (result.enrolled.length) await refresh()
    } catch (caughtError) {
      setRoomError(caughtError instanceof Error ? caughtError.message : 'Failed to add students')
    } finally {
      setEnrollBusy(false)
    }
  }

  if (authStatus === 'loading' || loading) {
    return <WorkspaceRoomsShimmer />
  }

  if (error || !workspace) {
    return (
      <div className="min-h-dvh w-full bg-background text-text-primary">
        <header className="border-b border-border bg-background-light py-5">
          <div className="mx-auto w-full max-w-[96rem] px-4 sm:px-6 lg:px-8">
            <Link
              href="/dashboard"
              className="inline-flex min-h-9 items-center gap-2 rounded-pinspace text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to projects
            </Link>
          </div>
        </header>
        <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
          <StatusState role="alert" status="error" title="Workspace unavailable" description={error || 'Workspace not found'} action={<div className="flex flex-wrap gap-3"><Button type="button" onClick={() => void fetchWorkspace()}>Try again</Button><Link href="/dashboard" className={actionLink}>Back to projects</Link></div>} />
        </div>
      </div>
    )
  }

  const instructorName = workspace.members.find((item) => item.role === 'instructor')?.name

  return (
    <div className="min-h-dvh w-full bg-background text-text-primary">
      <header className="border-b border-border bg-background-light py-5">
        <div className="mx-auto w-full max-w-[96rem] px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href="/dashboard"
                aria-label="Back to projects"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pinspace border border-border bg-background-light text-text-secondary shadow-xs transition-colors hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </Link>
              <div className="min-w-0">
                <h1 className="break-words text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
                  {workspace.name}
                </h1>
                <p className="mt-0.5 text-sm font-medium text-text-secondary">
                  {instructorName ? `Owner: ${instructorName}` : 'Organize the project into focused spaces.'}
                </p>
              </div>
            </div>
            <div role="group" aria-label="Page actions" className="flex shrink-0 items-center gap-2">
              <Link
                href={`/workspace/${workspaceId}/settings`}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-pinspace border border-border bg-background-light px-4 py-2 text-sm font-semibold text-text-primary shadow-[var(--shadow-soft)] transition-all hover:border-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                {owner ? 'Settings' : 'Project details'}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center gap-2.5">
          <DoorOpen className="h-5 w-5 text-accent shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-xl font-bold text-text-primary">Spaces</h2>
            <p className="text-sm text-text-secondary">Click a space to enter its 3D studio.</p>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {/* Action Tile / In-Grid Form: Add Space (renders first in grid) */}
          {canAddRoom && (
            addingRoom ? (
              <Card className="relative flex min-h-48 flex-col justify-center p-5 border border-border bg-background-card rounded-pinspace-lg shadow-[var(--shadow-soft)]">
                <form
                  onSubmit={(event) => { event.preventDefault(); void handleCreateRoom() }}
                  className="flex flex-col justify-center gap-3"
                  noValidate
                >
                  <label htmlFor="new-room-name" className="text-base font-bold text-text-primary">
                    Name your new space
                  </label>
                  <Input
                    id="new-room-name"
                    value={newRoomName}
                    maxLength={100}
                    disabled={roomBusy === 'create'}
                    autoFocus
                    aria-invalid={roomError === 'Enter a room name' || roomError === 'Enter a space name'}
                    aria-describedby={roomError ? 'room-error' : undefined}
                    onChange={(event) => { setNewRoomName(event.target.value); setRoomError('') }}
                    onKeyDown={(event) => { if (event.key === 'Escape') { setAddingRoom(false); setNewRoomName(''); setRoomError('') } }}
                    placeholder="e.g. Pin-up 2, Midterm Review"
                  />
                  {roomError && <p id="room-error" role="alert" className="text-xs font-semibold text-[rgb(var(--color-danger))]">{roomError}</p>}
                  <div className="flex items-center gap-2.5 pt-1">
                    <Button type="submit" loading={roomBusy === 'create'}>
                      Create
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={roomBusy === 'create'}
                      onClick={() => { setAddingRoom(false); setNewRoomName(''); setRoomError('') }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Card>
            ) : (
              <button
                type="button"
                onClick={() => { setAddingRoom(true); setRoomError('') }}
                className="group relative flex min-h-48 flex-col items-center justify-center gap-3 rounded-pinspace-lg border-2 border-dashed border-border bg-background-light/50 p-5 text-center transition-all hover:border-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-muted text-accent transition-transform group-hover:scale-110">
                  <Plus className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="text-base font-bold text-text-primary group-hover:text-accent">Add Space</span>
              </button>
            )
          )}

          {rooms.map((room, index) => (
            <RoomCard
              key={room.id}
              room={room}
              index={index}
              total={rooms.length}
              busy={roomBusy === room.id}
              editing={editingRoomId === room.id}
              editingName={editingRoomName}
              nameError={roomError === 'Enter a room name' || roomError === 'Enter a space name'}
              canRename={canRename}
              canShare={canShare}
              canPublish={canPublish}
              canDelete={canDelete}
              canReorder={owner}
              onEditingNameChange={setEditingRoomName}
              onStartRename={(selectedRoom) => { setEditingRoomId(selectedRoom.id); setEditingRoomName(selectedRoom.name); setRoomError('') }}
              onShare={(selectedRoom) => void handleShareRoom(selectedRoom)}
              onSaveRename={(selectedRoom) => void handleRenameRoom(selectedRoom)}
              onCancelRename={() => { setEditingRoomId(null); setEditingRoomName('') }}
              onTogglePublish={(selectedRoom) => void handleTogglePublish(selectedRoom)}
              onDelete={setRoomToDelete}
              onMove={moveRoom}
            />
          ))}
        </div>

        {rooms.length === 0 && !canAddRoom && (
          <EmptyState
            title="No spaces yet"
            description="The project owner has not added any spaces yet."
            icon={<DoorOpen className="h-8 w-8" aria-hidden="true" />}
          />
        )}
      </div>

      <Dialog open={Boolean(roomToShare)} onOpenChange={(open) => { if (!open && !shareBusy) setRoomToShare(null) }} closeOnOutsideClick={!shareBusy} hideCloseButton={shareBusy} title="Share space" description={roomToShare ? `Create a read-only link to “${roomToShare.name}”.` : undefined}>
        {shareBusy && <StatusState role="status" status="loading" title="Creating secure share link…" />}
        {shareError && <StatusState role="alert" status="error" title="Could not create share link" description={shareError} />}
        {shareUrl && <div><label htmlFor="room-share-link" className="mb-1.5 block text-sm font-semibold text-text-primary">Share link</label><div className="flex min-w-0 flex-col gap-3 sm:flex-row"><Input id="room-share-link" readOnly value={shareUrl} className="min-w-0 font-mono text-sm" /><Button type="button" variant="secondary" onClick={() => void copyShareLink()}>{shareCopied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{shareCopied ? 'Copied' : 'Copy share link'}</Button></div><p className="mt-3 text-sm text-text-secondary">Anyone with this link can view the space. Share it only with people you trust.</p></div>}
        <div className="mt-5 flex justify-end"><Button type="button" variant="ghost" disabled={shareBusy} onClick={() => setRoomToShare(null)}>Close</Button></div>
      </Dialog>

      <Dialog open={Boolean(roomToDelete)} onOpenChange={(open) => { if (!open && !roomBusy) setRoomToDelete(null) }} closeOnOutsideClick={!roomBusy} hideCloseButton={Boolean(roomBusy)} title="Delete space?" description={roomToDelete ? `“${roomToDelete.name}” will be permanently deleted.` : undefined}>
        <StatusState status="warning" title="Every board in this space will also be deleted." description="This cannot be undone." />
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={Boolean(roomBusy)} onClick={() => setRoomToDelete(null)}>Cancel</Button>
          <Button type="button" variant="danger" loading={Boolean(roomBusy)} onClick={() => void handleDeleteRoom()}>Delete space</Button>
        </div>
      </Dialog>
    </div>
  )
}
