import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

/** GET /api/admin/me – returns whether the current user is an admin (email in PINSPACE_ADMIN_EMAILS). */
export async function GET() {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.user) {
      return NextResponse.json({ isAdmin: false })
    }

    const email = session.user.email
    return NextResponse.json({ isAdmin: isAdmin(email) })
  } catch {
    return NextResponse.json({ isAdmin: false })
  }
}
