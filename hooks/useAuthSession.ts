'use client'

import { useEffect, useRef, useState } from 'react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface UseAuthSessionResult {
  status: AuthStatus
  user: User | null
  session: Session | null
}

// Grace window before treating an unresolved session as definitively absent.
// On hard refresh, the cookie-backed session restore can briefly resolve null
// while supabase-js is still parsing cookies; redirecting on that early null
// bounces authenticated users to /sign-in. INITIAL_SESSION normally arrives
// well under this budget; the timer is the backstop.
const RESTORE_GRACE_MS = 1500

export function useAuthSession(): UseAuthSessionResult {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let graceTimer: ReturnType<typeof setTimeout> | null = null

    const settle = (next: AuthStatus, nextSession: Session | null) => {
      if (cancelled) return
      settledRef.current = true
      setSession(nextSession)
      setStatus(next)
      if (graceTimer) {
        clearTimeout(graceTimer)
        graceTimer = null
      }
    }

    supabase.auth.getSession().then(
      ({ data: { session: s } }: { data: { session: Session | null } }) => {
        if (cancelled) return
        if (s) {
          settle('authenticated', s)
        }
        // null here is non-definitive on hard refresh — wait for INITIAL_SESSION
        // or the grace timer.
      }
    )

    graceTimer = setTimeout(() => {
      if (cancelled || settledRef.current) return
      settle('unauthenticated', null)
    }, RESTORE_GRACE_MS)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, s: Session | null) => {
        if (cancelled) return
        if (s) {
          settle('authenticated', s)
          return
        }
        // Definitive no-session signals: INITIAL_SESSION (post-restore null)
        // and any null event after we've already settled (sign-out, expiry).
        if (event === 'INITIAL_SESSION' || settledRef.current) {
          settle('unauthenticated', null)
        }
      }
    )

    return () => {
      cancelled = true
      if (graceTimer) clearTimeout(graceTimer)
      subscription.unsubscribe()
    }
  }, [])

  return { status, user: session?.user ?? null, session }
}
