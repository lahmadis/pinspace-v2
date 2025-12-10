'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '@/lib/supabase/client'

export default function SignInPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const hasRedirected = useRef(false)

  useEffect(() => {
    setMounted(true)
    
    // Only listen for NEW sign-in events, ignore initial session detection
    let isInitialMount = true
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Skip the first event (it's just detecting existing session on mount)
      if (isInitialMount) {
        isInitialMount = false
        console.log('Skipping initial auth state change')
        return
      }
      
      // Only redirect on actual SIGNED_IN event after mount
      if (event === 'SIGNED_IN' && session?.user && !hasRedirected.current) {
        console.log('User signed in, redirecting to home')
        hasRedirected.current = true
        router.replace('/')
      }
    })
    
    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-gray-200">
        <Auth
          supabaseClient={supabase}
          appearance={{ theme: ThemeSupa }}
          redirectTo="http://localhost:3000"
        />
      </div>
    </div>
  )
}