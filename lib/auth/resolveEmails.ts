import { supabaseServiceRole } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof supabaseServiceRole>

export type ResolvedUser = { id: string; fullName: string | null }

/**
 * Resolve a set of email addresses to auth user ids (+ display name).
 *
 * Emails live only in auth.users (user_profiles has no email column), so we
 * page through the GoTrue admin list. Crucially we loop until a SHORT page —
 * NOT just page 1 — so organizations with more than `perPage` users resolve
 * fully. (The /api/admin/users list route reads only page 1 and silently
 * truncates past 1000; this helper deliberately does not.)
 *
 * Display names are joined from user_profiles (user_id is uuid) in a single
 * follow-up query for exactly the ids we matched.
 *
 * Returns a Map keyed by LOWERCASED email. Emails with no matching auth account
 * are simply absent from the Map. Callers should lowercase their lookups.
 *
 * Pass an existing service-role client to reuse it; omit and one is created.
 */
export async function resolveEmailsToUserIds(
  emails: string[],
  adminClient?: AdminClient
): Promise<Map<string, ResolvedUser>> {
  const result = new Map<string, ResolvedUser>()
  if (emails.length === 0) return result

  const admin = adminClient ?? supabaseServiceRole()

  // The lowercased set we're looking for — O(1) membership as we scan pages.
  const wanted = new Set(emails.map((e) => e.toLowerCase()))
  // Resolved id -> lowercased email, so we can attach names in one query.
  const idToEmail = new Map<string, string>()

  const perPage = 1000
  let page = 1
  let hasMore = true
  while (hasMore) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.error('resolveEmailsToUserIds: listUsers failed on page', page, error)
      break
    }
    const users = data?.users ?? []
    for (const u of users) {
      const emailLower = u.email?.toLowerCase()
      if (emailLower && wanted.has(emailLower) && !result.has(emailLower)) {
        result.set(emailLower, { id: u.id, fullName: null })
        idToEmail.set(u.id, emailLower)
      }
    }
    // Stop once we've found everyone, or the page was short (last page).
    if (result.size >= wanted.size) break
    hasMore = users.length === perPage
    page++
  }

  // Attach full_name from user_profiles for the ids we resolved (single query).
  const ids = Array.from(idToEmail.keys())
  if (ids.length > 0) {
    const { data: profiles, error } = await admin
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', ids)
    if (error) {
      console.error('resolveEmailsToUserIds: user_profiles lookup failed', error)
    } else {
      for (const p of profiles ?? []) {
        const emailLower = idToEmail.get(p.user_id as string)
        const entry = emailLower ? result.get(emailLower) : undefined
        if (entry) entry.fullName = (p.full_name as string | null) ?? null
      }
    }
  }

  return result
}
