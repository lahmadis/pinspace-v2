import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { validateName } from '@/lib/validation/safeName'
import { isStudio } from '@/lib/constants/studios'
import { isTerm } from '@/lib/term'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/workspaces/[id]/network-metadata
 * Writes department/yearLevel/studio/instructor/academicYear onto the workspace
 * so the explore network can filter and label it correctly. Owner only.
 *
 * academicYear carries a SEMESTER — 'Fall 2025'. It keeps its name because it
 * is the wire name for workspaces.academic_year; see lib/term.
 *
 * Sections created through the new-section dialog arrive here already filed —
 * this route is now the EDIT path for them and the first-filing path for
 * workspaces that predate it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const workspaceId = (await params).id
    const body = await request.json().catch(() => ({}))
    const { department, yearLevel, instructor, academicYear, studio } = body

    if (!department || !yearLevel || !academicYear) {
      return NextResponse.json(
        { error: 'department, yearLevel, instructor, and academicYear are all required' },
        { status: 400 }
      )
    }
    // Checked for SHAPE, not just presence. This route was only testing that a
    // value was truthy, which was survivable while it stored a free-ish string
    // and is not now: explore groups its bubbles on this exact value, so an
    // unrecognised one opens a semester bucket no other section can be filed
    // into. Same reason isStudio is enforced below.
    if (!isTerm(academicYear)) {
      return NextResponse.json({ error: 'Invalid semester' }, { status: 400 })
    }
    const instructorResult = validateName(instructor, { maxLength: 80, fieldLabel: 'Instructor name' })
    if (!instructorResult.ok) {
      return NextResponse.json({ error: instructorResult.error }, { status: 400 })
    }
    // Optional, but never garbage: an unrecognised value would open a studio
    // bucket in the drill-down that no other section can be filed into.
    if (studio !== undefined && studio !== null && studio !== '' && !isStudio(studio)) {
      return NextResponse.json({ error: 'Unknown studio' }, { status: 400 })
    }

    const admin = supabaseServiceRole()

    // network_metadata rides along because the UPDATE below REPLACES the whole
    // jsonb value. A caller that doesn't send `studio` — the publish modal on a
    // path that never asked for one — would otherwise erase the studio a
    // section was created with, dropping it out of the drill-down silently.
    const { data: workspace } = await admin
      .from('workspaces')
      .select('owner_id, network_metadata')
      .eq('id', workspaceId)
      .maybeSingle()

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    if (workspace.owner_id !== userId) {
      return NextResponse.json(
        { error: 'Only workspace owners can update network metadata' },
        { status: 403 }
      )
    }

    const existingStudio = (workspace.network_metadata as { studio?: unknown } | null)?.studio
    const nextStudio = isStudio(studio) ? studio : isStudio(existingStudio) ? existingStudio : undefined

    const { error: updateError } = await admin
      .from('workspaces')
      .update({
        network_metadata: {
          department,
          year: yearLevel,
          // Omitted rather than written as null when there is no studio on
          // either side: `network_metadata->>studio IS NULL` and `= 'null'`
          // are different queries, and the drill-down groups on the former.
          ...(nextStudio ? { studio: nextStudio } : {}),
        },
        academic_year: academicYear,
        instructor: instructorResult.value,
      })
      .eq('id', workspaceId)

    if (updateError) {
      console.error('Error updating workspace network metadata:', updateError)
      return NextResponse.json({ error: 'Failed to update network metadata' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error in PATCH /api/workspaces/[id]/network-metadata:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
