import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function isAdmin(email: string | undefined): boolean {
  if (!email) return false
  const list = process.env.PINSPACE_ADMIN_EMAILS
  if (!list) return false
  const emails = list.split(',').map((e) => e.trim().toLowerCase())
  return emails.includes(email.toLowerCase())
}

/** GET /api/admin/overview – institutions with workspace counts (admin only). */
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
    const { data: institutions, error: instErr } = await admin
      .from('institutions')
      .select('id, name, slug, network_label, allowed_email_domains, type')
      .order('name')

    if (instErr) {
      console.error('Error fetching institutions:', instErr)
      return NextResponse.json({ error: 'Failed to fetch institutions' }, { status: 500 })
    }

    const withCounts = await Promise.all(
      (institutions || []).map(async (inst) => {
        const [workspacesResult, userCountResult] = await Promise.all([
          admin
            .from('workspaces')
            .select('id, name, type, created_at', { count: 'exact' })
            .eq('institution_id', inst.id)
            .order('created_at', { ascending: false }),
          admin
            .from('user_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('institution_id', inst.id),
        ])
        return {
          ...inst,
          workspace_count: workspacesResult.error ? 0 : (workspacesResult.count ?? 0),
          user_count: userCountResult.error ? 0 : (userCountResult.count ?? 0),
          workspaces: workspacesResult.data ?? [],
        }
      })
    )

    return NextResponse.json({ institutions: withCounts })
  } catch (error) {
    console.error('Error in GET /api/admin/overview:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
