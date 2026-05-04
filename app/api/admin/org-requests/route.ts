import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

export const dynamic = 'force-dynamic'

/** GET /api/admin/org-requests – list pending requests oldest-first (admin only). */
export async function GET() {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = supabaseServiceRole()
    const { data, error } = await admin
      .from('org_requests')
      .select('id, email, domain, requested_at')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })

    if (error) {
      console.error('GET org-requests error:', error)
      return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500 })
    }

    return NextResponse.json({ requests: data ?? [] })
  } catch (e) {
    console.error('GET /api/admin/org-requests:', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
