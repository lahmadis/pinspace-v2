'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuthSession } from '@/hooks/useAuthSession'

export type AccountRole = 'student' | 'instructor'

interface ProfileData {
  avatarUrl: string | null
  fullName: string | null
  // Permission role (NOT the demographic `role`). null until the profile loads
  // or when signed out; treat anything other than 'instructor' as unprivileged.
  accountRole: AccountRole | null
}

interface ProfileContextValue {
  profile: ProfileData
  setProfile: (patch: Partial<ProfileData>) => void
}

const DEFAULT_PROFILE: ProfileData = { avatarUrl: null, fullName: null, accountRole: null }

const ProfileContext = createContext<ProfileContextValue>({
  profile: DEFAULT_PROFILE,
  setProfile: () => {},
})

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = useState<ProfileData>(DEFAULT_PROFILE)
  const { status, user } = useAuthSession()

  const setProfile = useCallback((patch: Partial<ProfileData>) => {
    setProfileState((prev) => ({ ...prev, ...patch }))
  }, [])

  // Single client-side source of truth for the current user's account_role
  // (plus a baseline avatar/name). Refetches when the signed-in user changes
  // and clears on sign-out, so a fresh student session never inherits a prior
  // instructor's role from stale state. UI components read this via useProfile;
  // they must not prop-drill the role.
  useEffect(() => {
    if (status === 'unauthenticated') {
      setProfileState((prev) => ({ ...prev, accountRole: null }))
      return
    }
    if (status !== 'authenticated' || !user?.id) return

    let cancelled = false
    fetch('/api/user-profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setProfileState((prev) => ({
          avatarUrl: data.avatar_url ?? prev.avatarUrl,
          fullName: typeof data.full_name === 'string' ? data.full_name : prev.fullName,
          accountRole: data.account_role === 'instructor' ? 'instructor' : 'student',
        }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [status, user?.id])

  return (
    <ProfileContext.Provider value={{ profile, setProfile }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext)
}
