import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { NOTIFY_EMAIL } from '@/lib/notifyEmail'

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
      const { data: { session } } = await (await supabaseServer()).auth.getSession()
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

    // 2. Best-effort email notification. Failure here must NOT fail the request,
    //    but it must NOT be silent either: we surface whether it worked via the
    //    `emailSent` flag in the response and console.error the REAL error so a
    //    Resend rejection or missing key shows up in the Vercel function logs.
    //    (Matches the delete-account route's env var + fetch pattern exactly.)
    let emailSent = false
    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) {
      // RESEND_API_KEY is the HTTP Resend API key — SEPARATE from the SMTP creds
      // Supabase uses for auth/OTP emails. If auth emails work but this doesn't,
      // the key is likely missing/misscoped in Vercel: add RESEND_API_KEY to the
      // project's env (Production) and redeploy. No code change can fix that.
      console.error('[feedback] RESEND_API_KEY is not set — email NOT sent (row saved). Likely a Vercel env scoping issue.')
    } else {
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
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'pinspace <noreply@mail.pinspace3d.com>',
            to: [NOTIFY_EMAIL],
            subject: `pinspace feedback — ${preview}`,
            html,
          }),
        })
        if (res.ok) {
          emailSent = true
        } else {
          // fetch does NOT throw on 4xx/5xx, so without this check a Resend
          // rejection (bad key, unverified domain, bad payload) looks like
          // success. Log the real status + body so it's visible in Vercel.
          const detail = await res.text().catch(() => '(no body)')
          console.error(`[feedback] Resend rejected send: ${res.status} ${res.statusText} — ${detail}`)
        }
      } catch (emailErr) {
        // Network-level throw before a response — row is already saved as backup.
        console.error('[feedback] Resend send threw:', emailErr)
      }
    }

    return NextResponse.json({ ok: true, emailSent })
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
