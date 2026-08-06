import { NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { isUuid } from '@/lib/validation/uuid'
import { resolveOrgNames } from '@/lib/orgs/resolveOrg'
import { CLASS_TYPE_FILTER } from '@/lib/workspaces/classFilter'

export const dynamic = 'force-dynamic'

// See the note in /api/admin/recent-signups: listUsers is a single unpaginated
// page and GoTrue cannot sort or filter, so we match client-side over whatever
// page we get. A warning fires if we ever hit the cap.
const PER_PAGE = 1000

// Explicit cap on the class-workspace scan, matching GET /api/admin/studios.
// Without one, PostgREST's own max-rows would truncate silently: instructors
// would vanish from the list and classCount would undercount, with nothing to
// say so. A cap we set is a cap we can warn about.
const WORKSPACE_SCAN_LIMIT = 2000

/**
 * GET /api/admin/instructors — everyone who teaches, or could.
 *
 * A UI layer over the provisioning built for the WIT pilot: this route reads,
 * it grants nothing. Not impersonation — no session is created, borrowed or
 * swapped, and nothing renders another user's view. It is an admin-side
 * filtered list of accounts, drawn from tables the admin can already read.
 *
 * The population is the UNION of two sets, and it needs both:
 *   - owners of at least one CLASS workspace — the people actually running
 *     studios, whether or not they carry the instructor account role; and
 *   - accounts with user_profiles.account_role = 'instructor' — the people who
 *     CAN run one but have no studio yet, who are precisely the accounts an
 *     admin is about to provision for.
 *
 * Built from `workspaces` first and profiles second, NOT from the profile table
 * alone. Admin provisioning deliberately supports professors who have not
 * onboarded (see POST /api/admin/studios), and those accounts have no
 * user_profiles row at all — so a list sourced from profiles would omit exactly
 * the pilot instructors it exists to manage. Identity comes from the auth admin
 * API, which every account has.
 *
 * CLASS STUDIOS ONLY. type='personal' and type='shared' workspaces are private
 * and never appear here or in the per-instructor route — not hidden in the UI,
 * excluded in the query, so the response cannot leak them either.
 */

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const admin = supabaseServiceRole()

    // Class workspaces carry the owner set AND the per-instructor studio count,
    // so one query answers both. Ids only — no names, no metadata.
    const { data: classWorkspaces, error: wsErr } = await admin
      .from('workspaces')
      .select('id, owner_id')
      .or(CLASS_TYPE_FILTER)
      .limit(WORKSPACE_SCAN_LIMIT)

    if (wsErr) {
      console.error('Error listing class workspaces for instructor list:', wsErr)
      return NextResponse.json({ error: 'Failed to list instructors' }, { status: 500 })
    }

    const classRows = classWorkspaces ?? []
    if (classRows.length >= WORKSPACE_SCAN_LIMIT) {
      console.warn(
        `/api/admin/instructors: scanned ${classRows.length} class workspaces, at the cap of ${WORKSPACE_SCAN_LIMIT}. ` +
        'Some instructors may be missing and studio counts may be low — pagination is needed.'
      )
    }

    const classCountByOwner = new Map<string, number>()
    for (const row of classRows) {
      const ownerId = row.owner_id as string | null
      if (!ownerId) continue
      classCountByOwner.set(ownerId, (classCountByOwner.get(ownerId) ?? 0) + 1)
    }

    // Instructor-role accounts. Selected without a uuid filter because
    // user_profiles.user_id IS the uuid column — the values come OUT of it.
    const { data: instructorProfiles, error: profilesErr } = await admin
      .from('user_profiles')
      .select('user_id, full_name, organization_id, account_role')
      .eq('account_role', 'instructor')

    if (profilesErr) {
      console.error('Error listing instructor-role profiles:', profilesErr)
      return NextResponse.json({ error: 'Failed to list instructors' }, { status: 500 })
    }

    // The union. owner_id is TEXT, so filter to well-formed uuids before any of
    // these ids reaches user_profiles.user_id (uuid) below — one malformed
    // owner_id would otherwise 22P02 the whole .in() and blank every row.
    const userIds = new Set<string>()
    for (const ownerId of classCountByOwner.keys()) {
      if (isUuid(ownerId)) userIds.add(ownerId)
    }
    for (const profile of instructorProfiles ?? []) {
      const id = profile.user_id as string
      if (isUuid(id)) userIds.add(id)
    }

    if (userIds.size === 0) return NextResponse.json({ instructors: [] })

    const ids = Array.from(userIds)

    // Profiles for the whole union — the instructor-role query above only
    // covers half of it, and a class owner may have a profile with a name and
    // org while carrying account_role 'student'.
    const { data: profiles, error: allProfilesErr } = await admin
      .from('user_profiles')
      .select('user_id, full_name, organization_id, account_role')
      .in('user_id', ids)

    if (allProfilesErr) {
      console.error('Error loading profiles for instructor list:', allProfilesErr)
      return NextResponse.json({ error: 'Failed to list instructors' }, { status: 500 })
    }

    const profileById = new Map(
      (profiles ?? []).map((p) => [
        p.user_id as string,
        {
          fullName: (p.full_name as string | null) ?? null,
          organizationId: (p.organization_id as string | null) ?? null,
          accountRole: p.account_role === 'instructor' ? ('instructor' as const) : ('student' as const),
        },
      ])
    )

    // Email lives only on the auth record, and this is the one source that
    // covers accounts with no profile row.
    const { data: authList, error: authErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: PER_PAGE,
    })
    if (authErr) {
      console.error('Error listing auth users for instructor list:', authErr)
      return NextResponse.json({ error: 'Failed to list instructors' }, { status: 500 })
    }
    const authUsers = authList?.users ?? []
    if (authUsers.length >= PER_PAGE) {
      console.warn(
        `/api/admin/instructors: listUsers returned ${authUsers.length} users, at the perPage cap of ${PER_PAGE}. ` +
        'Some instructors may be missing their email — pagination is needed.'
      )
    }
    const authById = new Map(authUsers.map((u) => [u.id, u]))

    const orgNames = await resolveOrgNames(
      admin,
      ids.map((id) => ({
        userId: id,
        email: authById.get(id)?.email ?? null,
        organizationId: profileById.get(id)?.organizationId ?? null,
      }))
    )

    const instructors = ids
      .map((id) => {
        const profile = profileById.get(id) ?? null
        const authUser = authById.get(id) ?? null
        const email = authUser?.email ?? null
        const fullName =
          profile?.fullName?.trim() ||
          (authUser?.user_metadata?.full_name as string | undefined) ||
          null
        return {
          userId: id,
          fullName,
          email,
          organization: orgNames.get(id) ?? null,
          accountRole: profile?.accountRole ?? ('student' as const),
          classCount: classCountByOwner.get(id) ?? 0,
          // No profile row = never onboarded. Surfaced because it explains an
          // otherwise confusing row: no name, and an org resolved only from
          // their email domain.
          hasProfile: profile != null,
        }
      })
      // Stable, predictable ordering: name if we have one, else email.
      .sort((a, b) => (a.fullName ?? a.email ?? '').localeCompare(b.fullName ?? b.email ?? ''))

    return NextResponse.json({ instructors })
  } catch (error) {
    console.error('Error in GET /api/admin/instructors:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
