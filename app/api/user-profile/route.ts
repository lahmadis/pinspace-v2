import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { validateName } from '@/lib/validation/safeName'

/** GET /api/user-profile – get current user's profile. Returns null if none. */
export async function GET() {
  try {
    const supabase = await supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*, organization:organizations(id, name, slug, network_label, type)')
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (error) {
      console.error('Error fetching user profile:', error)
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in GET /api/user-profile:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/** POST /api/user-profile – create or update profile (onboarding). */
export async function POST(req: NextRequest) {
  try {
    const supabase = await supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const age = body?.age != null ? Math.max(1, Math.min(120, Number(body.age))) : null
    const ageRange = body?.age_range?.trim() || null
    const year = body?.year?.trim() || null
    const major = body?.major?.trim() || null
    // SECURITY (audit pass 1): organization_id is NOT accepted here. Org
    // membership is a trust boundary (it grants org-wide read access via RLS +
    // app checks), so it is set ONLY by the email-domain-verified claim-domain
    // flow (/api/user-profile/claim-domain). Any institution_id in the body is
    // ignored — a client can no longer self-assert org membership.
    const howHeard = body?.how_heard?.trim() || null
    // full_name is optional; validate only when a non-empty value is supplied.
    let fullName: string | null = null
    if (body?.full_name != null && String(body.full_name).trim() !== '') {
      const nameResult = validateName(body.full_name, { maxLength: 80, fieldLabel: 'Display name' })
      if (!nameResult.ok) {
        return NextResponse.json({ error: nameResult.error }, { status: 400 })
      }
      fullName = nameResult.value
    }
    const role =
      body?.role === 'faculty' ? 'faculty'
      : body?.role === 'student' ? 'student'
      : body?.role === 'professional' ? 'professional'
      : null

    const profile = {
      user_id: session.user.id,
      age: age || null,
      age_range: ageRange || null,
      year: year || null,
      major: major || null,
      how_heard: howHeard || null,
      full_name: fullName || null,
      role: role || null,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(profile, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) {
      console.error('Error saving user profile:', error)
      return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in POST /api/user-profile:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
