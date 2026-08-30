import { NextResponse } from 'next/server'
import { DESK_CRIT_WORKSPACE_TYPE } from '@/lib/deskCrits/workspace'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { validateName } from '@/lib/validation/safeName'
import { createWorkspace } from '@/lib/workspaces/createWorkspace'
import { isDepartment, isYearLevel } from '@/lib/constants/departments'
import { isStudio } from '@/lib/constants/studios'

/** Academic year as academicYearOptions emits it: "2025-2026". */
const ACADEMIC_YEAR_PATTERN = /^\d{4}-\d{4}$/

/**
 * created_at as a sortable number. `unknown` in, because the workspace rows
 * come from `select('*')` and are typed as bare records.
 *
 * A missing or unparseable timestamp sorts to the very end rather than throwing
 * the comparator into NaN — a NaN comparison makes Array.sort's result
 * implementation-defined, which would scramble the whole grid rather than
 * misplacing the one bad row.
 */
function createdAtMs(value: unknown): number {
  const t = Date.parse(String(value ?? ''))
  return Number.isNaN(t) ? 0 : t
}

/**
 * The network filing a section carries from its create dialog.
 *
 * Returns `{ ok: true, network: undefined }` when the body has none of these
 * fields — the shared and personal creation paths post a bare name and must
 * keep working. It is ALL-OR-NOTHING once any of them appears: a workspace with
 * a department but no year is invisible to the explore year filter and visible
 * to the department one, which is worse than a workspace with no filing at all.
 *
 * Every value is checked against the canonical list rather than trusted. These
 * strings are what the explore queries filter on (`network_metadata->>studio`),
 * so an unrecognised one creates a studio bucket nothing else can reach.
 */
function parseSectionNetwork(
  body: Record<string, unknown>
):
  | { ok: true; network?: { department: string; year: string; studio: string; instructor: string; academicYear: string } }
  | { ok: false; error: string } {
  const keys = ['department', 'yearLevel', 'studio', 'instructor', 'academicYear'] as const
  const present = keys.filter((k) => body[k] !== undefined && body[k] !== null && body[k] !== '')
  if (present.length === 0) return { ok: true, network: undefined }
  if (present.length !== keys.length) {
    const missing = keys.filter((k) => !present.includes(k))
    return { ok: false, error: `Incomplete network details: ${missing.join(', ')} missing` }
  }

  const { department, yearLevel, studio, academicYear } = body
  if (!isDepartment(department)) return { ok: false, error: 'Unknown department' }
  if (!isYearLevel(yearLevel)) return { ok: false, error: 'Unknown year level' }
  if (!isStudio(studio)) return { ok: false, error: 'Unknown studio' }
  if (typeof academicYear !== 'string' || !ACADEMIC_YEAR_PATTERN.test(academicYear)) {
    return { ok: false, error: 'Invalid academic year' }
  }
  const instructorResult = validateName(body.instructor, { maxLength: 80, fieldLabel: 'Instructor name' })
  if (!instructorResult.ok) return { ok: false, error: instructorResult.error }

  return {
    ok: true,
    network: {
      department,
      year: yearLevel,
      studio,
      instructor: instructorResult.value,
      academicYear,
    },
  }
}

// GET: list workspaces owned by or shared with the current user
export async function GET() {
  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    // Service role for read; access is scoped in app code via owner_id/membership
    // filters. RLS would otherwise drop joined-but-not-owned workspaces (there is
    // no membership-based SELECT policy on workspaces).
    const admin = supabaseServiceRole()

    // Fetch owned workspaces
    const { data: owned, error: ownedErr } = await admin
      .from('workspaces')
      .select('*')
      .eq('owner_id', userId)

    if (ownedErr) {
      console.error('Error fetching owned workspaces:', ownedErr)
      return NextResponse.json({ error: 'Failed to fetch owned workspaces' }, { status: 500 })
    }

    // Fetch workspace memberships
    const { data: memberRows, error: memErr } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)

    if (memErr) {
      console.error('Error fetching workspace members:', memErr)
      return NextResponse.json({ error: 'Failed to fetch workspace members' }, { status: 500 })
    }

    // Fetch workspaces where user is a member
    const memberIds = memberRows?.map((r) => r.workspace_id) ?? []
    let memberWorkspaces: Record<string, unknown>[] = []

    if (memberIds.length > 0) {
      const { data, error: memberWsErr } = await admin
        .from('workspaces')
        .select('*')
        .in('id', memberIds)

      if (memberWsErr) {
        console.error('Error fetching member workspaces:', memberWsErr)
        return NextResponse.json({ error: 'Failed to fetch member workspaces' }, { status: 500 })
      }

      memberWorkspaces = data ?? []
    }

    // Dedupe by id: every owned workspace is also a member workspace (POST
    // creates both rows), so the two sets always overlap. Without this the
    // dashboard renders each owned workspace twice.
    const allWorkspaces = Array.from(
      new Map(
        [...(owned ?? []), ...memberWorkspaces].map((w) => [w.id, w])
      ).values()
    // The desk-crit workspace is not a space. It exists only to satisfy
    // boards.workspace_id for crit sheets, and listing it would put an
    // untitled container in everyone's dashboard the first time they pin
    // anything at a desk crit. See lib/deskCrits/workspace.
    ).filter((w) => w.type !== DESK_CRIT_WORKSPACE_TYPE)

    // Fetch board counts for all workspaces in one query
    const wsIds = allWorkspaces.map((w) => w.id)
    const boardCountMap: Record<string, number> = {}
    if (wsIds.length > 0) {
      const { data: boardRows } = await admin
        .from('boards')
        .select('workspace_id')
        .in('workspace_id', wsIds)
      if (boardRows) {
        for (const row of boardRows) {
          boardCountMap[row.workspace_id] = (boardCountMap[row.workspace_id] || 0) + 1
        }
      }
    }

    // Room counts, same one-query shape as the board counts above. The dashboard
    // card reads "N rooms · M boards"; without this it could only say the second
    // half, since a workspace's rooms are never joined onto this response.
    const roomCountMap: Record<string, number> = {}
    if (wsIds.length > 0) {
      const { data: roomRows } = await admin
        .from('rooms')
        .select('workspace_id')
        .in('workspace_id', wsIds)
      if (roomRows) {
        for (const row of roomRows) {
          roomCountMap[row.workspace_id] = (roomCountMap[row.workspace_id] || 0) + 1
        }
      }
    }

    // Member counts, same one-query shape as the two above. This is what makes
    // "shared" a derived state rather than a stored type: a personal space with
    // somebody in it besides its owner IS a shared space, and nothing has to
    // declare it at creation time or be kept in sync afterwards.
    const memberCountMap: Record<string, number> = {}
    if (wsIds.length > 0) {
      const { data: allMemberRows } = await admin
        .from('workspace_members')
        .select('workspace_id')
        .in('workspace_id', wsIds)
      if (allMemberRows) {
        for (const row of allMemberRows) {
          memberCountMap[row.workspace_id] = (memberCountMap[row.workspace_id] || 0) + 1
        }
      }
    }

    const result = allWorkspaces.map((w) => ({
      ...w,
      board_count: boardCountMap[w.id] ?? 0,
      room_count: roomCountMap[w.id] ?? 0,
      member_count: memberCountMap[w.id] ?? 0,
    }))

    /**
     * Newest first.
     *
     * Nothing ordered this response before, at any layer. What came back was
     * the two unordered SELECTs above merged through a Map — owned rows, then
     * member-only ones, each in whatever order Postgres happened to return —
     * so a freshly created section landed at an arbitrary position in the
     * dashboard grid, and the position could change between reloads without
     * anything having changed.
     *
     * Sorted HERE rather than in the dashboard because /archive reads the same
     * endpoint and had the same problem, and because ordering a list is a
     * property of the response, not of one of its two renderers. It cannot be
     * pushed down into the queries either: two ordered SELECTs merged still
     * need a final pass over the union.
     */
    result.sort((a, b) => createdAtMs(b.created_at) - createdAtMs(a.created_at))

    return NextResponse.json({ workspaces: result })
  } catch (error) {
    console.error('Unexpected error in GET /api/workspaces:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// POST: create a workspace owned by the current user
export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const body = await req.json().catch(() => null)
    const nameResult = validateName(body?.name, { maxLength: 100, fieldLabel: 'Workspace name' })
    if (!nameResult.ok) {
      return NextResponse.json({ error: nameResult.error }, { status: 400 })
    }
    const name = nameResult.value
    const description = body?.description?.trim() ?? null
    const type = body?.type || 'class' // 'class' or 'personal'

    // Validate the workspace type before the instructor gate so an unknown
    // value can't slip past it.
    if (type !== 'class' && type !== 'shared' && type !== 'personal') {
      return NextResponse.json({ error: 'Invalid workspace type' }, { status: 400 })
    }

    const supabaseAdmin = supabaseServiceRole()
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('organization_id, account_role, full_name')
      .eq('user_id', userId)
      .maybeSingle()

    // Security gate: only instructors may create org-facing classes. Shared
    // rooms (peer-to-peer collab) and personal rooms (the creator's own space)
    // stay open to every account — neither reaches the org network. This is the
    // real server-side boundary; the dashboard merely hides the buttons.
    if (type === 'class' && profile?.account_role !== 'instructor') {
      return NextResponse.json(
        { error: 'Only instructors can create classes. Ask an admin to grant you instructor access.' },
        { status: 403 }
      )
    }

    // Parsed AFTER the instructor gate: a section's filing is org-facing, so a
    // student probing this endpoint should be refused for who they are before
    // the body is inspected at all.
    const networkResult = parseSectionNetwork(body ?? {})
    if (!networkResult.ok) {
      return NextResponse.json({ error: networkResult.error }, { status: 400 })
    }
    // Sections are classes. Accepting a filing on a shared or personal
    // workspace would put a room that never reaches the org network into the
    // explore drill-down, where nobody could open it.
    if (networkResult.network && type !== 'class') {
      return NextResponse.json(
        { error: 'Only class workspaces can carry network details' },
        { status: 400 }
      )
    }

    /*
     * user_profiles.full_name FIRST.
     *
     * That is the name someone sets during onboarding and can change later;
     * `user_metadata.full_name` is only populated when the identity provider
     * happened to supply one at sign-up, and is never updated afterwards. With
     * profiles skipped entirely, an email-only signup fell straight through to
     * the local part of their address — which is how a workspace ended up
     * labelled "Owner: tavaresn3" instead of the name that person chose.
     *
     * No extra query: the profile row above is already being read for
     * organization_id and account_role.
     */
    const ownerName =
      profile?.full_name?.trim() ||
      user.user_metadata?.full_name ||
      user.email?.split('@')[0] ||
      'Owner'

    // Shared with the admin provisioning path. `db` stays the RLS-bound client
    // here, so the owner_id = auth.uid() INSERT policy still applies and this
    // route cannot create a workspace owned by anyone but the caller.
    const result = await createWorkspace({
      db: supabase,
      name,
      description,
      type,
      ownerId: userId,
      ownerName,
      organizationId: type === 'class' ? profile?.organization_id ?? null : null,
      network: networkResult.network,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ workspace: result.workspace }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error in POST /api/workspaces:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
