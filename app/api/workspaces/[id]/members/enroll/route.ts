import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { resolveEmailsToUserIds } from '@/lib/auth/resolveEmails'

export const dynamic = 'force-dynamic'

const MAX_EMAILS = 200

/**
 * POST /api/workspaces/[id]/members/enroll — class-owner bulk enroll by email.
 *
 * OWNER ONLY. Independently verifies workspace.owner_id === the session user id
 * via a service-role read + app-code check (the same owner primitive
 * authorizeRoomMutation uses for non-rename mutations). This is deliberately
 * NOT gated on PINSPACE_ADMIN_EMAILS or user_profiles.is_superadmin — enrolling
 * students is the class owner's roster power, not a platform-admin power.
 *
 * Body: { emails: string[] }. Normalized server-side (trim/lowercase/dedupe/
 * drop-blank) and capped at MAX_EMAILS. Each email resolves to exactly one of:
 *   - notFound: no auth account has that email (they must sign up first)
 *   - alreadyMember: a workspace_members row already exists
 *   - enrolled: inserted as a role:'student' member
 *
 * Membership only — does NOT touch user_profiles.organization_id (org
 * assignment is a separate feature, intentionally out of scope here).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
    }

    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = params.id
    const body = await request.json().catch(() => ({}))
    const rawEmails: unknown = body?.emails
    if (!Array.isArray(rawEmails)) {
      return NextResponse.json({ error: 'emails must be an array of strings' }, { status: 400 })
    }

    // Normalize: trim, lowercase, drop blanks, dedupe (first-seen order).
    const seen = new Set<string>()
    const emails: string[] = []
    for (const raw of rawEmails) {
      if (typeof raw !== 'string') continue
      const e = raw.trim().toLowerCase()
      if (!e || seen.has(e)) continue
      seen.add(e)
      emails.push(e)
    }

    if (emails.length === 0) {
      return NextResponse.json({ error: 'No valid email addresses provided' }, { status: 400 })
    }
    if (emails.length > MAX_EMAILS) {
      return NextResponse.json(
        { error: `Too many emails — the cap is ${MAX_EMAILS} per request (received ${emails.length}).` },
        { status: 400 }
      )
    }

    const admin = supabaseServiceRole()

    // Owner-only gate. Service-role read + app-code ownership check.
    const { data: workspace, error: wsError } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (wsError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    if (workspace.owner_id !== userId) {
      return NextResponse.json(
        { error: 'Only the class owner can add students' },
        { status: 403 }
      )
    }

    // Resolve emails -> auth user ids (+ names). Paginates ALL users so orgs
    // over 1000 users resolve fully.
    const resolved = await resolveEmailsToUserIds(emails, admin)

    // Load existing members once so we can classify alreadyMember without a
    // per-email round-trip. user_id is TEXT holding the auth uuid.
    const { data: memberRows, error: membersError } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
    if (membersError) {
      console.error('Error loading workspace members for enroll:', membersError)
      return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })
    }
    // Doubles as the "already handled this batch" set — updated after each
    // successful insert so a resolved id can't be inserted twice.
    const memberIds = new Set((memberRows ?? []).map((m) => String(m.user_id)))

    const enrolled: Array<{ email: string; name: string | null }> = []
    const alreadyMember: string[] = []
    const notFound: string[] = []

    // Sequential per-email inserts: classification stays honest per-row, one bad
    // row can't sink the batch, and the name-column fallback mirrors the join
    // route exactly. N is capped at MAX_EMAILS and this is an owner action, so
    // sequential is acceptable (same tradeoff as the reorder route).
    for (const email of emails) {
      const match = resolved.get(email)
      if (!match) {
        notFound.push(email)
        continue
      }
      if (memberIds.has(match.id)) {
        alreadyMember.push(email)
        continue
      }

      // Insert as a student. user_id is TEXT holding the auth uuid → pass as a
      // string. Mirror the join route's name-column fallback for schema
      // variants that lack workspace_members.name.
      const insertPayload: Record<string, unknown> = {
        workspace_id: workspaceId,
        user_id: String(match.id),
        role: 'student',
      }
      if (match.fullName) insertPayload.name = match.fullName

      let { error: insertError } = await admin
        .from('workspace_members')
        .insert(insertPayload)

      if (insertError && String(insertError.message || '').includes("'name' column")) {
        const retry = await admin
          .from('workspace_members')
          .insert({ workspace_id: workspaceId, user_id: String(match.id), role: 'student' })
        insertError = retry.error
      }

      if (insertError) {
        // Rare (e.g. a concurrent self-join racing a unique constraint). Log and
        // skip — do NOT claim enrolled. Counts may under-sum on such rows.
        console.error('Error enrolling student:', insertError, { email })
        continue
      }

      memberIds.add(match.id)
      enrolled.push({ email, name: match.fullName })
    }

    return NextResponse.json({ enrolled, alreadyMember, notFound })
  } catch (error) {
    console.error('Unexpected error in POST /api/workspaces/[id]/members/enroll:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
