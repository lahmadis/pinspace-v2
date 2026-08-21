'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  DoorOpen,
  Download,
  GraduationCap,
  LayoutDashboard,
  Mail,
  PanelsTopLeft,
  Pencil,
  Plus,
  QrCode,
  Settings,
  Trash2,
  User,
  Users,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'

import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar, Badge, Button, Card, Dialog, EmptyState, IconButton, Input, Skeleton, StatusState } from '@/components/ui'
import { WorkspaceSettingsShimmer } from '@/components/workspace/WorkspaceSettingsShimmer'
import { useAuthSession } from '@/hooks/useAuthSession'
import { toast } from '@/lib/toast'
import type { Room, Workspace } from '@/types'

const QRCodeSVG = dynamic(() => import('qrcode.react').then((module) => module.QRCodeSVG), { ssr: false })

const navigation = [
  { href: '/dashboard', label: 'Projects', icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { href: '/my-boards', label: 'My boards', icon: <PanelsTopLeft className="h-4 w-4" />, exact: true },
]
const footerNavigation = [{ href: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> }]
const linkButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-pinspace border border-border bg-background-light px-4 py-2 text-sm font-semibold text-text-primary shadow-[var(--shadow-soft)] hover:border-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export default function WorkspaceSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.id as string
  const { status: authStatus, user } = useAuthSession()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [editingRoomName, setEditingRoomName] = useState('')
  const [addingRoom, setAddingRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [roomBusy, setRoomBusy] = useState<string | null>(null)
  const [roomError, setRoomError] = useState('')
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null)
  const creatingRoomRef = useRef(false)

  const fetchWorkspace = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || data.details || 'Failed to load workspace')
      if (!data.workspace) throw new Error('Workspace data not found in response')
      setWorkspace(data.workspace)
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
      router.push(`/sign-in?redirect=${encodeURIComponent(`/workspace/${workspaceId}/settings`)}`)
      return
    }
    if (authStatus === 'authenticated') {
      const fetchTimer = window.setTimeout(() => void fetchWorkspace(), 0)
      return () => window.clearTimeout(fetchTimer)
    }
  }, [authStatus, fetchWorkspace, router, workspaceId])

  const isOwner = workspace?.createdBy === user?.id
  const canManage = isOwner
  const rawInviteCode = workspace?.inviteCode || (workspace as unknown as Record<string, unknown>)?.invite_code
  const inviteCode = typeof rawInviteCode === 'string' && rawInviteCode.trim() !== '' && rawInviteCode !== 'undefined' ? rawInviteCode.trim() : null
  const inviteLink = inviteCode && typeof window !== 'undefined' ? `${window.location.origin}/join/${inviteCode}` : ''

  const copyInvite = async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy the invite link')
    }
  }

  const handleArchiveToggle = async (archive: boolean) => {
    if (!workspace || archiving) return
    setArchiving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}/archive`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_archived: archive }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to update workspace')
      setArchiveDialogOpen(false)
      await fetchWorkspace()
      toast.success(archive ? 'Workspace archived' : 'Workspace unarchived')
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : 'Failed to update workspace')
    } finally {
      setArchiving(false)
    }
  }

  const handleExport = async () => {
    if (!workspace || exporting) return
    setExporting(true)
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}/export`, { credentials: 'include' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to export workspace')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const filename = disposition.match(/filename="?([^\"]+)"?/i)?.[1] || `${workspace.name || 'workspace'}_export.zip`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success('Export downloaded')
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : 'Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const createRoom = async () => {
    if (!workspace || creatingRoomRef.current) return
    const name = newRoomName.trim()
    if (!name) { setRoomError('Enter a space name'); return }
    creatingRoomRef.current = true
    setRoomBusy('create')
    setRoomError('')
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to create space')
      setAddingRoom(false)
      setNewRoomName('')
      await fetchWorkspace()
      toast.success(`Created space "${name}"`)
    } catch (caughtError) {
      setRoomError(caughtError instanceof Error ? caughtError.message : 'Failed to create space')
    } finally {
      creatingRoomRef.current = false
      setRoomBusy(null)
    }
  }

  const renameRoom = async (room: Room) => {
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
      await fetchWorkspace()
    } catch (caughtError) {
      setRoomError(caughtError instanceof Error ? caughtError.message : 'Failed to rename space')
    } finally {
      setRoomBusy(null)
    }
  }

  const setWallColor = async (room: Room, wallColor: 'grey' | 'white') => {
    if ((room.wallColor ?? 'grey') === wallColor || roomBusy) return
    setRoomBusy(room.id)
    try {
      const response = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallColor }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to update wall color')
      await fetchWorkspace()
    } catch (caughtError) {
      setRoomError(caughtError instanceof Error ? caughtError.message : 'Failed to update wall color')
    } finally {
      setRoomBusy(null)
    }
  }

  const deleteRoom = async () => {
    if (!roomToDelete || roomBusy) return
    const room = roomToDelete
    setRoomBusy(room.id)
    try {
      const response = await fetch(`/api/rooms/${room.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to delete space')
      setRoomToDelete(null)
      await fetchWorkspace()
      toast.success(`Deleted space "${room.name}"`)
    } catch (caughtError) {
      setRoomError(caughtError instanceof Error ? caughtError.message : 'Failed to delete space')
    } finally {
      setRoomBusy(null)
    }
  }

  const shellProps = { navigation, footerNavigation, currentPath: `/workspace/${workspaceId}/settings`, contentClassName: 'bg-background' }

  if (authStatus === 'loading' || loading) {
    return (
      <AppShell {...shellProps}>
        <div role="status" aria-label="Loading workspace settings">
          <WorkspaceSettingsShimmer />
        </div>
      </AppShell>
    )
  }

  if (error || !workspace) {
    return <AppShell {...shellProps}><div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6"><StatusState role="alert" status="error" title="Workspace settings unavailable" description={error || 'Workspace not found'} action={<div className="flex flex-wrap gap-3"><Button type="button" onClick={() => void fetchWorkspace()}>Try again</Button><Link href="/dashboard" className={linkButton}>Back to projects</Link></div>} /></div></AppShell>
  }

  return (
    <AppShell {...shellProps}>
      <PageHeader
        eyebrow="Project administration"
        title={workspace.name}
        description="Manage spaces, members, access, and project lifecycle."
        actions={
          <Link
            href={`/workspace/${workspace.id}`}
            className="inline-flex min-h-12 items-center justify-center gap-2.5 rounded-pinspace border-transparent bg-primary px-6 py-2.5 text-base font-black text-pinspace-ink shadow-[0_4px_16px_rgba(255,200,0,0.35)] transition-all hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <DoorOpen className="h-5 w-5" aria-hidden="true" />
            Open spaces
          </Link>
        }
      />
      <div className="mx-auto grid w-full max-w-[96rem] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] lg:px-8">
        <div className="min-w-0 space-y-6">
          {canManage && (
            <Card className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-text-primary">
                    <Mail className="h-5 w-5 text-accent" aria-hidden="true" />
                    Invite students
                  </h2>
                  <p className="mt-1 text-sm text-text-secondary">Only the project owner can see and share this access link.</p>
                </div>
                {inviteCode && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowQr((prev) => !prev)}
                    className="shrink-0 text-xs font-semibold text-accent hover:bg-background-lighter"
                  >
                    <QrCode className="mr-1.5 h-4 w-4" />
                    {showQr ? 'Hide QR' : 'Show QR'}
                  </Button>
                )}
              </div>

              {inviteCode ? (
                <div className="mt-5 space-y-4">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                    <Input aria-label="Invite link" readOnly value={inviteLink} className="min-w-0 flex-1 font-mono text-sm" />
                    <Button type="button" variant="secondary" className="min-h-11 shrink-0" onClick={() => void copyInvite()}>
                      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                      {copied ? 'Copied' : 'Copy invite link'}
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Invite code</span>
                      <code className="rounded-pinspace bg-primary-muted px-3 py-1.5 font-mono text-sm font-bold text-text-primary tracking-wider">{inviteCode}</code>
                    </div>

                    {showQr && (
                      <div className="flex items-center gap-3 rounded-pinspace border border-border bg-background-lighter p-3">
                        <QRCodeSVG value={inviteLink} size={110} level="M" includeMargin={false} />
                        <div className="text-xs text-text-secondary">
                          <p className="font-semibold text-text-primary">Scan QR to join</p>
                          <p>Students can scan with camera</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-pinspace bg-background-lighter p-4 text-sm text-text-secondary">
                  No invite code available for this project.
                </div>
              )}
            </Card>
          )}

          {canManage && (
            <Card className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-text-primary">
                    <DoorOpen className="h-5 w-5 text-accent" aria-hidden="true" />
                    Space settings
                  </h2>
                  <p className="mt-1 text-sm text-text-secondary">Rename spaces, choose wall colors, and remove spaces.</p>
                </div>
                {!addingRoom && (
                  <Button type="button" size="sm" className="min-h-11" onClick={() => { setAddingRoom(true); setRoomError('') }}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add space
                  </Button>
                )}
              </div>
              {roomError && <StatusState id="settings-room-error" role="alert" status="error" title={roomError} className="mt-4" />}
              <div className="mt-5 space-y-3">
                {(workspace.rooms ?? []).length === 0 && (
                  <EmptyState title="No spaces yet" description="Add the first space to configure its name and wall color." icon={<DoorOpen className="h-8 w-8" aria-hidden="true" />} />
                )}
                {(workspace.rooms ?? []).map((room) => {
                  const busy = roomBusy === room.id
                  const editing = editingRoomId === room.id
                  return (
                    <div key={room.id} className="flex min-w-0 flex-col gap-3 rounded-pinspace border border-border bg-background-lighter p-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        {editing ? (
                          <form onSubmit={(event) => { event.preventDefault(); void renameRoom(room) }} className="flex min-w-0 flex-col gap-2 sm:flex-row">
                            <label htmlFor={`settings-room-${room.id}`} className="sr-only">Space name</label>
                            <Input id={`settings-room-${room.id}`} value={editingRoomName} maxLength={100} disabled={busy} autoFocus aria-invalid={roomError === 'Enter a space name'} aria-describedby={roomError ? 'settings-room-error' : undefined} onChange={(event) => setEditingRoomName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setEditingRoomId(null) }} />
                            <Button type="submit" size="sm" className="min-h-11" loading={busy}>Save</Button>
                            <Button type="button" size="sm" className="min-h-11" variant="ghost" disabled={busy} onClick={() => setEditingRoomId(null)}>Cancel</Button>
                          </form>
                        ) : (
                          <p className="break-words font-semibold text-text-primary">{room.name}</p>
                        )}
                      </div>
                      {!editing && (
                        <div className="flex flex-wrap items-center gap-2">
                          <fieldset disabled={busy} className="flex min-h-11 items-center gap-1 rounded-pinspace border border-border bg-background-light p-1">
                            <legend className="sr-only">Wall color for {room.name}</legend>
                            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold focus-within:outline-none focus-within:ring-2 focus-within:ring-accent has-[:checked]:bg-primary-muted">
                              <input type="radio" className="sr-only" name={`wall-${room.id}`} checked={(room.wallColor ?? 'grey') === 'grey'} onChange={() => void setWallColor(room, 'grey')} />
                              Grey walls
                            </label>
                            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold focus-within:outline-none focus-within:ring-2 focus-within:ring-accent has-[:checked]:bg-primary-muted">
                              <input type="radio" className="sr-only" name={`wall-${room.id}`} checked={room.wallColor === 'white'} onChange={() => void setWallColor(room, 'white')} />
                              White walls
                            </label>
                          </fieldset>
                          <IconButton label={`Rename ${room.name}`} disabled={busy} onClick={() => { setEditingRoomId(room.id); setEditingRoomName(room.name); setRoomError('') }}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </IconButton>
                          <IconButton label={`Delete ${room.name}`} disabled={busy} className="text-[rgb(var(--color-danger))]" onClick={() => setRoomToDelete(room)}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </IconButton>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {addingRoom && (
                <form onSubmit={(event) => { event.preventDefault(); void createRoom() }} className="mt-4 flex flex-col gap-3 rounded-pinspace border border-border bg-primary-muted p-4 sm:flex-row sm:items-end" noValidate>
                  <div className="min-w-0 flex-1">
                    <label htmlFor="settings-new-room" className="mb-1 block text-sm font-semibold">Space name</label>
                    <Input id="settings-new-room" value={newRoomName} maxLength={100} disabled={roomBusy === 'create'} autoFocus aria-invalid={roomError === 'Enter a space name'} aria-describedby={roomError ? 'settings-room-error' : undefined} onChange={(event) => { setNewRoomName(event.target.value); setRoomError('') }} />
                  </div>
                  <Button type="submit" loading={roomBusy === 'create'}>Create space</Button>
                  <Button type="button" variant="ghost" disabled={roomBusy === 'create'} onClick={() => { setAddingRoom(false); setNewRoomName('') }}>Cancel</Button>
                </form>
              )}
            </Card>
          )}

          <Card className="p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold text-text-primary">
              <Users className="h-5 w-5 text-accent" aria-hidden="true" />
              Members
            </h2>
            <p className="mt-1 text-sm text-text-secondary">{workspace.members.length} {workspace.members.length === 1 ? 'member' : 'members'} in this project.</p>
            <ul className="mt-5 divide-y divide-border" aria-label="Workspace members">
              {workspace.members.map((member) => (
                <li key={member.userId} className="flex min-w-0 flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.name} />
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-text-primary">{member.name}</p>
                      <p className="flex items-center gap-1.5 text-sm text-text-secondary">
                        {member.role === 'instructor' ? <GraduationCap className="h-4 w-4" aria-hidden="true" /> : <User className="h-4 w-4" aria-hidden="true" />}
                        {member.role === 'instructor' ? workspace.type === 'personal' ? 'Owner' : 'Instructor' : 'Student'}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm text-text-muted">Joined {new Date(member.joinedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </Card>

          {canManage && (
            <Card className="p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-text-primary">
                <Archive className="h-5 w-5 text-accent" aria-hidden="true" />
                Project lifecycle
              </h2>
              {workspace.isArchived ? (
                <>
                  <StatusState status="warning" title="This project is archived" description="Members can view boards, but uploads and comments are disabled." className="mt-4" />
                  <Button type="button" variant="secondary" loading={archiving} className="mt-4" onClick={() => void handleArchiveToggle(false)}>
                    <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                    Unarchive project
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-text-secondary">Archiving puts the project in read-only mode. You can restore it later.</p>
                  <Button type="button" variant="danger" className="mt-4" onClick={() => setArchiveDialogOpen(true)}>
                    <Archive className="h-4 w-4" aria-hidden="true" />
                    Archive project
                  </Button>
                </>
              )}
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-6" aria-label="Project details">
          {isOwner && (
            <Card className="p-5 sm:p-6">
              <h2 className="text-lg font-bold text-text-primary">Export</h2>
              <p className="mt-1 text-sm text-text-secondary">Download all boards and a manifest as a zip archive.</p>
              <Button type="button" variant="ghost" className="mt-4 w-full" loading={exporting} onClick={() => void handleExport()}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Download zip
              </Button>
            </Card>
          )}
          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-bold text-text-primary">Project info</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-text-secondary">Created</dt>
                <dd className="font-semibold text-text-primary">{new Date(workspace.createdAt).toLocaleDateString()}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-text-secondary">Type</dt>
                <dd><Badge className="capitalize">{workspace.type}</Badge></dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-text-secondary">Studio ID</dt>
                <dd className="max-w-full break-all font-mono text-xs text-text-primary">{workspace.studioId}</dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>

      <Dialog open={archiveDialogOpen} onOpenChange={(open) => { if (!archiving) setArchiveDialogOpen(open) }} closeOnOutsideClick={!archiving} hideCloseButton={archiving} title="Archive project?" description={`“${workspace.name}” will become read-only for every member.`}>
        <StatusState status="warning" title="Uploads and comments will be paused" description="You can unarchive the project later." />
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={archiving} onClick={() => setArchiveDialogOpen(false)}>Cancel</Button>
          <Button type="button" variant="danger" loading={archiving} onClick={() => void handleArchiveToggle(true)}>{archiving ? 'Archiving…' : 'Archive project'}</Button>
        </div>
      </Dialog>
      <Dialog open={Boolean(roomToDelete)} onOpenChange={(open) => { if (!open && !roomBusy) setRoomToDelete(null) }} closeOnOutsideClick={!roomBusy} hideCloseButton={Boolean(roomBusy)} title="Delete space?" description={roomToDelete ? `“${roomToDelete.name}” will be permanently deleted.` : undefined}>
        <StatusState status="warning" title="Every board in this space will also be deleted." description="This cannot be undone." />
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={Boolean(roomBusy)} onClick={() => setRoomToDelete(null)}>Cancel</Button>
          <Button type="button" variant="danger" loading={Boolean(roomBusy)} onClick={() => void deleteRoom()}>Delete space</Button>
        </div>
      </Dialog>
    </AppShell>
  )
}
