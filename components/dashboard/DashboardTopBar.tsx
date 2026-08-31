'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { ChevronDown, LogOut, MoreVertical, Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import AvatarMenu from '@/components/AvatarMenu'
import { SuperadminOrgSwitcher } from './SuperadminOrgSwitcher'
import type { OrgBrand } from '@/lib/constants/orgBranding'
import type { DashboardWorkspace, Scope } from './dashboardScope'

/**
 * The dashboard's whole chrome, in one bar.
 *
 * This replaces the left sidebar. The sidebar carried five different kinds of
 * thing stacked in a 256px column — scopes, the studio list, create and join,
 * admin and settings, the profile — and the dashboard beside it then had two
 * more columns of its own, so the page read as three columns of navigation and
 * one of content.
 *
 * Everything that was chrome is now one row, and the row is ordered by what it
 * is: identity on the left, then WHERE you are (scope, then which section), then
 * what you can DO (join, create), then who you are. The studio list is gone as a
 * list — it is the section switcher, which is the only thing the list was
 * actually used for.
 *
 * Admin, Settings and Sign out moved into the avatar menu, which is where an
 * account menu goes and where every other page in the product already keeps it.
 */
/**
 * The per-studio actions that used to live on a sidebar row.
 *
 * Its own component so the switcher row stays readable, and so only one menu is
 * ever open without the bar tracking a second id.
 */
function SectionRowMenu({
  section,
  isOwner,
  onRename,
  onDelete,
  onLeave,
  onDone,
}: {
  section: DashboardWorkspace
  isOwner: boolean
  onRename: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
  onLeave: (id: string, name: string) => void
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const name = section.name || ''

  return (
    <div className="relative shrink-0 pr-1">
      <button
        type="button"
        aria-label={`Actions for ${name || 'this studio'}`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        // Faintly visible at rest, not opacity-0: hover never fires on a touch
        // screen, and all three actions would be unreachable on a phone.
        className="rounded-full p-1.5 text-[#8A8FA0] opacity-50 transition-all hover:bg-[#16181D]/[0.08] hover:text-[#16181D] group-hover:opacity-100"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-[60] w-44 rounded-2xl border border-[#16181D]/[0.08] bg-white py-1.5 shadow-[0_20px_50px_rgba(22,24,29,0.18)]">
          <button
            type="button"
            onClick={() => { onRename(section.id, name); setOpen(false); onDone() }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#16181D] hover:bg-[#3B6EF6]/5"
          >
            <Pencil className="h-4 w-4" /> Rename
          </button>
          {isOwner ? (
            <button
              type="button"
              onClick={() => { onDelete(section.id, name); setOpen(false); onDone() }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#C2452D] hover:bg-[#C2452D]/[0.08]"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { onLeave(section.id, name); setOpen(false); onDone() }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#C2452D] hover:bg-[#C2452D]/[0.08]"
            >
              <LogOut className="h-4 w-4" /> Leave studio
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function DashboardTopBar({
  currentScope,
  onScopeChange,
  hasOrganization,
  orgLabel,
  brand,
  sections,
  currentWorkspaceId,
  onSelectWorkspace,
  canCreate,
  onCreate,
  createLabel,
  showJoin,
  onShowJoinModal,
  userEmail,
  isAdmin,
  onSignOut,
  userId,
  onRename,
  onDelete,
  onLeave,
}: {
  currentScope: Scope
  onScopeChange: (scope: Scope) => void
  hasOrganization: boolean
  orgLabel: string
  /** Null for an org with no artwork, and on the personal tab. */
  brand: OrgBrand | null
  /** The live studios in this scope — what the switcher offers. */
  sections: DashboardWorkspace[]
  currentWorkspaceId: string | null
  onSelectWorkspace: (id: string) => void
  canCreate: boolean
  onCreate: () => void
  createLabel: string
  showJoin: boolean
  onShowJoinModal: () => void
  userEmail: string | null | undefined
  isAdmin: boolean
  onSignOut: () => void
  /**
   * Rename, delete and leave, on the switcher's rows.
   *
   * These were the sidebar list's row menu. The list is this dropdown now,
   * so they came with it — without somewhere to hang them, deleting a studio
   * from the dashboard would simply have stopped existing. Owner gets Delete,
   * everybody else gets Leave, the same rule as before.
   */
  userId: string | null | undefined
  onRename: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
  onLeave: (id: string, name: string) => void
}) {
  const pathname = usePathname()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  const current = sections.find((s) => s.id === currentWorkspaceId) ?? null

  const navPill = (active: boolean) =>
    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
      active ? 'text-[#16181D]' : 'text-[#5A5E6B] hover:bg-[#16181D]/[0.04]'
    }`

  return (
    <header className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-2.5">
      <Link href="/" className="mr-1 shrink-0 transition-opacity hover:opacity-80">
        <span className="text-[17px] font-extrabold tracking-[-0.04em] text-[#16181D]">
          pinspace
          <span
            aria-hidden="true"
            className="ml-[0.06em] inline-block h-[0.2em] w-[0.2em] rounded-full bg-[#3B6EF6] align-baseline"
          />
        </span>
      </Link>

      {/* Where you are. The org tab wears its own colour when it has one —
          the only tinted thing in the bar, because it is the only one that
          belongs to somebody other than pinspace. */}
      {hasOrganization && (
        <button
          type="button"
          onClick={() => onScopeChange('wentworth')}
          aria-current={currentScope === 'wentworth' ? 'page' : undefined}
          className={navPill(currentScope === 'wentworth')}
          style={
            currentScope === 'wentworth' && brand
              ? { background: brand.accentSoft }
              : undefined
          }
        >
          {brand && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.mark} alt="" aria-hidden="true" className="h-5 w-5" />
          )}
          {orgLabel}
        </button>
      )}
      <button
        type="button"
        onClick={() => onScopeChange('personal')}
        aria-current={currentScope === 'personal' ? 'page' : undefined}
        className={`${navPill(currentScope === 'personal')} ${
          currentScope === 'personal' ? 'bg-[#16181D]/[0.06]' : ''
        }`}
      >
        Personal
      </button>
      {/* Superadmin-only, and it self-gates — renders nothing for everyone
          else, verified server-side by its own endpoint. Kept from the sidebar
          rather than dropped with it: it is the only way a superadmin reaches
          another institution's network, and it costs a normal account nothing
          because it does not render. */}
      <SuperadminOrgSwitcher />

      <Link
        href="/desk-crits"
        aria-current={pathname === '/desk-crits' ? 'page' : undefined}
        className={navPill(false)}
      >
        Desk crits
      </Link>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Which section the page is about.
            This IS the old sidebar list: the list's only job was picking one to
            look at, and a permanent column of names to make one choice is a
            column spent on a dropdown. The green dot is the same mark the
            Current studio card uses, so the two read as one selection. */}
        {sections.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              aria-expanded={switcherOpen}
              aria-haspopup="true"
              className="flex max-w-[15rem] items-center gap-2 rounded-xl border border-[#16181D]/[0.12] px-3 py-2 text-sm font-semibold text-[#16181D] transition-colors hover:bg-[#16181D]/[0.04]"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2FA96B]" />
              <span className="truncate">{current?.name ?? 'Pick a studio'}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[#8A8FA0] transition-transform ${switcherOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {switcherOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSwitcherOpen(false)} aria-hidden />
                <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-[#16181D]/10 bg-white shadow-2xl">
                  <ul className="max-h-80 overflow-y-auto py-1">
                    {sections.map((section) => {
                      const isCurrent = section.id === currentWorkspaceId
                      const rooms = section.room_count ?? 0
                      const boards = section.board_count ?? 0
                      return (
                        <li key={section.id}>
                          <div
                            className="group flex items-center"
                            style={{
                              borderLeft: `3px solid ${isCurrent ? '#2FA96B' : 'transparent'}`,
                              background: isCurrent ? 'rgba(47,169,107,0.08)' : undefined,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => { onSelectWorkspace(section.id); setSwitcherOpen(false) }}
                              aria-pressed={isCurrent}
                              className="flex min-w-0 flex-1 items-start gap-2.5 py-2 pl-2 pr-1 text-left transition-colors hover:bg-[#F4F6FB]"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold text-[#16181D]">
                                  {section.name || 'Unnamed'}
                                </span>
                                <span className="block truncate text-[11px] text-[#8A8FA0]">
                                  {rooms} room{rooms === 1 ? '' : 's'} · {boards} board{boards === 1 ? '' : 's'}
                                </span>
                              </span>
                            </button>
                            <SectionRowMenu
                              section={section}
                              isOwner={Boolean(userId) && section.owner_id === userId}
                              onRename={onRename}
                              onDelete={onDelete}
                              onLeave={onLeave}
                              onDone={() => setSwitcherOpen(false)}
                            />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}

        {showJoin && (
          <button
            type="button"
            onClick={onShowJoinModal}
            className="flex items-center gap-1.5 rounded-xl border border-[#16181D]/[0.12] px-3.5 py-2 text-sm font-semibold text-[#5A5E6B] transition-colors hover:bg-[#16181D]/[0.04]"
          >
            <UserPlus className="h-4 w-4" />
            Join with code
          </button>
        )}

        {canCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="flex items-center gap-1.5 rounded-xl bg-[#16181D] px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-[#3B6EF6]"
          >
            <Plus className="h-4 w-4" />
            {createLabel}
          </button>
        )}

        <AvatarMenu email={userEmail} isAdmin={isAdmin} onSignOut={onSignOut} />
      </div>
    </header>
  )
}
