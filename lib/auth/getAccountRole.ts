import { supabaseServiceRole } from '@/lib/supabase/server'

export type AccountRole = 'student' | 'instructor'

/**
 * Server-side single source of truth for a user's account_role.
 *
 * Reads with the service-role client so the lookup is independent of the
 * caller's RLS context, and fails CLOSED ('student') whenever the profile,
 * column, or value is missing/unexpected. Callers gate instructor-only actions
 * on this — never trust a client-supplied role.
 */
export async function getAccountRole(userId: string | undefined | null): Promise<AccountRole> {
  if (!userId) return 'student'
  try {
    const admin = supabaseServiceRole()
    const { data, error } = await admin
      .from('user_profiles')
      .select('account_role')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return 'student'
    return data.account_role === 'instructor' ? 'instructor' : 'student'
  } catch {
    return 'student'
  }
}

/** Convenience predicate for instructor-only gates. */
export async function isInstructorAccount(userId: string | undefined | null): Promise<boolean> {
  return (await getAccountRole(userId)) === 'instructor'
}
