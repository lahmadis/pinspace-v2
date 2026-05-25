import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { validateName } from '@/lib/validation/safeName'

/** PATCH /api/settings/profile — update display name and/or avatar_url */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = supabaseServer()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (typeof body?.full_name === 'string') {
      // Empty string clears the name; otherwise validate.
      if (body.full_name.trim() === '') {
        updates.full_name = null
      } else {
        const nameResult = validateName(body.full_name, { maxLength: 80, fieldLabel: 'Display name' })
        if (!nameResult.ok) {
          return NextResponse.json({ error: nameResult.error }, { status: 400 })
        }
        updates.full_name = nameResult.value
      }
    }
    if (typeof body?.avatar_url === 'string') {
      updates.avatar_url = body.avatar_url || null
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('user_id', session.user.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating profile:', error)
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
