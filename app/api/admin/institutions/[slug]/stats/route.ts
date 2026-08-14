import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

/** GET /api/admin/institutions/[slug]/stats – full institution stats (admin only). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    if (!slug) {
      return NextResponse.json({ error: 'Slug required' }, { status: 400 })
    }

    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const admin = supabaseServiceRole()

    const { data: institution, error: instErr } = await admin
      .from('organizations')
      .select('id, name, slug, network_label')
      .eq('slug', slug)
      .single()

    if (instErr || !institution) {
      return NextResponse.json({ error: 'Institution not found' }, { status: 404 })
    }

    const institutionId = institution.id

    const { data: orgDomainsRows } = await admin
      .from('org_domains')
      .select('domain')
      .eq('org_id', institutionId)
      .order('domain')
    const institutionDomains = (orgDomainsRows ?? []).map((r) => r.domain)

    const { data: workspaces, error: wsErr } = await admin
      .from('workspaces')
      .select('id, name, owner_id, type, created_at')
      .eq('organization_id', institutionId)

    if (wsErr) {
      console.error('Error fetching workspaces:', wsErr)
      return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 })
    }

    const workspaceIds = (workspaces || []).map((w) => w.id)
    const ownerIds = new Set<string>()
    ;(workspaces || []).forEach((w) => {
      if (w.owner_id) ownerIds.add(w.owner_id)
    })

    const memberUserIds = new Set<string>()
    if (workspaceIds.length > 0) {
      const { data: members, error: memErr } = await admin
        .from('workspace_members')
        .select('user_id')
        .in('workspace_id', workspaceIds)

      if (!memErr && members) {
        members.forEach((m) => {
          if (m.user_id) memberUserIds.add(m.user_id)
        })
      }
    }

    const allUserIds = new Set([...ownerIds, ...memberUserIds])

    const profilesMap: Record<string, { full_name?: string; major?: string; year?: string; age_range?: string; role?: string }> = {}
    if (allUserIds.size > 0) {
      const { data: profiles } = await admin
        .from('user_profiles')
        .select('user_id, full_name, major, year, age_range, role')
        .in('user_id', Array.from(allUserIds))

      ;(profiles || []).forEach((p) => {
        profilesMap[p.user_id] = {
          full_name: p.full_name || undefined,
          major: p.major || undefined,
          year: p.year || undefined,
          age_range: p.age_range || undefined,
          role: p.role || undefined,
        }
      })
    }

    const allAuth: Record<string, { email?: string; created_at?: string; user_metadata?: { full_name?: string } }> = {}
    let page = 1
    let hasMore = true
    while (hasMore) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      })
      if (error || !data?.users) break
      data.users.forEach((u) => {
        allAuth[u.id] = {
          email: u.email,
          created_at: u.created_at,
          user_metadata: u.user_metadata as { full_name?: string },
        }
      })
      hasMore = data.users.length === 1000
      page++
    }

    type UserRole = 'faculty' | 'student' | 'professional'
    const usersList: Array<{
      id: string
      email: string
      full_name: string
      role: UserRole
      major?: string
      year?: string
      age_range?: string
      created_at?: string
    }> = []

    for (const uid of allUserIds) {
      const authUser = allAuth[uid]
      const profile = profilesMap[uid]
      const email = authUser?.email || '(no email)'
      const fullName =
        profile?.full_name ||
        authUser?.user_metadata?.full_name ||
        email.split('@')[0] ||
        '—'
      const role: UserRole =
        profile?.role === 'faculty' || profile?.role === 'student' || profile?.role === 'professional'
          ? (profile.role as UserRole)
          : (ownerIds.has(uid) ? 'faculty' : 'student')

      usersList.push({
        id: uid,
        email,
        full_name: fullName,
        role,
        major: profile?.major,
        year: profile?.year,
        age_range: profile?.age_range,
        created_at: authUser?.created_at,
      })
    }

    const roleOrder = (r: UserRole) => (r === 'faculty' ? 0 : r === 'professional' ? 1 : 2)
    usersList.sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
      if (bTime !== aTime) return bTime - aTime
      return roleOrder(a.role) - roleOrder(b.role)
    })

    let boardCount = 0
    if (workspaceIds.length > 0) {
      const { count, error: boardErr } = await admin
        .from('boards')
        .select('*', { count: 'exact', head: true })
        .in('workspace_id', workspaceIds)
      if (!boardErr) boardCount = count ?? 0
    }

    const facultyCount = usersList.filter((u) => u.role === 'faculty').length
    const studentCount = usersList.filter((u) => u.role === 'student').length
    const professionalCount = usersList.filter((u) => u.role === 'professional').length

    return NextResponse.json({
      institution: {
        id: institution.id,
        name: institution.name,
        slug: institution.slug,
        network_label: institution.network_label,
        domains: institutionDomains,
      },
      summary: {
        total_users: usersList.length,
        faculty_count: facultyCount,
        student_count: studentCount,
        professional_count: professionalCount,
        studio_count: workspaces?.length ?? 0,
        board_count: boardCount,
      },
      users: usersList,
      studios: workspaces || [],
    })
  } catch (error) {
    console.error('Error in GET /api/admin/institutions/[slug]/stats:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
