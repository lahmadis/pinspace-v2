import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const roomId = params.id

  const supabase = supabaseServer()
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) {
    return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
  }
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseServiceRole()

  const { data: room } = await admin
    .from('rooms')
    .select('id, workspace_id')
    .eq('id', roomId)
    .maybeSingle()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data: ws } = await admin
    .from('workspaces')
    .select('owner_id')
    .eq('id', room.workspace_id)
    .single()

  if (!ws) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  if (ws.owner_id !== userId) {
    const { data: membership } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', room.workspace_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { data: existing } = await admin
    .from('room_share_tokens')
    .select('token')
    .eq('room_id', roomId)
    .eq('revoked', false)
    .maybeSingle()

  if (existing) {
    const origin = request.nextUrl.origin
    return NextResponse.json({
      token: existing.token,
      shareUrl: `${origin}/share/${existing.token}`,
    })
  }

  const rawUuid = crypto.randomUUID().replace(/-/g, '')
  const token = Buffer.from(rawUuid, 'hex').toString('base64url').replace(/=/g, '')

  const { error: insertError } = await admin
    .from('room_share_tokens')
    .insert({ room_id: roomId, token, created_by: userId })

  if (insertError) {
    console.error('Failed to insert share token:', insertError)
    return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 })
  }

  const origin = request.nextUrl.origin
  return NextResponse.json({
    token,
    shareUrl: `${origin}/share/${token}`,
  })
}
