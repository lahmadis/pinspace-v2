'use client'

import Link from 'next/link'
import { useRef, useEffect, useState } from 'react'
import {
  GraduationCap, Users, Building2, MoreVertical, Plus,
  Settings, Trash2, Pencil, Archive, UserPlus, LogOut, ArrowRight,
} from 'lucide-react'
import { useProfile } from '@/lib/ProfileContext'
import { scopeConfig, withInstitution, metaLine } from './dashboardScope'
import type { Scope, DashboardWorkspace } from './dashboardScope'

// Re-exported so /dashboard and /archive keep importing this type from here.
export type { DashboardWorkspace } from './dashboardScope'

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
  workspace, isOwner, scope, openMenuId, setOpenMenuId, institutionSlug,
  onDelete, onRename, onLeave,
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

  const rooms = workspace.room_count ?? 0
  const boards = workspace.board_count ?? 0
  // Counts only. Department and academic_year are set on 16% and 48% of rows,
  // so a card that leads with them is blank for most studios; these two are
  // computed server-side for every workspace and are always true.
  const footerMeta = metaLine([
    rooms > 0 ? `${rooms} room${rooms === 1 ? '' : 's'}` : null,
    `${boards} board${boards === 1 ? '' : 's'}`,
  ])
  // Shown only when actually present, hence metaLine rather than a template.
  const subMeta = metaLine([workspace.network_metadata?.department, workspace.academic_year])

  const created = workspace.created_at
    ? new Date(workspace.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null

  return (
    <div
      className={`group relative flex flex-col rounded-3xl border bg-white p-4 transition-shadow duration-200 ${
        isArchived
          ? 'border-[#16181D]/10 opacity-70'
          : 'border-[#16181D]/[0.08] shadow-[0_8px_24px_rgba(22,24,29,0.05)] hover:shadow-[0_16px_40px_rgba(22,24,29,0.10)]'
      }`}
    >
      {/* Top row: archived state (when it applies) + created date.
          There is no pill on a live studio: every card on this dashboard is one
          you own or belong to, so "Yours" was true of nearly all of them and
          told you nothing. Archived is the only state here worth marking. */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        {isArchived ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#16181D]/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#5A5E6B]">
            <Archive className="h-3 w-3" /> Archived
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          {created && <span className="text-[11px] text-[#8A8FA0]">{created}</span>}

          {/* Every dashboard card is a workspace the user owns or is a member of
              (the list is owned ∪ member), so Rename is available on all cards.
              Settings + Delete remain owner-only.

              Faintly visible at rest rather than opacity-0: hover never fires on
              a touch screen, so the old version put Rename, Delete and Leave
              permanently out of reach on a phone. */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="Studio actions"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : workspace.id) }}
              className="rounded-full p-1.5 text-[#8A8FA0] opacity-50 transition-all hover:bg-[#16181D]/5 hover:text-[#16181D] group-hover:opacity-100"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 top-9 z-20 w-44 rounded-2xl border border-[#16181D]/[0.08] bg-white py-1.5 shadow-[0_20px_50px_rgba(22,24,29,0.18)]">
                {isOwner && (
                  <Link
                    href={withInstitution(`/workspace/${workspace.id}/settings`, institutionSlug)}
                    onClick={() => setOpenMenuId(null)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#16181D] hover:bg-[#3B6EF6]/5"
                  >
                    <Settings className="h-4 w-4" /> Settings
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => { onRename(workspace.id, workspace.name || ''); setOpenMenuId(null) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#16181D] hover:bg-[#3B6EF6]/5"
                >
                  <Pencil className="h-4 w-4" /> Rename
                </button>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => onDelete(workspace.id, workspace.name || '')}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#C2452D] hover:bg-[#C2452D]/[0.08]"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                )}
                {/* Non-owner members can leave. Every non-owned dashboard card is a
                    membership, so !isOwner ⟹ member. Owners get Delete instead. */}
                {!isOwner && (
                  <button
                    type="button"
                    onClick={() => { onLeave(workspace.id, workspace.name || ''); setOpenMenuId(null) }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#C2452D] hover:bg-[#C2452D]/[0.08]"
                  >
                    <LogOut className="h-4 w-4" /> Leave studio
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Title */}
      <Link href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)} className="block">
        <h3 className="truncate text-[17px] font-extrabold tracking-[-0.02em] text-[#16181D] transition-colors hover:text-[#3B6EF6]">
          {workspace.name || 'Unnamed'}
        </h3>
      </Link>
      {subMeta && <p className="mt-0.5 truncate text-xs text-[#8A8FA0]">{subMeta}</p>}

      {/* Preview. A tinted panel, not a render — studios have no thumbnail yet.
          aspect-[4/3] is what makes the card shrink gracefully: the panel
          rescales with the column instead of holding a fixed height. */}
      <Link
        href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)}
        className="mt-3 block overflow-hidden rounded-2xl border border-[#16181D]/[0.06]"
      >
        <div
          className="flex aspect-[4/3] items-center justify-center"
          style={{ background: isArchived
            ? 'linear-gradient(150deg, #F2F4F8, #E9ECF3)'
            : 'linear-gradient(150deg, #EEF3FC, #DCE5F5)' }}
        >
          <IconEl className={`h-9 w-9 ${isArchived ? 'text-[#B6BAC4]' : 'text-[#9FB0CE]'}`} />
        </div>
      </Link>

      {/* Footer meta + actions */}
      <p className="mt-3 text-xs text-[#8A8FA0]">{footerMeta}</p>

      <Link
        href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)}
        className="mt-3 block rounded-full bg-[#16181D] px-4 py-2.5 text-center text-[13px] font-bold text-white transition-colors hover:bg-[#3B6EF6]"
      >
        Open studio
      </Link>
    </div>
  )
}

// ── New Room card ─────────────────────────────────────────────────────────────

function NewRoomCard({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block h-full">
      <div className="group flex h-full min-h-[220px] flex-col items-center justify-center gap-2.5 rounded-3xl border-2 border-dashed border-[#16181D]/[0.12] bg-white/40 p-4 transition-colors duration-200 hover:border-[#3B6EF6] hover:bg-[#3B6EF6]/5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#16181D]/[0.06] transition-colors group-hover:bg-[#3B6EF6]/[0.12]">
          <Plus className="h-5 w-5 text-[#8A8FA0] transition-colors group-hover:text-[#3B6EF6]" />
        </div>
        <span className="text-center text-sm font-semibold text-[#8A8FA0] transition-colors group-hover:text-[#3B6EF6]">{label}</span>
      </div>
    </Link>
  )
}

// ── Enter Network card ────────────────────────────────────────────────────────

/**
 * The one dark surface on the dashboard. It is the only element here that is a
 * place rather than a list item, and the contrast is what says so.
 */
function EnterNetworkCard({ href, studioCount }: { href: string; studioCount: number }) {
  return (
    <Link href={href} className="block h-full">
      <div
        className="group relative flex h-full min-h-[220px] flex-col justify-between overflow-hidden rounded-3xl p-6 transition-shadow duration-200 hover:shadow-[0_20px_50px_rgba(22,24,29,0.28)]"
        style={{ background: 'linear-gradient(150deg, #171A24 0%, #1D2436 55%, #27365C 100%)' }}
      >
        {/* Decorative bubbles, echoing what the network itself renders. */}
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-16 -right-10 h-56 w-56 rounded-full bg-[#3B6EF6]/25 blur-[2px]" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-6 right-24 h-24 w-24 rounded-full bg-white/[0.06]" />

        <div className="relative">
          <h3 className="text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-white">
            The bubble<br />network
          </h3>
          <p className="mt-2.5 max-w-[15rem] text-[13px] leading-relaxed text-white/60">
            {studioCount > 0
              ? `${studioCount} studio${studioCount === 1 ? '' : 's'} in one space. `
              : ''}
            Walk the walls, read the boards, leave a crit.
          </p>
        </div>

        <span className="relative mt-5 inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-bold text-[#16181D] transition-transform duration-200 group-hover:translate-x-0.5">
          Enter
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  )
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
  const isInstructor = profile.accountRole === 'instructor'
  const canCreate = !requiresInstructor || isInstructor

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
  const openCount = rooms.filter((r) => !r.is_archived).length
  const archivedCount = rooms.length - openCount

  // Header meta, from counts alone — see dashboardScope.metaLine for why this
  // isn't the mockup's "Architecture · Autumn 2026" template.
  const headerMeta = metaLine([
    `${openCount} studio${openCount === 1 ? '' : 's'} open`,
    archivedCount > 0 ? `${archivedCount} archived` : null,
  ])

  /**
   * The card grid shrinks its cells as studios accumulate rather than holding
   * one fixed size and wrapping: a lone studio gets a wide card, a term with
   * six gets six small ones. Written as whole literal class strings because
   * Tailwind scans source text and cannot resolve an interpolated column count.
   */
  const gridCols =
    visibleRooms.length <= 1
      ? 'grid-cols-1 lg:grid-cols-2'
      : visibleRooms.length === 2
        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

  // Reset showArchived when scope changes
  useEffect(() => { setShowArchived(false); setOpenMenuId(null) }, [scope])

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#F4F6FB]">
      {/* Header. Wraps below sm so the title and the action buttons each get
          their own row on narrow viewports instead of the buttons being pushed
          past the right edge; min-w-0 lets the title shrink rather than shove
          them off. */}
      <div className="shrink-0 border-b border-[#16181D]/[0.06] bg-white/60 px-6 pb-4 pt-5 backdrop-blur-sm sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate pl-10 text-[26px] font-extrabold tracking-[-0.035em] text-[#16181D] md:pl-0">
              {cfg.title}
            </h1>
            <p className="mt-0.5 pl-10 text-[13px] text-[#8A8FA0] md:pl-0">{headerMeta}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Revealing your own archived rooms is a VIEW action, so it is not
                gated on account_role. It used to be, which made archiving a
                one-way door: a student-account owner can archive a personal or
                shared studio (that check is the workspace MEMBER role, and every
                creator is inserted as an instructor member) but could never
                unhide it again, because this check was the ACCOUNT role. The
                rooms are already in `rooms` — this only toggles the filter. */}
            {hasArchived && (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  showArchived
                    ? 'bg-[#16181D]/10 text-[#16181D]'
                    : 'border border-[#16181D]/[0.12] text-[#8A8FA0] hover:bg-[#16181D]/5'
                }`}
              >
                <Archive className="h-3.5 w-3.5" />
                {showArchived ? 'Hide archived' : 'Show archived'}
              </button>
            )}
            {cfg.showJoin && (
              <button
                type="button"
                onClick={onShowJoinModal}
                className="flex items-center gap-1.5 rounded-full border border-[#3B6EF6]/40 px-3 py-1.5 text-xs font-semibold text-[#3B6EF6] transition-colors hover:bg-[#3B6EF6]/[0.08]"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Join with code
              </button>
            )}
            {canCreate && (
              <Link
                href={cfg.newHref}
                className="flex items-center gap-1.5 rounded-full bg-[#16181D] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#3B6EF6]"
              >
                <Plus className="h-3.5 w-3.5" />
                {cfg.newLabel}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse rounded-3xl border border-[#16181D]/[0.08] bg-white p-4">
                <div className="mb-3 h-4 w-1/3 rounded bg-[#16181D]/5" />
                <div className="mb-3 h-5 w-3/4 rounded bg-[#16181D]/5" />
                <div className="aspect-[4/3] rounded-2xl bg-[#16181D]/5" />
                <div className="mt-3 h-9 rounded-full bg-[#16181D]/5" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Persistent chrome. Enter Network and New Studio are entry points,
                not content, so they render unconditionally rather than inside
                the populated branch of an empty-state ternary — that structure
                is what silently deleted Enter Network for every user with zero
                rooms. Anything added to this grid later inherits the fix. */}
            <div className={`grid gap-5 ${gridCols}`}>
              <EnterNetworkCard href={networkHref} studioCount={openCount} />
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
              {canCreate && <NewRoomCard href={cfg.newHref} label={cfg.newLabel} />}
            </div>

            {visibleRooms.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <h3 className="mb-2 text-lg font-bold text-[#16181D]">{cfg.emptyTitle}</h3>
                <p className="mb-6 max-w-xs text-sm text-[#5A5E6B]">{cfg.emptySubtext}</p>
                <div className="flex flex-wrap justify-center gap-2.5">
                  {cfg.showJoin && (
                    <button
                      type="button"
                      onClick={onShowJoinModal}
                      className="flex items-center gap-1.5 rounded-full border border-[#3B6EF6]/40 px-4 py-2 text-sm font-semibold text-[#3B6EF6] transition-colors hover:bg-[#3B6EF6]/[0.08]"
                    >
                      <UserPlus className="h-4 w-4" /> Join with code
                    </button>
                  )}
                  {canCreate && (
                    <Link
                      href={cfg.newHref}
                      className="flex items-center gap-1.5 rounded-full bg-[#16181D] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#3B6EF6]"
                    >
                      <Plus className="h-4 w-4" /> {cfg.newLabel}
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
