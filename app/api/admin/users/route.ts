import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

type OrgRef = { name: string | null } | { name: string | null }[] | null

function orgName(org: OrgRef): string | null {
  if (!org) return null
  const o = Array.isArray(org) ? org[0] : org
  return o?.name ?? null
}

/** GET /api/admin/users — list onboarded users with email, name, org, and roles. */
export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const admin = supabaseServiceRole()

    const { data: profiles, error: profilesErr } = await admin
      .from('user_profiles')
      .select('user_id, full_name, role, account_role, organization:organizations(name)')
      .order('full_name', { ascending: true })

    if (profilesErr) {
      console.error('Error fetching user profiles:', profilesErr)
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    // Map user_id -> email from the auth table (service-role admin API).
    const { data: authList, error: authErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (authErr) {
      console.error('Error listing auth users:', authErr)
    }
    const emailMap = new Map<string, string | null>(
      (authList?.users ?? []).map((u) => [u.id, u.email ?? null])
    )

    const users = (profiles ?? []).map((p) => ({
      userId: p.user_id as string,
      email: emailMap.get(p.user_id as string) ?? null,
      fullName: (p.full_name as string | null) ?? null,
      organization: orgName(p.organization as OrgRef),
      role: (p.role as string | null) ?? null, // demographic role (student/faculty/...)
      accountRole: p.account_role === 'instructor' ? 'instructor' : 'student',
    }))

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Error in GET /api/admin/users:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/** PATCH /api/admin/users — flip a user's account_role. Body: { userId, accountRole }. */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const body = await req.json().catch(() => null)
    const userId = typeof body?.userId === 'string' ? body.userId : null
    const accountRole = body?.accountRole
    if (!userId || (accountRole !== 'student' && accountRole !== 'instructor')) {
      return NextResponse.json(
        { error: 'userId and accountRole (student|instructor) are required' },
        { status: 400 }
      )
    }

    const admin = supabaseServiceRole()
    const { data, error } = await admin
      .from('user_profiles')
      .update({ account_role: accountRole, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('user_id, account_role')
      .maybeSingle()

    if (error) {
      console.error('Error updating account_role:', error)
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    return NextResponse.json({ userId: data.user_id, accountRole: data.account_role })
  } catch (error) {
    console.error('Error in PATCH /api/admin/users:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
