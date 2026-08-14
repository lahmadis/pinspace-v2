import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const roomId = params.id

  const supabase = supabaseServer()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = user.id

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

  // SECURITY (audit pass 1): minting a public /share link exposes the room's
  // boards to anyone with the URL, so it's owner-only — matching the guest-token
  // rule. (Members were previously allowed; existing links are unaffected.)
  if (ws.owner_id !== userId) {
    return NextResponse.json(
      { error: 'Only the workspace owner can create a share link' },
      { status: 403 }
    )
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
