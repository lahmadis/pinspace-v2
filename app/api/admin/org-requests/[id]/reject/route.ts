import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

export const dynamic = 'force-dynamic'

/** PATCH /api/admin/org-requests/[id]/reject – reject a pending request (admin only). */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

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
      .update({
        status: 'rejected',
        decided_at: new Date().toISOString(),
        decided_by: session.user.id,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, email, domain, requested_at, status')
      .maybeSingle()

    if (error) {
      console.error('PATCH reject org-request error:', error)
      return NextResponse.json({ error: 'Failed to reject request' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Request already processed' }, { status: 409 })
    }

    return NextResponse.json({ request: data })
  } catch (e) {
    console.error('PATCH /api/admin/org-requests/[id]/reject:', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
