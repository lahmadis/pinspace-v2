'use client'

import Link from 'next/link'
import { useRef, useEffect, useState } from 'react'
import {
  GraduationCap, Users, Building2, MoreVertical, Plus,
  Settings, Trash2, ExternalLink, Pencil, Archive, UserPlus, Network, LogOut,
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
  academic_year?: string
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
  onLeave: (id: string, name: string) => void
}

function RoomCard({
  workspace, isOwner, scope, openMenuId, setOpenMenuId, institutionSlug, onDelete, onRename, onLeave,
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

  return (
    <div className={`group bg-white rounded-2xl border overflow-hidden transition-all duration-200 ${
      isArchived ? 'opacity-60 border-[#16181D]/10' : 'border-[#16181D]/8 shadow-[0_8px_24px_rgba(22,24,29,0.06)] hover:shadow-[0_16px_40px_rgba(22,24,29,0.12)] hover:-translate-y-0.5'
    }`}>
      {/* Thumbnail */}
      <div className={`relative h-36 flex items-center justify-center ${
        isArchived ? 'bg-[#F2F5FB]' : 'bg-gradient-to-br from-[#EDF1F9] to-[#DFE6F2]'
      }`}>
        <IconEl className={`w-10 h-10 ${isArchived ? 'text-[#B6BAC4]' : 'text-[#8A8FA0]'}`} />

        {isArchived && (
          <span className="absolute top-2 left-2 px-2 py-0.5 bg-[#16181D]/10 text-[#5A5E6B] rounded-full text-xs font-semibold flex items-center gap-1">
            <Archive className="w-3 h-3" /> Archived
          </span>
        )}
        {isOwner && !isArchived && (
          <span className="absolute top-2 left-2 px-2.5 py-0.5 bg-white/85 text-[#3B6EF6] rounded-full text-xs font-bold">
            Owner
          </span>
        )}

        {/* Every dashboard card is a workspace the user owns or is a member of
            (the list is owned ∪ member), so Rename is available on all cards
            (Phase 10). Settings + Delete remain owner-only. */}
        <div className="absolute top-2 right-2" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : workspace.id) }}
            className="p-1.5 rounded-full bg-white/70 hover:bg-white text-[#8A8FA0] hover:text-[#16181D] transition-colors shadow-sm opacity-0 group-hover:opacity-100"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-9 w-44 bg-white rounded-2xl shadow-[0_20px_50px_rgba(22,24,29,0.18)] border border-[#16181D]/8 py-1.5 z-10">
              {isOwner && (
                <Link
                  href={withInstitution(`/workspace/${workspace.id}/settings`, institutionSlug)}
                  onClick={() => setOpenMenuId(null)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#16181D] hover:bg-[#3B6EF6]/5"
                >
                  <Settings className="w-4 h-4" /> Settings
                </Link>
              )}
              <button
                type="button"
                onClick={() => { onRename(workspace.id, workspace.name || ''); setOpenMenuId(null) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#16181D] hover:bg-[#3B6EF6]/5 text-left"
              >
                <Pencil className="w-4 h-4" /> Rename
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => onDelete(workspace.id, workspace.name || '')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#C2452D] hover:bg-[#C2452D]/8 text-left"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )}
              {/* Non-owner members can leave. Every non-owned dashboard card is a
                  membership, so !isOwner ⟹ member. Owners get Delete instead. */}
              {!isOwner && (
                <button
                  type="button"
                  onClick={() => { onLeave(workspace.id, workspace.name || ''); setOpenMenuId(null) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#C2452D] hover:bg-[#C2452D]/8 text-left"
                >
                  <LogOut className="w-4 h-4" /> Leave project
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Card body — link */}
      <Link href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)} className="block p-4">
        <h3 className="text-sm font-bold text-[#16181D] mb-1 truncate group-hover:text-[#3B6EF6] transition-colors">
          {workspace.name || 'Unnamed'}
        </h3>
        <div className="flex items-center justify-between">
          <p className="text-xs text-[#8A8FA0]">
            {workspace.board_count !== undefined
              ? `${workspace.board_count} board${workspace.board_count !== 1 ? 's' : ''}`
              : workspace.created_at
              ? new Date(workspace.created_at).toLocaleDateString()
              : ''}
          </p>
          <ExternalLink className="w-3 h-3 text-[#8A8FA0] opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
        </div>
      </Link>
    </div>
  )
}

// ── New Room card ─────────────────────────────────────────────────────────────

function NewRoomCard({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block h-full">
      <div className="group h-full min-h-[168px] bg-white/50 rounded-2xl border-2 border-dashed border-[#16181D]/15 hover:border-[#3B6EF6] hover:bg-[#3B6EF6]/5 transition-all duration-200 flex flex-col items-center justify-center gap-2.5 p-4">
        <div className="w-10 h-10 rounded-full bg-[#16181D]/6 group-hover:bg-[#3B6EF6]/12 flex items-center justify-center transition-colors">
          <Plus className="w-5 h-5 text-[#8A8FA0] group-hover:text-[#3B6EF6] transition-colors" />
        </div>
        <span className="text-sm font-semibold text-[#8A8FA0] group-hover:text-[#3B6EF6] transition-colors text-center">{label}</span>
      </div>
    </Link>
  )
}

// ── Enter Network card ────────────────────────────────────────────────────────

function EnterNetworkCard({ href }: { href: string }) {
  return (
    <Link href={href} className="block h-full">
      <div className="group h-full min-h-[168px] bg-[#3B6EF6] hover:bg-[#16181D] rounded-2xl transition-all duration-200 flex flex-col items-center justify-center gap-2.5 p-4 cursor-pointer shadow-[0_8px_22px_rgba(59,110,246,0.3)] hover:-translate-y-0.5">
        <div className="w-10 h-10 rounded-full bg-white/20 group-hover:bg-white/30 flex items-center justify-center transition-colors">
          <Network className="w-5 h-5 text-white" />
        </div>
        <span className="text-sm font-semibold text-white text-center">Enter Network</span>
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

// One vocabulary for every org type. This used to swap "Project"/"Class" on
// accountMode === 'firm', which doubled the copy surface for no benefit and
// left the firm half effectively untested. Deliberately avoids "room" and
// "studio": both already name the layer BELOW a workspace (a workspace holds
// rooms; /studio/[id] is the 3D room view), so reusing either here would
// collide.
function scopeConfig(
  scope: Scope,
  organization: { name: string; slug: string } | null,
  institutionHome: string | null,
  canCreate: boolean,
): ScopeCfg {
  switch (scope) {
    case 'wentworth':
      return {
        title: organization?.name || 'Network',
        newLabel: 'New Project',
        newHref: withInstitution('/workspace/new', institutionHome),
        emptyTitle: 'Nothing here yet',
        // Students are the people who see this copy most, and the same
        // canCreate flag hides the create affordance from them — telling them
        // to create something is a dead end. Offer only what they can do.
        emptySubtext: canCreate
          ? 'Create one or join with an invite code.'
          : 'Join with an invite code.',
        showJoin: true,
      }
    case 'shared':
      return {
        title: 'Shared Projects',
        newLabel: 'New Shared Project',
        newHref: '/workspace/new?type=shared',
        emptyTitle: 'Nothing here yet',
        emptySubtext: 'Anything you collaborate on with others will appear here.',
        showJoin: true,
      }
    case 'personal':
      return {
        title: 'Personal Projects',
        newLabel: 'New Personal Project',
        newHref: withInstitution('/studio/new', institutionHome),
        emptyTitle: 'Nothing here yet',
        emptySubtext: 'Create one to get started.',
        showJoin: false,
      }
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface DashboardMainProps {
  scope: Scope
  rooms: DashboardWorkspace[]
  userId: string | undefined
  institutionHome: string | null
  loading: boolean
  organization: { name: string; slug: string } | null
  onDelete: (id: string, name: string) => void
  onRename: (id: string, name: string) => void
  onLeave: (id: string, name: string) => void
  onShowJoinModal: () => void
}

export function DashboardMain({
  scope, rooms, userId, institutionHome, loading,
  organization, onDelete, onRename, onLeave, onShowJoinModal,
}: DashboardMainProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const { profile } = useProfile()

  // Only instructors may create org-facing classes (the Wentworth tab). Shared
  // rooms are peer-to-peer collab and Personal rooms are the user's own space —
  // both stay open to everyone. Mirrors the server gate in POST /api/workspaces
  // (type === 'class'); hiding here is UX only, the API is the real boundary.
  const requiresInstructor = scope === 'wentworth'
  const canCreate = !requiresInstructor || profile.accountRole === 'instructor'

  // Enter Network is an org-wide entry point, not a class action. It is gated on
  // nothing at all now — never account_role, never "owns/joined at least one
  // room" — because the grid it lives in renders unconditionally (see below).
  // Deliberately NOT gated on `organization` either: the Wentworth tab is
  // already unreachable without an org (DashboardSidebar renders it behind
  // hasOrganization), and `organization` is null while the profile fetch is in
  // flight or if it fails — re-adding that check would make the card vanish
  // again for the exact users it serves.
  const networkHref =
    scope === 'wentworth'
      ? organization?.slug ? `/explore?institution=${encodeURIComponent(organization.slug)}` : '/explore'
      : scope === 'shared' ? '/network/shared' : '/network'

  const cfg = scopeConfig(scope, organization, institutionHome, canCreate)
  const hasArchived = rooms.some((r) => r.is_archived)
  const visibleRooms = showArchived ? rooms : rooms.filter((r) => !r.is_archived)

  // Reset showArchived when scope changes
  useEffect(() => { setShowArchived(false); setOpenMenuId(null) }, [scope])

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* Top bar */}
      {/* Wrap below sm so the org title + action buttons each get their own
          row on narrow viewports (≤ ~440px) instead of pushing New Project past
          the right edge. min-w-0 on the title lets it shrink rather than
          shove the actions row off, and the actions inner row also wraps so
          three buttons (Show archived / Join with code / New Project) don't
          clip individually on the narrowest phones. sm:flex-nowrap + sm:h-16
          restore the desktop row exactly. */}
      <div className="shrink-0 sm:h-16 flex flex-wrap items-center justify-between gap-2 px-6 py-3 sm:py-0 sm:flex-nowrap border-b border-[#16181D]/8 bg-white/70 backdrop-blur-sm">
        <span className="text-base font-bold text-[#16181D] pl-10 md:pl-0 min-w-0 truncate">{cfg.title}</span>

        <div className="flex flex-wrap items-center gap-2">
          {/* Revealing your own archived rooms is a VIEW action, so it is not
              gated on account_role. It used to be, which made archiving a
              one-way door: a student-account owner can archive a personal or
              shared project (that check is the workspace MEMBER role, and every
              creator is inserted as an instructor member) but could never
              unhide it again, because this check was the ACCOUNT role. The
              rooms are already in `rooms` — this only toggles the filter. */}
          {hasArchived && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                showArchived
                  ? 'bg-[#16181D]/10 text-[#16181D]'
                  : 'border border-[#16181D]/12 text-[#8A8FA0] hover:bg-[#16181D]/5'
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
              className="px-3 py-1.5 border border-[#3B6EF6]/40 text-[#3B6EF6] rounded-full text-xs font-semibold hover:bg-[#3B6EF6]/8 transition-colors flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Join with code
            </button>
          )}
          {canCreate && (
            <Link
              href={cfg.newHref}
              className="px-3.5 py-1.5 bg-[#3B6EF6] text-white rounded-full text-xs font-bold hover:bg-[#16181D] transition-colors flex items-center gap-1.5 shadow-[0_6px_16px_rgba(59,110,246,0.3)]"
            >
              <Plus className="w-3.5 h-3.5" />
              {cfg.newLabel}
            </Link>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-[#16181D]/8 animate-pulse">
                <div className="h-36 bg-[#16181D]/5 rounded-t-2xl" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-[#16181D]/5 rounded w-3/4" />
                  <div className="h-3 bg-[#16181D]/5 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Persistent chrome. Enter Network and New Project are entry points,
                not content, so they render unconditionally rather than inside
                the populated branch of an empty-state ternary — that structure
                is what silently deleted Enter Network for every user with zero
                rooms. Same shape as app/network/page.tsx and app/explore/page.tsx,
                where the header and back link sit outside the ternary, and as
                app/workspace/[id]/page.tsx, where "No spaces yet" renders BELOW
                the grid instead of replacing it. Anything added to this grid
                later inherits the fix. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <EnterNetworkCard href={networkHref} />
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
                  onLeave={onLeave}
                />
              ))}
            </div>

            {visibleRooms.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-[#16181D]/6 flex items-center justify-center mb-4">
                  <Plus className="w-7 h-7 text-[#8A8FA0]" />
                </div>
                <h3 className="text-lg font-bold text-[#16181D] mb-2">{cfg.emptyTitle}</h3>
                <p className="text-sm text-[#5A5E6B] mb-6 max-w-xs">{cfg.emptySubtext}</p>
                <div className="flex gap-2.5 flex-wrap justify-center">
                  {cfg.showJoin && (
                    <button
                      type="button"
                      onClick={onShowJoinModal}
                      className="px-4 py-2 border border-[#3B6EF6]/40 text-[#3B6EF6] rounded-full text-sm font-semibold hover:bg-[#3B6EF6]/8 transition-colors flex items-center gap-1.5"
                    >
                      <UserPlus className="w-4 h-4" /> Join with code
                    </button>
                  )}
                  {canCreate && (
                    <Link
                      href={cfg.newHref}
                      className="px-4 py-2 bg-[#3B6EF6] text-white rounded-full text-sm font-bold hover:bg-[#16181D] transition-colors flex items-center gap-1.5 shadow-[0_8px_22px_rgba(59,110,246,0.3)]"
                    >
                      <Plus className="w-4 h-4" /> {cfg.newLabel}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
