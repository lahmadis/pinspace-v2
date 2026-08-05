import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { validateName } from '@/lib/validation/safeName'
import { createWorkspace } from '@/lib/workspaces/createWorkspace'
import { isDepartment, isYearLevel } from '@/lib/constants/departments'
import { academicYearOptions } from '@/lib/academicYear'

export const dynamic = 'force-dynamic'

const LIST_LIMIT = 100

/**
 * GET /api/admin/studios — every studio, newest first, with its owner resolved
 * and whether the calling admin is currently a member.
 */
export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const admin = supabaseServiceRole()

    const { data: workspaces, error: wsErr } = await admin
      .from('workspaces')
      .select('id, name, type, owner_id, created_at, created_by_admin, academic_year, network_metadata, instructor, is_archived')
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT)

    if (wsErr) {
      console.error('Error listing studios:', wsErr)
      return NextResponse.json({ error: 'Failed to list studios' }, { status: 500 })
    }

    const rows = workspaces ?? []
    if (rows.length >= LIST_LIMIT) {
      console.warn(
        `/api/admin/studios: returned ${rows.length} studios, at the cap of ${LIST_LIMIT}. ` +
        'Older studios are not listed — pagination is needed.'
      )
    }
    if (rows.length === 0) return NextResponse.json({ studios: [] })

    // Resolve owner display names, and which of these the admin has joined.
    // Two set-based lookups regardless of row count.
    //
    // owner_id is TEXT while user_profiles.user_id is UUID, so a single row
    // holding a non-UUID owner_id would make Postgres reject the whole .in()
    // with 22P02 and blank the owner column for EVERY studio. Filter to
    // well-formed uuids rather than letting one bad row poison the list.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const ownerIds = Array.from(new Set(rows.map((w) => w.owner_id as string))).filter((id) =>
      UUID_RE.test(id)
    )

    const [profilesResult, myMembershipsResult] = await Promise.all([
      ownerIds.length > 0
        ? admin.from('user_profiles').select('user_id, full_name').in('user_id', ownerIds)
        : Promise.resolve({ data: [] as { user_id: string; full_name: string | null }[], error: null }),
      admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', auth.userId)
        .in('workspace_id', rows.map((w) => w.id as string)),
    ])

    // Both lookups are cosmetic-but-misleading on failure: a swallowed error
    // shows every owner as "—", or every studio as un-joined (so "Join" on one
    // the admin is already in). Log loudly rather than rendering a confident lie.
    if (profilesResult.error) {
      console.error('Error resolving studio owner names:', profilesResult.error)
    }
    if (myMembershipsResult.error) {
      console.error('Error resolving admin studio memberships:', myMembershipsResult.error)
    }

    const nameMap = new Map(
      (profilesResult.data ?? []).map((p) => [p.user_id as string, (p.full_name as string | null) ?? null])
    )
    const joined = new Set((myMembershipsResult.data ?? []).map((m) => m.workspace_id as string))

    const studios = rows.map((w) => {
      const meta = (w.network_metadata ?? null) as { department?: string } | null
      return {
        id: w.id as string,
        name: w.name as string,
        type: (w.type as string | null) ?? 'class',
        ownerId: w.owner_id as string,
        ownerName: nameMap.get(w.owner_id as string) ?? null,
        department: meta?.department ?? null,
        academicYear: (w.academic_year as string | null) ?? null,
        instructorLabel: (w.instructor as string | null) ?? null,
        createdAt: w.created_at as string,
        provisionedByAdmin: w.created_by_admin != null,
        isArchived: Boolean(w.is_archived),
        adminIsMember: joined.has(w.id as string),
      }
    })

    return NextResponse.json({ studios })
  } catch (error) {
    console.error('Error in GET /api/admin/studios:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/studios — provision a studio FOR an existing instructor.
 *
 * The instructor becomes the real owner (workspaces.owner_id), not a member of
 * a studio the admin owns. That is the only model that works: publish, archive,
 * delete, network metadata and bulk enrol are all owner-gated, so an admin-owned
 * studio would leave the professor unable to run their own class.
 *
 * This is NOT impersonation. No session is created, borrowed or swapped — the
 * admin writes a row naming the professor as owner, using the service role,
 * with authorization enforced here in app code.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const nameResult = validateName(body.name, { maxLength: 100, fieldLabel: 'Studio name' })
    if (!nameResult.ok) {
      return NextResponse.json({ error: nameResult.error }, { status: 400 })
    }

    const instructorUserId = typeof body.instructorUserId === 'string' ? body.instructorUserId.trim() : ''
    if (!instructorUserId) {
      return NextResponse.json({ error: 'instructorUserId is required' }, { status: 400 })
    }
    if (!isDepartment(body.department)) {
      return NextResponse.json({ error: 'A valid department is required' }, { status: 400 })
    }
    if (!isYearLevel(body.yearLevel)) {
      return NextResponse.json({ error: 'A valid year level is required' }, { status: 400 })
    }
    const academicYear = typeof body.academicYear === 'string' ? body.academicYear : ''
    if (!academicYearOptions(8).includes(academicYear)) {
      return NextResponse.json({ error: 'A valid academic year is required' }, { status: 400 })
    }

    const admin = supabaseServiceRole()

    // The instructor must be a real account. Resolved through the auth admin API
    // rather than trusting the id from the client, so a hand-crafted request
    // cannot create a studio owned by a nonexistent user.
    const { data: instructorAuth, error: instructorErr } = await admin.auth.admin.getUserById(instructorUserId)
    if (instructorErr || !instructorAuth?.user) {
      return NextResponse.json({ error: 'Instructor account not found' }, { status: 404 })
    }

    const { data: instructorProfile } = await admin
      .from('user_profiles')
      .select('full_name, organization_id')
      .eq('user_id', instructorUserId)
      .maybeSingle()

    // user_metadata.full_name is user-controlled at signup, and this value is
    // written to workspaces.instructor (an explore-network label) and to
    // workspace_members.name — exactly the surfaces safeName exists for. Fall
    // back rather than reject: a bad display name must not block provisioning.
    const rawInstructorName =
      (instructorProfile?.full_name as string | null) ||
      instructorAuth.user.user_metadata?.full_name ||
      instructorAuth.user.email?.split('@')[0] ||
      'Instructor'
    const nameCheck = validateName(rawInstructorName, { maxLength: 80, fieldLabel: 'Instructor name' })
    const instructorName = nameCheck.ok ? nameCheck.value : 'Instructor'

    // Org comes from the instructor's profile, but the picker deliberately
    // allows accounts that have not onboarded yet — which is the common case
    // for a pilot — and those have no profile row at all. Fall back to the
    // email domain, the same mechanism /api/user-profile/claim-domain uses, so
    // the studio still lands in the right org instead of being orphaned off
    // the explore network with nothing to backfill it later.
    let organizationId = (instructorProfile?.organization_id as string | null) ?? null
    if (!organizationId) {
      const domain = instructorAuth.user.email?.split('@')[1]?.toLowerCase()
      if (domain) {
        const { data: domainRow } = await admin
          .from('org_domains')
          .select('org_id')
          .eq('domain', domain)
          .maybeSingle()
        if (domainRow?.org_id) organizationId = domainRow.org_id as string
      }
    }

    // Service role for the insert: the workspaces INSERT policy is
    // `owner_id = auth.uid()`, which is exactly what provisioning for someone
    // else has to cross. The isAdmin check above is the replacement boundary.
    //
    // The instructor gate that POST /api/workspaces applies to `class` studios
    // is deliberately skipped — a pilot professor may not carry the instructor
    // account role yet, and that gate exists to stop students self-creating
    // org-facing classes, not to stop an admin provisioning one.
    const result = await createWorkspace({
      db: admin,
      name: nameResult.value,
      description: null,
      type: 'class',
      ownerId: instructorUserId,
      ownerName: instructorName,
      organizationId,
      createdByAdmin: auth.userId,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    const workspaceId = result.workspace.id as string

    // Network metadata + the chosen academic year. createWorkspace stamps the
    // current academic year; this honours the admin's explicit pick instead,
    // which matters when back-filling a studio for a term already underway.
    // Note academicYearOptions returns the current year and past ones only, so
    // a FUTURE term cannot be selected here — the July rollover means "next
    // term" is already the current value from July onward.
    const { error: metaError } = await admin
      .from('workspaces')
      .update({
        network_metadata: { department: body.department, year: body.yearLevel },
        academic_year: academicYear,
        instructor: instructorName,
      })
      .eq('id', workspaceId)

    if (metaError) {
      // The studio exists and is owned correctly; only its explore metadata is
      // missing. Report rather than fail — the professor can set it from the
      // publish modal, and failing here would imply nothing was created.
      console.error('Studio created but metadata update failed:', workspaceId, metaError)
    }

    return NextResponse.json(
      { workspace: result.workspace, metadataApplied: !metaError },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error in POST /api/admin/studios:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
