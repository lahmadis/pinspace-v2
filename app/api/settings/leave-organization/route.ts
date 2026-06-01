import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

/** POST /api/settings/leave-organization — clear the user's organization membership */
export async function POST() {
  try {
    const supabase = supabaseServer()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabase
      .from('user_profiles')
      .update({ organization_id: null, updated_at: new Date().toISOString() })
      .eq('user_id', session.user.id)

    if (error) {
      console.error('Error leaving organization:', error)
      return NextResponse.json({ error: 'Failed to leave organization' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
