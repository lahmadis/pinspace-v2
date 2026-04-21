import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const revalidate = 60
export const dynamic = 'force-dynamic'

function isAdmin(email: string | undefined): boolean {
  if (!email) return false
  const list = process.env.PINSPACE_ADMIN_EMAILS
  if (!list) return false
  const emails = list.split(',').map((e) => e.trim().toLowerCase())
  return emails.includes(email.toLowerCase())
}

/** GET /api/institutions – list all institutions (public, no auth). */
export async function GET() {
  try {
    const supabase = supabaseServiceRole()
    const { data: institutions, error } = await supabase
      .from('institutions')
      .select('id, name, slug, network_label, allowed_email_domains, type, logo_url')
      .order('name')

    if (error) {
      console.error('Error fetching institutions:', error)
      return NextResponse.json({ error: 'Failed to fetch institutions' }, { status: 500 })
    }

    const withCounts = await Promise.all(
      (institutions || []).map(async (inst) => {
        const [studiosResult, studentsResult] = await Promise.all([
          supabase
            .from('workspaces')
            .select('*', { count: 'exact', head: true })
            .eq('institution_id', inst.id)
            .eq('is_published', true),
          supabase
            .from('user_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('institution_id', inst.id),
        ])
        return {
          ...inst,
          studio_count: studiosResult.error ? 0 : (studiosResult.count ?? 0),
          student_count: studentsResult.error ? 0 : (studentsResult.count ?? 0),
        }
      })
    )

    return NextResponse.json({ institutions: withCounts })
  } catch (error) {
    console.error('Error in GET /api/institutions:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/** POST /api/institutions – create institution (admin only). Set PINSPACE_ADMIN_EMAILS (comma-separated) to allow. */
export async function POST(req: Request) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const email = session.user.email
    if (!isAdmin(email)) {
      return NextResponse.json(
        { error: 'Forbidden. Only admins can create institutions. Set PINSPACE_ADMIN_EMAILS in env.' },
        { status: 403 }
      )
    }

    const body = await req.json().catch(() => null)
    const name = body?.name?.trim()
    const slug = body?.slug?.trim()?.toLowerCase()?.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') ?? ''
    const networkLabel = body?.network_label?.trim() ?? null
    const allowedEmailDomains = body?.allowed_email_domains?.trim() ?? null
    const type = body?.type === 'firm' ? 'firm' : 'institution'
    const logoUrl = body?.logo_url?.trim() || null

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (!slug) {
      return NextResponse.json({ error: 'Slug is required (e.g. wit, mit)' }, { status: 400 })
    }

    const admin = supabaseServiceRole()
    const insertPayload: Record<string, unknown> = { name, slug, network_label: networkLabel || name, type }
    if (allowedEmailDomains) insertPayload.allowed_email_domains = allowedEmailDomains
    if (logoUrl) insertPayload.logo_url = logoUrl
    const { data, error } = await admin
      .from('institutions')
      .insert(insertPayload)
      .select('id, name, slug, network_label, allowed_email_domains, type, logo_url')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An institution with this slug already exists' }, { status: 409 })
      }
      console.error('Error creating institution:', error)
      return NextResponse.json({ error: 'Failed to create institution' }, { status: 500 })
    }

    return NextResponse.json({ institution: data }, { status: 201 })
  } catch (error) {
    console.error('Error in POST /api/institutions:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
