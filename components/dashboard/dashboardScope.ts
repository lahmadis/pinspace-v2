import type { Workspace } from '@/types'

/**
 * Vocabulary shared by DashboardSidebar and DashboardMain.
 *
 * These lived in the two components — `Scope` in the sidebar, `scopeConfig` and
 * `withInstitution` in the main pane — which was fine while only the main pane
 * needed the config. The sidebar now renders its own studio list, so it needs
 * the same `listLabel` the main pane derives. Importing across the two would
 * make the pair circular; a third module both can read does not.
 *
 * `Scope` and `DashboardWorkspace` are re-exported from their original homes, so
 * the three pages that already import them (/dashboard, /archive, /settings) are
 * untouched by the move.
 */

/**
 * 'shared' is gone as a scope. It was never a different kind of place from
 * 'personal' — it was a personal space with someone else in it, declared at
 * creation time and then unable to change its mind. Sharing is now something
 * you DO to a personal space (see isSharedWorkspace), so it needs a badge, not
 * a tab.
 */
export type Scope = 'wentworth' | 'personal'

/**
 * A workspace as the dashboard actually receives it.
 *
 * `Workspace` in types/index.ts is the camelCase ideal; GET /api/workspaces does
 * `select('*')`, so what arrives is the raw snake_case row plus the counts the
 * route computes. The snake_case members below are the columns that genuinely
 * exist on the table — `semester` is in the Workspace type but was never added
 * to the database, which is why the term line reads from `academic_year`.
 */
export type DashboardWorkspace = Workspace & {
  owner_id?: string
  board_count?: number
  /** Added by GET /api/workspaces alongside board_count. */
  room_count?: number
  created_at?: string
  description?: string
  is_archived?: boolean
  academic_year?: string
  /**
   * jsonb. Carries department/year, and is populated on ~16% of rows. `studio`
   * joins them for sections created through the new-section dialog; rows that
   * predate it have the first two and not the third, which is why every
   * consumer has to treat it as optional rather than assume the trio.
   */
  network_metadata?: { department?: string; year?: string; studio?: string } | null
  invite_code?: string
  instructor?: string
  /** From GET /api/workspaces — every row in workspace_members, owner included. */
  member_count?: number
}

/**
 * Is this space shared with anyone?
 *
 * TWO, not one: POST /api/workspaces writes a members row for the owner at
 * creation, so every space has at least one member and `> 0` would call every
 * personal space shared.
 *
 * Reads the derived fact rather than the old `type === 'shared'` column, so it
 * is right for a space shared after the fact and for one created as shared that
 * nobody ever joined — the two cases the stored type got wrong. It also keeps
 * working before migration 041 is applied, since it never looks at `type`.
 */
export function isSharedWorkspace(w: Pick<DashboardWorkspace, 'member_count'>): boolean {
  return (w.member_count ?? 0) > 1
}

export function withInstitution(path: string, slug: string | null): string {
  if (!slug) return path
  return `${path}${path.includes('?') ? '&' : '?'}institution=${encodeURIComponent(slug)}`
}

export interface ScopeCfg {
  title: string
  newLabel: string
  newHref: string
  emptyTitle: string
  emptySubtext: string
  showJoin: boolean
  /** Heading over the sidebar's studio list. */
  listLabel: string
  /**
   * How the create affordance behaves.
   *
   * 'link' navigates to `newHref`; 'section-dialog' opens the new-section
   * dialog in place and `newHref` is unused. Only the class scope takes the
   * dialog: a section needs its studio, department, year and term answered at
   * creation (see CreateSectionModal), and a full-page form for six fields is a
   * navigation an instructor doing this ten times a term does not need. Shared
   * and personal studios still ask for nothing but a name, so they keep the
   * page they already had.
   */
  newMode: 'link' | 'section-dialog'
  /**
   * What one card in this scope IS, capitalised, as it appears in the card's
   * button ("Open Section").
   *
   * Scoped rather than hardcoded on the card because the three tabs no longer
   * hold the same kind of thing. A class-tab workspace is an instructor's
   * SECTION of a studio; a shared or personal one is a studio in its own right
   * and is a section of nothing. One card component renders all three, so the
   * noun has to travel with the scope.
   */
  itemNoun: string
}

// One vocabulary for every org type. This used to swap "Project"/"Class" on
// accountMode === 'firm', which doubled the copy surface for no benefit and
// left the firm half effectively untested.
//
// This layer is a STUDIO, not a project. The note that used to sit here avoided
// the word because "studio" already names the layer below — a workspace holds
// rooms, and /studio/[id] is the 3D room view — but that collision is internal.
// The people using this call the thing a studio (the workspaces really are named
// "Studio 06", "Studio 07"), and naming it "Project" for the sake of a routing
// convention taught them a word nobody says. The URLs are unchanged; only the
// copy moved.
export function scopeConfig(
  scope: Scope,
  organization: { name: string; slug: string } | null,
  institutionHome: string | null,
  canCreate: boolean,
): ScopeCfg {
  switch (scope) {
    case 'wentworth':
      return {
        title: organization?.name || 'Network',
        // "New Section", not "New Studio". An instructor does not create a
        // studio — Studio 01 through 08 plus the two standing ones are the
        // department's, fixed, and shared by everyone teaching them (see
        // lib/constants/studios). What an instructor creates is their SECTION
        // of one. The old label had them naming the studio itself, which is why
        // the network carried several spellings of the same bucket.
        newLabel: 'New Section',
        itemNoun: 'Section',
        newMode: 'section-dialog',
        // Unused under 'section-dialog'. Kept so the shape is uniform and so
        // the page is one line away if the dialog ever needs a full-page twin.
        newHref: withInstitution('/workspace/new', institutionHome),
        emptyTitle: 'Nothing here yet',
        // Students are the people who see this copy most, and the same
        // canCreate flag hides the create affordance from them — telling them
        // to create something is a dead end. Offer only what they can do.
        emptySubtext: canCreate
          ? 'Create one or join with an invite code.'
          : 'Join with an invite code.',
        showJoin: true,
        // Only the class scope has a term to speak of, and even there
        // academic_year is set on about half the rows. The other two scopes
        // have no term at all, so they get the plain noun.
        listLabel: 'This semester',
      }
    case 'personal':
      return {
        title: 'Personal Studios',
        newLabel: 'New Personal Studio',
        itemNoun: 'Studio',
        newMode: 'link',
        newHref: withInstitution('/studio/new', institutionHome),
        emptyTitle: 'Nothing here yet',
        emptySubtext: 'Create one to get started.',
        // True now: a personal studio can be shared, so someone can be holding
        // an invite code to one. This was false while "shared" was its own tab
        // and joining anything landed you there instead.
        showJoin: true,
        listLabel: 'Studios',
      }
  }
}

/**
 * The card/header meta line, built only from fields that are actually set.
 *
 * Department is present on ~16% of rows and academic_year on ~48%, so a fixed
 * "Architecture · Autumn 2026" template would render as stray separators for
 * most studios. Joining a filtered list means the line is however long the real
 * data makes it, and absent entirely when there is nothing to say.
 */
export function metaLine(parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => Boolean(p && String(p).trim())).join(' · ')
}
