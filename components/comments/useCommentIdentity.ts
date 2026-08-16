'use client'

import { useEffect, useState } from 'react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase/client'

export function useCommentIdentity() {
  const [user, setUser] = useState<User | null>(null)
  const [profileFullName, setProfileFullName] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user?.id) {
      // The external auth session owns this cached profile value.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileFullName(null)
      return
    }

    let active = true
    fetch('/api/user-profile', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active) return
        const fullName = typeof data?.full_name === 'string' ? data.full_name.trim() : ''
        setProfileFullName(fullName || null)
      })
      .catch(() => {
        if (active) setProfileFullName(null)
      })
    return () => { active = false }
  }, [user?.id])

  return {
    user,
    authorName: profileFullName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Anonymous',
  }
}
