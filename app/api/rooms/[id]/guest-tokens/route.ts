import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Guest critic token management for a room. OWNER ONLY (not members) — creating
// no-account critic access is a stronger grant than the read-only /share link.
// All access via the service-role client after an explicit owner check.

type Admin = ReturnType<typeof supabaseServiceRole>

// Returns { ok: true } when userId owns the room's workspace, else an error.
async function requireRoomOwner(
  admin: Admin,
  roomId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: room } = await admin
    .from('rooms')
    .select('id, workspace_id')
    .eq('id', roomId)
    .maybeSingle()
  if (!room) return { ok: false, status: 404, error: 'Room not found' }
  const { data: ws } = await admin
    .from('workspaces')
    .select('owner_id')
    .eq('id', room.workspace_id)
    .maybeSingle()
  if (!ws) return { ok: false, status: 404, error: 'Workspace not found' }
  if (ws.owner_id !== userId) return { ok: false, status: 403, error: 'Only the workspace owner can manage guest links' }
  return { ok: true }
}

async function requireSession(): Promise<{ userId: string } | { error: NextResponse }> {
  const supabase = supabaseServer()
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) return { error: NextResponse.json({ error: 'Failed to get session' }, { status: 500 }) }
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { userId }
}

// POST — create a guest token for the room.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const roomId = params.id
  const auth = await requireSession()
  if ('error' in auth) return auth.error
  const admin = supabaseServiceRole()
  const gate = await requireRoomOwner(admin, roomId, auth.userId)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await request.json().catch(() => ({}))
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })

  let expiresAt: string | null = null
  if (body.expiresAt != null && body.expiresAt !== '') {
    const d = new Date(body.expiresAt)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'expiresAt must be a valid ISO timestamp' }, { status: 400 })
    }
    expiresAt = d.toISOString()
  }
  const canComment = body.canComment !== false
  const canTrace = body.canTrace !== false

  // Token value: base64url of random bytes — same approach as room_share_tokens.
  const rawUuid = crypto.randomUUID().replace(/-/g, '')
  const token = Buffer.from(rawUuid, 'hex').toString('base64url').replace(/=/g, '')

  const { data: inserted, error } = await admin
    .from('guest_tokens')
    .insert({
      room_id: roomId,
      token,
      label: label.slice(0, 120),
      can_comment: canComment,
      can_trace: canTrace,
      expires_at: expiresAt,
      created_by: auth.userId,
    })
    .select()
    .single()

  if (error || !inserted) {
    console.error('Failed to create guest token:', error)
    return NextResponse.json({ error: 'Failed to create guest link' }, { status: 500 })
  }

  const origin = request.nextUrl.origin
  return NextResponse.json({
    token: {
      id: inserted.id,
      label: inserted.label,
      createdAt: inserted.created_at,
      expiresAt: inserted.expires_at,
      revoked: inserted.revoked,
      canComment: inserted.can_comment,
      canTrace: inserted.can_trace,
    },
    critUrl: `${origin}/crit/${token}`,
  })
}

// GET — list the room's guest tokens (owner only). Token VALUE is not returned.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const roomId = params.id
  const auth = await requireSession()
  if ('error' in auth) return auth.error
  const admin = supabaseServiceRole()
  const gate = await requireRoomOwner(admin, roomId, auth.userId)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data: tokens, error } = await admin
    .from('guest_tokens')
    .select('id, label, created_at, expires_at, revoked, can_comment, can_trace')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to list guest tokens:', error)
    return NextResponse.json({ error: 'Failed to list guest links' }, { status: 500 })
  }

  return NextResponse.json({
    tokens: (tokens || []).map((t) => ({
      id: t.id,
      label: t.label,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
      revoked: t.revoked,
      canComment: t.can_comment,
      canTrace: t.can_trace,
    })),
  })
}

// PATCH — revoke a token by id (owner only).
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const roomId = params.id
  const auth = await requireSession()
  if ('error' in auth) return auth.error
  const admin = supabaseServiceRole()
  const gate = await requireRoomOwner(admin, roomId, auth.userId)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await request.json().catch(() => ({}))
  const tokenId = typeof body.tokenId === 'string' ? body.tokenId : null
  if (!tokenId) return NextResponse.json({ error: 'tokenId is required' }, { status: 400 })

  // The token must belong to this room (prevents cross-room revocation).
  const { data: tok } = await admin
    .from('guest_tokens')
    .select('id, room_id')
    .eq('id', tokenId)
    .maybeSingle()
  if (!tok || tok.room_id !== roomId) {
    return NextResponse.json({ error: 'Guest link not found' }, { status: 404 })
  }

  const { error } = await admin.from('guest_tokens').update({ revoked: true }).eq('id', tokenId)
  if (error) {
    console.error('Failed to revoke guest token:', error)
    return NextResponse.json({ error: 'Failed to revoke guest link' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
