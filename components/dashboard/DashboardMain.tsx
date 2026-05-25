'use client'

import Link from 'next/link'
import { useRef, useEffect, useState } from 'react'
import {
  GraduationCap, Users, Building2, MoreVertical, Plus,
  Settings, Trash2, ExternalLink, Pencil, Archive, UserPlus, Network,
} from 'lucide-react'
import type { Workspace } from '@/types'
import type { Scope } from './DashboardSidebar'
import { useProfile } from '@/lib/ProfileContext'

// ── Shared type ───────────────────────────────────────────────────────────────

export type DashboardWorkspace = Workspace & {
  owner_id?: string
  board_count?: number
  created_at?: string
  description?: string
  is_archived?: boolean
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function withInstitution(path: string, slug: string | null): string {
  if (!slug) return path
  return `${path}${path.includes('?') ? '&' : '?'}institution=${encodeURIComponent(slug)}`
}

// ── RoomCard ──────────────────────────────────────────────────────────────────

interface RoomCardProps {
  workspace: DashboardWorkspace
  isOwner: boolean
  scope: Scope
  openMenuId: string | null
  setOpenMenuId: (id: string | null) => void
  institutionSlug: string | null
  onDelete: (id: string, name: string) => void
  onRename: (id: string, name: string) => void
}

function RoomCard({
  workspace, isOwner, scope, openMenuId, setOpenMenuId, institutionSlug, onDelete, onRename,
}: RoomCardProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const isMenuOpen = openMenuId === workspace.id
  const isArchived = Boolean(workspace.is_archived)

  useEffect(() => {
    if (!isMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isMenuOpen, setOpenMenuId])

  const IconEl = scope === 'wentworth' ? GraduationCap : scope === 'shared' ? Users : Building2
  const iconColor = scope === 'wentworth' ? 'text-indigo-400' : scope === 'shared' ? 'text-emerald-400' : 'text-slate-400'

  return (
    <div className={`group bg-white rounded-xl border overflow-hidden transition-all duration-200 ${
      isArchived ? 'opacity-60 border-gray-200' : 'border-gray-200 hover:shadow-md hover:-translate-y-0.5'
    }`}>
      {/* Thumbnail */}
      <div className={`relative h-36 flex items-center justify-center ${
        isArchived ? 'bg-gray-50' : 'bg-gradient-to-br from-indigo-50 to-slate-100'
      }`}>
        <IconEl className={`w-10 h-10 ${isArchived ? 'text-gray-300' : iconColor}`} />

        {isArchived && (
          <span className="absolute top-2 left-2 px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs font-medium flex items-center gap-1">
            <Archive className="w-3 h-3" /> Archived
          </span>
        )}
        {isOwner && !isArchived && (
          <span className="absolute top-2 left-2 px-2 py-0.5 bg-white/80 text-indigo-700 rounded text-xs font-medium">
            Owner
          </span>
        )}

        {isOwner && (
          <div className="absolute top-2 right-2" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : workspace.id) }}
              className="p-1.5 rounded-lg bg-white/70 hover:bg-white text-gray-500 hover:text-gray-700 transition-colors shadow-sm opacity-0 group-hover:opacity-100"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 top-9 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                <Link
                  href={withInstitution(`/workspace/${workspace.id}/settings`, institutionSlug)}
                  onClick={() => setOpenMenuId(null)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Settings className="w-4 h-4" /> Settings
                </Link>
                <button
                  type="button"
                  onClick={() => { onRename(workspace.id, workspace.name || ''); setOpenMenuId(null) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left"
                >
                  <Pencil className="w-4 h-4" /> Rename
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(workspace.id, workspace.name || '')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 text-left"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Card body — link */}
      <Link href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)} className="block p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-1 truncate group-hover:text-indigo-600 transition-colors">
          {workspace.name || 'Unnamed'}
        </h3>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {workspace.board_count !== undefined
              ? `${workspace.board_count} board${workspace.board_count !== 1 ? 's' : ''}`
              : workspace.created_at
              ? new Date(workspace.created_at).toLocaleDateString()
              : ''}
          </p>
          <ExternalLink className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
        </div>
      </Link>
    </div>
  )
}

// ── New Room card ─────────────────────────────────────────────────────────────

function NewRoomCard({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block h-full">
      <div className="group h-full min-h-[168px] bg-white rounded-xl border-2 border-dashed border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all duration-200 flex flex-col items-center justify-center gap-2.5 p-4">
        <div className="w-10 h-10 rounded-full bg-gray-100 group-hover:bg-indigo-100 flex items-center justify-center transition-colors">
          <Plus className="w-5 h-5 text-gray-400 group-hover:text-indigo-600 transition-colors" />
        </div>
        <span className="text-sm font-medium text-gray-500 group-hover:text-indigo-600 transition-colors text-center">{label}</span>
      </div>
    </Link>
  )
}

// ── Enter Network card ────────────────────────────────────────────────────────

function EnterNetworkCard({ href }: { href: string }) {
  return (
    <Link href={href} className="block h-full">
      <div className="group h-full min-h-[168px] bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all duration-200 flex flex-col items-center justify-center gap-2.5 p-4 cursor-pointer shadow-sm hover:shadow-md hover:-translate-y-0.5">
        <div className="w-10 h-10 rounded-full bg-white/20 group-hover:bg-white/30 flex items-center justify-center transition-colors">
          <Network className="w-5 h-5 text-white" />
        </div>
        <span className="text-sm font-medium text-white text-center">Enter Network</span>
      </div>
    </Link>
  )
}

// ── Scope config ──────────────────────────────────────────────────────────────

interface ScopeCfg {
  title: string
  newLabel: string
  newHref: string
  emptyTitle: string
  emptySubtext: string
  showJoin: boolean
}

function scopeConfig(
  scope: Scope,
  accountMode: string,
  organization: { name: string; slug: string } | null,
  institutionHome: string | null,
): ScopeCfg {
  const noun = accountMode === 'firm' ? 'Room' : 'Class'
  switch (scope) {
    case 'wentworth':
      return {
        title: organization?.name || (accountMode === 'firm' ? 'Firm Rooms' : 'Network'),
        newLabel: `New ${noun}`,
        newHref: withInstitution('/workspace/new', institutionHome),
        emptyTitle: `No ${noun.toLowerCase()}s yet`,
        emptySubtext: accountMode === 'firm'
          ? 'Create a firm room or join one with an invite code.'
          : 'Create a class or join one with an invite code.',
        showJoin: true,
      }
    case 'shared':
      return {
        title: 'Shared Rooms',
        newLabel: 'New Shared Room',
        newHref: '/workspace/new?type=shared',
        emptyTitle: 'No shared rooms yet',
        emptySubtext: 'Rooms you collaborate on with others will appear here.',
        showJoin: true,
      }
    case 'personal':
      return {
        title: 'Personal Rooms',
        newLabel: 'New Personal Room',
        newHref: withInstitution('/studio/new', institutionHome),
        emptyTitle: 'No personal rooms yet',
        emptySubtext: 'Create your first room to get started.',
        showJoin: false,
      }
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface DashboardMainProps {
  scope: Scope
  rooms: DashboardWorkspace[]
  userId: string | undefined
  accountMode: string
  institutionHome: string | null
  loading: boolean
  organization: { name: string; slug: string } | null
  onDelete: (id: string, name: string) => void
  onRename: (id: string, name: string) => void
  onShowJoinModal: () => void
}

export function DashboardMain({
  scope, rooms, userId, accountMode, institutionHome, loading,
  organization, onDelete, onRename, onShowJoinModal,
}: DashboardMainProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const { profile } = useProfile()

  // Only instructors may create institution-facing rooms (classes + shared).
  // Personal rooms stay open to everyone. This mirrors the server gate in
  // POST /api/workspaces — hiding here is UX only; the API is the real boundary.
  const requiresInstructor = scope === 'wentworth' || scope === 'shared'
  const canCreate = !requiresInstructor || profile.accountRole === 'instructor'

  const cfg = scopeConfig(scope, accountMode, organization, institutionHome)
  const hasArchived = rooms.some((r) => r.is_archived)
  const visibleRooms = showArchived ? rooms : rooms.filter((r) => !r.is_archived)

  // Reset showArchived when scope changes
  useEffect(() => { setShowArchived(false); setOpenMenuId(null) }, [scope])

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 h-16 flex items-center justify-between px-6 border-b border-gray-200 bg-white">
        <span className="text-base font-semibold text-gray-900 pl-10 md:pl-0">{cfg.title}</span>

        <div className="flex items-center gap-2">
          {hasArchived && profile.accountRole === 'instructor' && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                showArchived
                  ? 'bg-gray-200 text-gray-700'
                  : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              {showArchived ? 'Hide archived' : 'Show archived'}
            </button>
          )}
          {cfg.showJoin && (
            <button
              type="button"
              onClick={onShowJoinModal}
              className="px-3 py-1.5 border border-indigo-400 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-50 transition-colors flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Join with code
            </button>
          )}
          {canCreate && (
            <Link
              href={cfg.newHref}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              {cfg.newLabel}
            </Link>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 animate-pulse">
                <div className="h-36 bg-gray-100 rounded-t-xl" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Plus className="w-7 h-7 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{cfg.emptyTitle}</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-xs">{cfg.emptySubtext}</p>
            <div className="flex gap-2.5 flex-wrap justify-center">
              {cfg.showJoin && (
                <button
                  type="button"
                  onClick={onShowJoinModal}
                  className="px-4 py-2 border border-indigo-400 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" /> Join with code
                </button>
              )}
              {canCreate && (
                <Link
                  href={cfg.newHref}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4" /> {cfg.newLabel}
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {scope === 'wentworth' && (
              <EnterNetworkCard href={organization?.slug ? `/explore?institution=${encodeURIComponent(organization.slug)}` : '/explore'} />
            )}
            {scope === 'personal' && <EnterNetworkCard href="/network" />}
            {scope === 'shared' && <EnterNetworkCard href="/network/shared" />}
            {canCreate && <NewRoomCard href={cfg.newHref} label={cfg.newLabel} />}
            {visibleRooms.map((room) => (
              <RoomCard
                key={room.id}
                workspace={room}
                isOwner={room.owner_id === userId}
                scope={scope}
                openMenuId={openMenuId}
                setOpenMenuId={setOpenMenuId}
                institutionSlug={institutionHome}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
