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
        const { count, error: countErr } = await admin
          .from('workspaces')
          .select('*', { count: 'exact', head: true })
          .eq('institution_id', inst.id)
        return {
          ...inst,
          workspace_count: countErr ? 0 : (count ?? 0),
        }
      })
    )

    return NextResponse.json({ institutions: withCounts })
  } catch (error) {
    console.error('Error in GET /api/admin/overview:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: (error as Error).message },
      { status: 500 }
    )
  }
}
