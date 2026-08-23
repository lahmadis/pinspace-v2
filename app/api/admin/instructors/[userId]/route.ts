import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { isUuid } from '@/lib/validation/uuid'
import { resolveOrgNames } from '@/lib/orgs/resolveOrg'
import { CLASS_TYPE_FILTER } from '@/lib/workspaces/classFilter'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/instructors/[userId] — one instructor and the class studios
 * they own.
 *
 * Read-only, admin-gated, and NOT impersonation: no session is created,
 * borrowed or swapped, and nothing here renders the studio as that user would
 * see it. It reports what an admin can already read, filtered to one person.
 *
 * CLASS STUDIOS ONLY — the filter lives in this query, not in the component, so
 * the response itself cannot carry a personal or shared workspace. That is the
 * whole reason this route does not simply return "workspaces owned by X": a
 * professor's personal space is private, and including it would mean building a
 * second permissions model to decide what an admin may see inside it.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    // user_profiles.user_id is UUID and the auth admin API expects one, so a
    // malformed path segment would 22P02 rather than miss. Reject it here and
    // the 404 below stays reachable.
    const userId = params.userId
    if (!isUuid(userId)) {
      return NextResponse.json({ error: 'Instructor not found' }, { status: 404 })
    }

    const admin = supabaseServiceRole()

    // The account must exist. This is also the only source of the email, and
    // the only source of ANY identity for a professor who was provisioned a
    // studio before onboarding.
    const { data: targetAuth, error: authErr } = await admin.auth.admin.getUserById(userId)
    if (authErr || !targetAuth?.user) {
      if (authErr) console.error('Error resolving instructor account:', userId, authErr)
      return NextResponse.json({ error: 'Instructor not found' }, { status: 404 })
    }

    const { data: profile, error: profileErr } = await admin
      .from('user_profiles')
      .select('user_id, full_name, organization_id, account_role')
      .eq('user_id', userId)
      .maybeSingle()
    // A failed profile read leaves `profile` null, which is INDISTINGUISHABLE
    // from "this account never onboarded" — and the page states both of those
    // as fact ("No instructor role", "Has not onboarded"). Flag it so the UI can
    // withhold those claims instead of asserting a lookup failure as a finding
    // about a real person. Same contract as membershipResolved below.
    const profileResolved = !profileErr
    if (profileErr) {
      console.error('Error loading instructor profile:', userId, profileErr)
    }

    const email = targetAuth.user.email ?? null
    const orgNames = await resolveOrgNames(admin, [
      {
        userId,
        email,
        organizationId: (profile?.organization_id as string | null) ?? null,
      },
    ])

    // owner_id is TEXT; userId is a validated uuid string, so this compares
    // like with like without a cast.
    const { data: workspaces, error: wsErr } = await admin
      .from('workspaces')
      .select('id, name, type, created_at, created_by_admin, academic_year, network_metadata, is_archived')
      .eq('owner_id', userId)
      .or(CLASS_TYPE_FILTER)
      .order('created_at', { ascending: false })

    if (wsErr) {
      console.error('Error loading class studios for instructor:', userId, wsErr)
      return NextResponse.json({ error: 'Failed to load studios' }, { status: 500 })
    }

    const rows = workspaces ?? []
    const workspaceIds = rows.map((w) => w.id as string)

    // Member counts and the calling admin's own memberships, in one query
    // rather than one per studio. Counting in JS because PostgREST has no
    // GROUP BY — at pilot scale this is a few dozen rows.
    const memberCounts = new Map<string, number>()
    const adminMemberOf = new Set<string>()
    let membershipResolved = true

    if (workspaceIds.length > 0) {
      const { data: members, error: membersErr } = await admin
        .from('workspace_members')
        .select('workspace_id, user_id')
        .in('workspace_id', workspaceIds)

      if (membersErr) {
        // Do NOT fail the page for this: the studio list is still correct and
        // useful. But a swallowed error would render every studio as having 0
        // members and the admin as belonging to none — which would make the
        // Join button lie. Surface it as an explicit flag instead.
        console.error('Error loading member counts for instructor studios:', userId, membersErr)
        membershipResolved = false
      } else {
        for (const m of members ?? []) {
          const wsId = m.workspace_id as string
          memberCounts.set(wsId, (memberCounts.get(wsId) ?? 0) + 1)
          if ((m.user_id as string) === auth.userId) adminMemberOf.add(wsId)
        }
      }
    }

    const studios = rows.map((w) => {
      const meta = (w.network_metadata ?? null) as { department?: string; year?: string } | null
      const id = w.id as string
      return {
        id,
        name: w.name as string,
        type: (w.type as string | null) ?? 'class',
        department: meta?.department ?? null,
        yearLevel: meta?.year ?? null,
        academicYear: (w.academic_year as string | null) ?? null,
        memberCount: memberCounts.get(id) ?? 0,
        createdAt: w.created_at as string,
        provisionedByAdmin: w.created_by_admin != null,
        isArchived: Boolean(w.is_archived),
        adminIsMember: adminMemberOf.has(id),
      }
    })

    return NextResponse.json({
      instructor: {
        userId,
        fullName:
          (profile?.full_name as string | null)?.trim() ||
          (targetAuth.user.user_metadata?.full_name as string | undefined) ||
          null,
        email,
        organization: orgNames.get(userId) ?? null,
        accountRole: profile?.account_role === 'instructor' ? 'instructor' : 'student',
        hasProfile: profile != null,
      },
      // False means accountRole and hasProfile are guesses, not facts.
      profileResolved,
      studios,
      // False means memberCount and adminIsMember are unreliable for this
      // response — the UI says so rather than showing confident zeros.
      membershipResolved,
    })
  } catch (error) {
    console.error('Error in GET /api/admin/instructors/[userId]:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
