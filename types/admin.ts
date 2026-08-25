// Canonical Domain Types for PinSpace Admin Control Plane

export type AccountRole = 'student' | 'instructor'
export type UserRole = 'faculty' | 'student' | 'professional'
export type SignupStatus = 'active' | 'no_profile' | 'unverified'

export interface WorkspaceRow {
  id: string
  name: string
  type?: string
  created_at?: string
}

export interface AdminStudio {
  id: string
  name: string
  type: string
  ownerId: string
  ownerName: string | null
  department: string | null
  academicYear: string | null
  instructorLabel: string | null
  createdAt: string
  provisionedByAdmin: boolean
  isArchived: boolean
  adminIsMember: boolean
}

export interface AdminInstructor {
  userId: string
  fullName: string | null
  email: string | null
  organization: string | null
  accountRole: AccountRole
  classCount: number
  hasProfile: boolean
}

export interface InstructorDetail extends AdminInstructor {}

export interface InstructorStudio {
  id: string
  name: string
  type: string
  department: string | null
  yearLevel: string | null
  academicYear: string | null
  memberCount: number
  createdAt: string
  provisionedByAdmin: boolean
  isArchived: boolean
  adminIsMember: boolean
}

export interface RecentSignup {
  userId: string
  email: string | null
  fullName: string | null
  organization: string | null
  createdAt: string
  lastSignInAt: string | null
  status: SignupStatus
}

export interface InstitutionWithCount {
  id: string
  name: string
  slug: string
  network_label?: string | null
  type?: 'university' | 'firm' | null
  workspace_count: number
  user_count: number
  workspaces: WorkspaceRow[]
  domains: string[]
}

export interface AdminUser {
  userId: string
  email: string | null
  fullName: string | null
  organization: string | null
  role: string | null // demographic
  accountRole: AccountRole
}

export interface AdminStats {
  total: number
  by_year: Record<string, number>
  by_major: Record<string, number>
  by_age_range: Record<string, number>
  by_how_heard: Record<string, number>
}

export interface InstitutionStats {
  institution: {
    id: string
    name: string
    slug: string
    network_label?: string
    allowed_email_domains?: string
  }
  summary: {
    total_users: number
    faculty_count: number
    student_count: number
    professional_count?: number
    studio_count: number
    board_count: number
  }
  users: Array<{
    id: string
    email: string
    full_name: string
    role: UserRole
    major?: string
    year?: string
    age_range?: string
    created_at?: string
  }>
  studios: Array<{
    id: string
    name: string
    owner_id: string
    type?: string
    created_at?: string
  }>
}

export interface OrgDomainItem {
  id: string
  domain: string
}
