import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

/**
 * POST /api/feedback
 *
 * "Report a bug / idea" submissions from the dashboard.
 *
 * Flow (durable-first): insert the row via the service-role client BEFORE sending
 * email, so feedback is never lost even if Resend bounces. Auth is OPTIONAL — we
 * capture the user id/email if a session exists, but unauthenticated feedback is
 * still accepted. If the email send fails we still return success (the row is the
 * backup) and only log the error server-side.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const pageUrl = typeof body?.page_url === 'string' ? body.page_url : null

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Optional: capture who sent it, but never require auth.
    let userId: string | null = null
    let userEmail: string | null = null
    try {
      const { data: { session } } = await supabaseServer().auth.getSession()
      if (session?.user) {
        userId = session.user.id
        userEmail = session.user.email ?? null
      }
    } catch {
      // Ignore — feedback works even if we can't read a session.
    }

    // 1. Durable backup first (bypasses RLS via service role).
    const { error: insertError } = await supabaseServiceRole()
      .from('feedback')
      .insert({
        message,
        user_id: userId,
        user_email: userEmail,
        page_url: pageUrl,
      })

    if (insertError) {
      console.error('Failed to save feedback row:', insertError)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    // 2. Best-effort email notification. Failure here must NOT fail the request.
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const preview = message.length > 60 ? `${message.slice(0, 60)}…` : message
      const html = [
        `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
        '<hr/>',
        `<p style="color:#666;font-size:12px">`,
        `From: ${escapeHtml(userEmail ?? '(not signed in)')}<br/>`,
        `User id: ${escapeHtml(userId ?? '(none)')}<br/>`,
        `Page: ${escapeHtml(pageUrl ?? '(unknown)')}`,
        `</p>`,
      ].join('')
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'PinSpace <noreply@mail.pinspace3d.com>',
            to: ['slahmadi04@gmail.com'],
            subject: `PinSpace feedback — ${preview}`,
            html,
          }),
        })
      } catch (emailErr) {
        // Non-fatal — the row is already saved as backup.
        console.error('Failed to send feedback email:', emailErr)
      }
    } else {
      console.warn('RESEND_API_KEY not set — feedback saved but email skipped')
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
