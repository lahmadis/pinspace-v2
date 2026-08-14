import type { ReactNode } from 'react'
import { Building2, LayoutDashboard, Users } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'

const navigation = [
  { label: 'Overview', href: '/admin', exact: true, icon: <LayoutDashboard className="h-5 w-5" aria-hidden="true" /> },
  { label: 'Users and roles', href: '/admin/users', icon: <Users className="h-5 w-5" aria-hidden="true" /> },
  { label: 'Institutions', href: '/admin/institutions', icon: <Building2 className="h-5 w-5" aria-hidden="true" /> },
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
    <AppShell navigation={navigation} footerNavigation={footerNavigation} currentPath={currentPath} contentClassName="bg-background">
      <PageHeader eyebrow="Administration" title={title} description={description} actions={actions} />
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </AppShell>
  )
}
