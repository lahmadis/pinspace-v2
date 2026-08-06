import { supabaseServiceRole } from '@/lib/supabase/server'
import { isUuid } from '@/lib/validation/uuid'

type AdminClient = ReturnType<typeof supabaseServiceRole>

/**
 * Resolving which organization a user belongs to.
 *
 * user_profiles.organization_id is the authoritative answer, but it only exists
 * for accounts that have ONBOARDED. Admin provisioning deliberately supports
 * professors who have not — see POST /api/admin/studios — so any admin surface
 * that resolves an org purely from the profile shows a blank for exactly the
 * pilot accounts it exists to manage.
 *
 * The fallback is the email domain, via org_domains — the same mechanism
 * /api/user-profile/claim-domain uses, so a user's org is the same whether it
 * is read before or after they onboard. Lifted out of the provisioning route so
 * the admin read paths cannot drift from the write path.
 *
 * Everything here is service-role: org_domains and organizations have no
 * membership-shaped SELECT policy for a third party, and callers are
 * admin-gated in app code.
 */

/** Lowercased domain part of an email, or null if there isn't one. */
function emailDomain(email: string | null | undefined): string | null {
  const domain = email?.split('@')[1]?.trim().toLowerCase()
  return domain && domain.length > 0 ? domain : null
}

/**
 * Map of domain -> org_id for the given domains, in ONE query.
 *
 * A failed lookup returns an empty map and logs. Callers treat that as "no org
 * known", which is the same outcome as an unclaimed domain — the difference is
 * only visible in the logs, which is why it must not be swallowed.
 */
export async function orgIdsForDomains(
  admin: AdminClient,
  domains: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(domains.filter((d) => d.length > 0)))
  if (unique.length === 0) return new Map()

  const { data, error } = await admin
    .from('org_domains')
    .select('domain, org_id')
    .in('domain', unique)

  if (error) {
    console.error('Error resolving orgs by email domain:', unique, error)
    return new Map()
  }

  const map = new Map<string, string>()
  for (const row of data ?? []) {
    const domain = (row.domain as string | null)?.toLowerCase()
    const orgId = row.org_id as string | null
    if (domain && orgId) map.set(domain, orgId)
  }
  return map
}

/**
 * Single-user convenience: org id for an email's domain, or null.
 *
 * This is the exact behaviour POST /api/admin/studios had inline before the
 * extraction — same query, same "null means leave it unset" contract.
 */
export async function orgIdFromEmailDomain(
  admin: AdminClient,
  email: string | null | undefined
): Promise<string | null> {
  const domain = emailDomain(email)
  if (!domain) return null
  const map = await orgIdsForDomains(admin, [domain])
  return map.get(domain) ?? null
}

export interface OrgLookupPerson {
  userId: string
  email: string | null
  /** user_profiles.organization_id, or null when there is no profile row. */
  organizationId: string | null
}

/**
 * Resolve a DISPLAY org name for many users at once: profile org first, email
 * domain second, null if neither answers.
 *
 * Three queries total regardless of how many people are passed — one for the
 * domains, one for the org names, and none per person. The naive version is a
 * lookup per row, which on an admin list is the difference between one round
 * trip and thirty.
 */
export async function resolveOrgNames(
  admin: AdminClient,
  people: OrgLookupPerson[]
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  if (people.length === 0) return result

  // Anyone without a profile org gets the domain fallback. Collect the domains
  // first so they resolve in a single query.
  const needsDomain = people.filter((p) => !p.organizationId)
  const domainMap = await orgIdsForDomains(
    admin,
    needsDomain.map((p) => emailDomain(p.email)).filter((d): d is string => d != null)
  )

  // userId -> org id, from whichever source answered.
  const orgIdByUser = new Map<string, string>()
  for (const person of people) {
    const direct = person.organizationId
    if (direct) {
      orgIdByUser.set(person.userId, direct)
      continue
    }
    const domain = emailDomain(person.email)
    const viaDomain = domain ? domainMap.get(domain) : undefined
    if (viaDomain) orgIdByUser.set(person.userId, viaDomain)
  }

  // organizations.id is UUID. A malformed value from anywhere would raise 22P02
  // and blank the org column for EVERY person in the batch, so filter first.
  const orgIds = Array.from(new Set(orgIdByUser.values())).filter(isUuid)
  const nameById = new Map<string, string | null>()
  if (orgIds.length > 0) {
    const { data, error } = await admin.from('organizations').select('id, name').in('id', orgIds)
    if (error) {
      // Cosmetic-but-misleading on failure: every user reads as having no org,
      // which is indistinguishable from an unclaimed domain. Log it.
      console.error('Error resolving organization names:', error)
    }
    for (const row of data ?? []) {
      nameById.set(row.id as string, (row.name as string | null) ?? null)
    }
  }

  for (const person of people) {
    const orgId = orgIdByUser.get(person.userId)
    result.set(person.userId, orgId ? nameById.get(orgId) ?? null : null)
  }
  return result
}
