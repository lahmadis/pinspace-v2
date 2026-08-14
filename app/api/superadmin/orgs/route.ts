import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin } from '@/lib/auth/superadmin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/superadmin/orgs — list every organization, for the superadmin org
 * switcher. Doubles as the gate signal for the UI: 403 for non-superadmins
 * (the switcher renders nothing), 200 + orgs for superadmins. Superadmin status
 * is verified server-side via service role from the authenticated user id.
 */
export async function GET() {
  try {
    const supabase = supabaseServer()
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = supabaseServiceRole()
    if (!(await isSuperadmin(userId, admin))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: orgs, error } = await admin
      .from('organizations')
      .select('id, name, slug')
      .order('name')

    if (error) {
      console.error('superadmin/orgs GET error:', error)
      return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 })
    }

    const response = NextResponse.json({ orgs: orgs ?? [] })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (err) {
    console.error('superadmin/orgs GET unexpected error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
