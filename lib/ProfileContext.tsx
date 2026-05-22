'use client'

import { createContext, useCallback, useContext, useState } from 'react'

interface ProfileData {
  avatarUrl: string | null
  fullName: string | null
}

interface ProfileContextValue {
  profile: ProfileData
  setProfile: (patch: Partial<ProfileData>) => void
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: { avatarUrl: null, fullName: null },
  setProfile: () => {},
})

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = useState<ProfileData>({ avatarUrl: null, fullName: null })

  const setProfile = useCallback((patch: Partial<ProfileData>) => {
    setProfileState((prev) => ({ ...prev, ...patch }))
  }, [])

  return (
    <ProfileContext.Provider value={{ profile, setProfile }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext)
}
