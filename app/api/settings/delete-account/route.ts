import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { NOTIFY_EMAIL } from '@/lib/notifyEmail'

/**
 * POST /api/settings/delete-account
 *
 * Soft-delete: sets deleted_at = now(). Full cascading hard-delete is deferred post-pilot.
 * Sends a notification email via Resend to the operational notification address
 * (PINSPACE_NOTIFY_EMAIL) so an operator can manually handle data cleanup.
 * Requires RESEND_API_KEY env var; skips silently if absent.
 */
export async function POST() {
  try {
    const supabase = supabaseServer()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userEmail = session.user.email ?? '(unknown)'

    const { error } = await supabase
      .from('user_profiles')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', session.user.id)

    if (error) {
      console.error('Error soft-deleting account:', error)
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    // Notify the operational address so cleanup can be run manually
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'pinspace <noreply@mail.pinspace3d.com>',
            to: [NOTIFY_EMAIL],
            subject: `[pinspace] Account deletion request — ${userEmail}`,
            html: `<p>User <strong>${userEmail}</strong> (id: ${session.user.id}) requested account deletion.</p><p>Their <code>user_profiles.deleted_at</code> is now set. Please manually clean up associated workspaces and boards when ready.</p>`,
          }),
        })
      } catch (emailErr) {
        // Non-fatal — account is already soft-deleted
        console.error('Failed to send deletion notification email:', emailErr)
      }
    } else {
      console.warn('RESEND_API_KEY not set — skipping deletion notification email for', userEmail)
    }

    await supabase.auth.signOut()

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
