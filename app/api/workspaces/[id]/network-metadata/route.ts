import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { validateName } from '@/lib/validation/safeName'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/workspaces/[id]/network-metadata
 * Writes department/yearLevel/instructor/academicYear onto the workspace so
 * the explore network can filter and label it correctly. Owner only.
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
    const { department, yearLevel, instructor, academicYear } = body

    if (!department || !yearLevel || !academicYear) {
      return NextResponse.json(
        { error: 'department, yearLevel, instructor, and academicYear are all required' },
        { status: 400 }
      )
    }
    const instructorResult = validateName(instructor, { maxLength: 80, fieldLabel: 'Instructor name' })
    if (!instructorResult.ok) {
      return NextResponse.json({ error: instructorResult.error }, { status: 400 })
    }

    const admin = supabaseServiceRole()

    const { data: workspace } = await admin
      .from('workspaces')
      .select('owner_id')
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

    const { error: updateError } = await admin
      .from('workspaces')
      .update({
        network_metadata: { department, year: yearLevel },
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
