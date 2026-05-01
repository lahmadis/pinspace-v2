import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase() : ''

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }
    if (!domain || !domain.includes('.')) {
      return NextResponse.json({ error: 'Valid domain required' }, { status: 400 })
    }
    // Ensure the domain the client sends matches the actual email domain.
    // Prevents spoofed requests that submit an unrelated domain for a given email.
    const emailDomain = email.split('@')[1]
    if (emailDomain !== domain) {
      return NextResponse.json({ error: 'Domain does not match email' }, { status: 400 })
    }

    const supabase = supabaseServiceRole()

    const { error } = await supabase
      .from('org_requests')
      .insert({ email, domain })

    if (error) {
      console.error('[request-org] insert error:', error)
      return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[request-org] unexpected error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
