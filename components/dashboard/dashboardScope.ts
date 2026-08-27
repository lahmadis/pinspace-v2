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

export type Scope = 'wentworth' | 'shared' | 'personal'

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
  /** jsonb. Carries department/year, and is populated on ~16% of rows. */
  network_metadata?: { department?: string; year?: string } | null
  invite_code?: string
  instructor?: string
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
        newLabel: 'New Studio',
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
        listLabel: 'This term',
      }
    case 'shared':
      return {
        title: 'Shared Studios',
        newLabel: 'New Shared Studio',
        newHref: '/workspace/new?type=shared',
        emptyTitle: 'Nothing here yet',
        emptySubtext: 'Anything you collaborate on with others will appear here.',
        showJoin: true,
        listLabel: 'Studios',
      }
    case 'personal':
      return {
        title: 'Personal Studios',
        newLabel: 'New Personal Studio',
        newHref: withInstitution('/studio/new', institutionHome),
        emptyTitle: 'Nothing here yet',
        emptySubtext: 'Create one to get started.',
        showJoin: false,
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
