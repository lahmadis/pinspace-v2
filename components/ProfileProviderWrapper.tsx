'use client'

import { ProfileProvider } from '@/lib/ProfileContext'

export function ProfileProviderWrapper({ children }: { children: React.ReactNode }) {
  return <ProfileProvider>{children}</ProfileProvider>
}
