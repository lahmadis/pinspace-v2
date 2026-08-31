import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isUuid } from '@/lib/validation/uuid'
import { cleanDisplayName } from '@/lib/displayName'

export const dynamic = 'force-dynamic'

/** Two letters from a name: "Amara Osei" -> AO, "Priya" -> PR. */
function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface RosterStudent {
  id: string
  name: string
  initials: string
  /** Sheets this person has pinned up anywhere in this section. */
  boardCount: number
}

/**
 * GET /api/workspaces/[id]/roster — who is in this section, and who has work up.
 *
 * The dashboard's Current studio card asks a question nothing else answered:
 * not "how many members" (GET /api/workspaces already returns member_count) but
 * WHO, by name, and which of them have actually pinned anything. That second
 * half is the point of the card — an instructor opening the dashboard the
 * morning of a crit wants the six names that are ready and the twelve that are
 * not, and a single integer cannot say it.
 *
 * Service-role read with the access check in app code, per the project's RLS
 * rule: a member reading a roster is reading rows about OTHER people, which the
 * anon-key client silently filters to nothing rather than refusing — the failure
 * mode being an empty roster on a full section, with no error to notice.
 *
 * Access: the workspace owner, any member, or a superadmin. Deliberately not
 * instructor-only. A student looking at their own section's card should see the
 * same list they see printed on the wall at a pin-up.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id
    const workspaceId = (await params).id

    const admin = supabaseServiceRole()

    const { data: workspace, error: wsError } = await admin
      .from('workspaces')
      .select('id, owner_id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (wsError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Every member row, in one read. It serves both the access check below and
    // the roster itself, so membership is never queried twice.
    const { data: memberRows, error: membersError } = await admin
      .from('workspace_members')
      .select('user_id, role, name')
      .eq('workspace_id', workspaceId)
    if (membersError) {
      console.error('Error loading workspace roster members:', membersError)
      return NextResponse.json({ error: 'Failed to load the roster' }, { status: 500 })
    }
    const members = memberRows ?? []

    const isOwner = workspace.owner_id === userId
    const isMember = members.some((m) => String(m.user_id) === userId)
    if (!isOwner && !isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    /**
     * The owner is not on their own roster.
     *
     * POST /api/workspaces writes a members row for the creator, so without
     * this the instructor appears as the first student of their own section and
     * "6 of 18 pinned" counts them among the students it is reporting on.
     */
    const students = members.filter((m) => String(m.user_id) !== String(workspace.owner_id))

    /**
     * Live names from user_profiles, exactly as GET /api/boards resolves board
     * owners: workspace_members.name is a snapshot written at join time, so it
     * goes stale the moment someone edits their display name, and pre-Supabase
     * rows can hold ids that are not UUIDs at all — passing one of those to
     * .in() raises 22P02 and fails the whole request, so they are filtered out
     * before the query rather than after.
     */
    const nameById = new Map<string, string>()
    const profileIds = Array.from(
      new Set(students.map((m) => String(m.user_id)).filter(Boolean))
    ).filter(isUuid)
    if (profileIds.length > 0) {
      const { data: profiles, error: profileError } = await admin
        .from('user_profiles')
        .select('user_id, full_name')
        .in('user_id', profileIds)
      if (profileError) {
        // Non-fatal: fall through to the stored snapshot rather than failing a
        // whole roster over a label.
        console.error('Failed to resolve roster display names:', profileError)
      }
      for (const row of profiles ?? []) {
        const clean = cleanDisplayName(row.full_name)
        if (clean) nameById.set(String(row.user_id), clean)
      }
    }

    /**
     * How many sheets each person has in this section.
     *
     * Counted over the WORKSPACE, not one room: a section has several rooms
     * (the card says "4 rooms · 6 boards") and a student's work is pinned in
     * whichever of them their crit is in. One grouped read, not one per member.
     */
    const boardCountByOwner: Record<string, number> = {}
    const { data: boardRows, error: boardsError } = await admin
      .from('boards')
      .select('owner_id')
      .eq('workspace_id', workspaceId)
    if (boardsError) {
      console.error('Error counting roster boards:', boardsError)
      return NextResponse.json({ error: 'Failed to load the roster' }, { status: 500 })
    }
    for (const row of boardRows ?? []) {
      const owner = typeof row.owner_id === 'string' ? row.owner_id : null
      if (!owner) continue
      boardCountByOwner[owner] = (boardCountByOwner[owner] ?? 0) + 1
    }

    const roster: RosterStudent[] = students.map((m) => {
      const id = String(m.user_id)
      // Live profile name, then the join-time snapshot, then nothing usable —
      // which reads as "Student" rather than printing a raw uuid at somebody.
      const name = nameById.get(id) || cleanDisplayName(m.name) || 'Student'
      return {
        id,
        name,
        initials: initialsFor(name),
        boardCount: boardCountByOwner[id] ?? 0,
      }
    })

    /**
     * Who has work up, first.
     *
     * Not alphabetical: the card exists to answer "who is ready", and a list
     * sorted by name buries the six people who are among the twelve who are
     * not. Alphabetical WITHIN each group, so the long tail of "not yet" is
     * still scannable for one name.
     */
    roster.sort((a, b) =>
      b.boardCount - a.boardCount || a.name.localeCompare(b.name)
    )

    return NextResponse.json({
      students: roster,
      total: roster.length,
      // "6 of 18 pinned" — people with at least one sheet up, not sheets.
      pinned: roster.filter((s) => s.boardCount > 0).length,
    })
  } catch (err) {
    console.error('Unexpected error loading roster:', err)
    return NextResponse.json({ error: 'Failed to load the roster' }, { status: 500 })
  }
}
