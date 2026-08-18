import type { ReactNode } from 'react'
import { Building2, GraduationCap, LayoutDashboard, UserCheck, UserPlus, Users } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { AdminUserControls } from './AdminUserControls'

const navigation = [
  { label: 'Overview', href: '/admin', exact: true, icon: <LayoutDashboard className="h-5 w-5" aria-hidden="true" /> },
  { label: 'Studios', href: '/admin/studios', icon: <GraduationCap className="h-5 w-5" aria-hidden="true" /> },
  { label: 'Instructors', href: '/admin/instructors', icon: <UserCheck className="h-5 w-5" aria-hidden="true" /> },
  { label: 'Users & roles', href: '/admin/users', icon: <Users className="h-5 w-5" aria-hidden="true" /> },
  { label: 'Institutions', href: '/admin/institutions', icon: <Building2 className="h-5 w-5" aria-hidden="true" /> },
  { label: 'Recent signups', href: '/admin/signups', icon: <UserPlus className="h-5 w-5" aria-hidden="true" /> },
]

const footerNavigation = [{ label: 'Back to dashboard', href: '/dashboard' }]

export function AdminShell({ currentPath, title, description, actions, children }: {
  currentPath: string
  title: ReactNode
  description: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <AppShell
      navigation={navigation}
      footerNavigation={footerNavigation}
      userControls={<AdminUserControls />}
      currentPath={currentPath}
      contentClassName="bg-background"
    >
      <PageHeader eyebrow="Administration" title={title} description={description} actions={actions} />
      <div className="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </AppShell>
  )
}
