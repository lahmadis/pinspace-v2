import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
    }

    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = (await params).id
    const body = await request.json().catch(() => null)

    if (body === null || typeof body.is_archived !== 'boolean') {
      return NextResponse.json({ error: 'is_archived (boolean) required' }, { status: 400 })
    }

    const { data: workspace, error: fetchError } = await supabase
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .single()

    if (fetchError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (workspace.owner_id !== userId) {
      return NextResponse.json({ error: 'Only workspace owners can archive workspaces' }, { status: 403 })
    }

    const updateData = body.is_archived
      ? { is_archived: true, archived_at: new Date().toISOString() }
      : { is_archived: false, archived_at: null }

    const { data: updated, error: updateError } = await supabase
      .from('workspaces')
      .update(updateData)
      .eq('id', workspaceId)
      .eq('owner_id', userId)
      .select()
      .single()

    if (updateError) {
      console.error('Error archiving workspace:', updateError)
      return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
    }

    return NextResponse.json({ workspace: updated })
  } catch (error) {
    console.error('Unexpected error in PATCH /api/workspaces/[id]/archive:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
