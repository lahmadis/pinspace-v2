import type {
  AdminStudio,
  AdminInstructor,
  RecentSignup,
  InstitutionWithCount,
  AdminUser,
  AdminStats,
  InstitutionStats,
  InstructorDetail,
  InstructorStudio,
  OrgDomainItem,
} from '@/types/admin'
import type {
  CreateOrgInput,
  EditOrgInput,
  CreateStudioInput,
  TransferOwnerInput,
  UpdateUserRoleInput,
} from '@/lib/validations/admin'

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`)
  }
  return data as T
}

// Me & Overview
export async function getAdminMeApi(): Promise<{ isAdmin: boolean }> {
  const res = await fetch('/api/admin/me', { cache: 'no-store' })
  return handleResponse<{ isAdmin: boolean }>(res)
}

export async function getAdminOverviewApi(): Promise<{ institutions: InstitutionWithCount[] }> {
  const res = await fetch('/api/admin/overview', { cache: 'no-store' })
  return handleResponse<{ institutions: InstitutionWithCount[] }>(res)
}

export async function getAdminStatsApi(): Promise<AdminStats> {
  const res = await fetch('/api/admin/stats', { cache: 'no-store' })
  return handleResponse<AdminStats>(res)
}

export async function getRecentSignupsApi(): Promise<{ signups: RecentSignup[] }> {
  const res = await fetch('/api/admin/recent-signups', { cache: 'no-store' })
  return handleResponse<{ signups: RecentSignup[] }>(res)
}

// Studios
export async function getAdminStudiosApi(): Promise<{ studios: AdminStudio[] }> {
  const res = await fetch('/api/admin/studios', { cache: 'no-store' })
  return handleResponse<{ studios: AdminStudio[] }>(res)
}

export async function createAdminStudioApi(input: CreateStudioInput): Promise<{ workspace: any; metadataApplied: boolean }> {
  const res = await fetch('/api/admin/studios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return handleResponse<{ workspace: any; metadataApplied: boolean }>(res)
}

export async function transferStudioOwnerApi(studioId: string, input: TransferOwnerInput): Promise<{ success: boolean; membershipEnsured?: boolean }> {
  const res = await fetch(`/api/admin/studios/${encodeURIComponent(studioId)}/owner`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return handleResponse<{ success: boolean; membershipEnsured?: boolean }>(res)
}

export async function toggleStudioMembershipApi(studioId: string, currentlyMember: boolean): Promise<void> {
  const res = await fetch(`/api/admin/studios/${encodeURIComponent(studioId)}/membership`, {
    method: currentlyMember ? 'DELETE' : 'POST',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to update studio membership')
  }
}

// Instructors
export async function getAdminInstructorsApi(): Promise<{ instructors: AdminInstructor[]; failed?: boolean }> {
  const res = await fetch('/api/admin/instructors', { cache: 'no-store' })
  if (!res.ok) {
    return { instructors: [], failed: true }
  }
  const data = await res.json()
  return { instructors: Array.isArray(data.instructors) ? data.instructors : [], failed: Boolean(data.failed) }
}

export async function getInstructorDetailApi(userId: string): Promise<{
  instructor: InstructorDetail
  studios: InstructorStudio[]
  membershipResolved: boolean
  profileResolved: boolean
}> {
  const res = await fetch(`/api/admin/instructors/${encodeURIComponent(userId)}`, { cache: 'no-store' })
  return handleResponse<{
    instructor: InstructorDetail
    studios: InstructorStudio[]
    membershipResolved: boolean
    profileResolved: boolean
  }>(res)
}

// Users & Roles
export async function getAdminUsersApi(): Promise<{ users: AdminUser[] }> {
  const res = await fetch('/api/admin/users', { cache: 'no-store' })
  return handleResponse<{ users: AdminUser[] }>(res)
}

export async function updateUserRoleApi(input: UpdateUserRoleInput): Promise<void> {
  const res = await fetch('/api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to update user role')
  }
}

// Institutions & Domains
export async function createInstitutionApi(input: CreateOrgInput): Promise<{ institution: any }> {
  const res = await fetch('/api/institutions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return handleResponse<{ institution: any }>(res)
}

export async function updateInstitutionApi(slug: string, input: EditOrgInput): Promise<{ institution: any }> {
  const res = await fetch(`/api/admin/institutions/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return handleResponse<{ institution: any }>(res)
}

export async function deleteInstitutionApi(slug: string): Promise<void> {
  const res = await fetch(`/api/admin/institutions/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to delete institution')
  }
}

export async function getInstitutionStatsApi(slug: string): Promise<InstitutionStats> {
  const res = await fetch(`/api/admin/institutions/${encodeURIComponent(slug)}/stats`, { cache: 'no-store' })
  return handleResponse<InstitutionStats>(res)
}

export async function getOrgDomainsApi(slug: string): Promise<{ domains: OrgDomainItem[] }> {
  const res = await fetch(`/api/admin/institutions/${encodeURIComponent(slug)}/domains`, { cache: 'no-store' })
  return handleResponse<{ domains: OrgDomainItem[] }>(res)
}

export async function addOrgDomainApi(slug: string, domain: string): Promise<{ domain: OrgDomainItem }> {
  const res = await fetch(`/api/admin/institutions/${encodeURIComponent(slug)}/domains`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain }),
  })
  return handleResponse<{ domain: OrgDomainItem }>(res)
}

export async function removeOrgDomainApi(slug: string, domainStr: string): Promise<void> {
  const res = await fetch(`/api/admin/institutions/${encodeURIComponent(slug)}/domains/${encodeURIComponent(domainStr)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to remove domain')
  }
}
