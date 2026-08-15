import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

/** PATCH /api/settings/notifications — update notification preferences */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await supabaseServer()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (typeof body?.notify_room_invites === 'boolean') {
      updates.notify_room_invites = body.notify_room_invites
    }
    if (typeof body?.notify_platform_updates === 'boolean') {
      updates.notify_platform_updates = body.notify_platform_updates
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('user_id', session.user.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating notifications:', error)
      return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
