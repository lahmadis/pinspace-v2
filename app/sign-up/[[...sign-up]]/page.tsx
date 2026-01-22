'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

export default function SignUpPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [redirectTo, setRedirectTo] = useState<string | undefined>(undefined)
  const hasRedirected = useRef(false)

  useEffect(() => {
    setMounted(true)
    if (typeof window !== 'undefined') {
      setRedirectTo(window.location.origin || 'http://localhost:3000')
    }
    
    // Only listen for NEW sign-in events, ignore initial session detection
    let isInitialMount = true
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      // Skip the first event (it's just detecting existing session on mount)
      if (isInitialMount) {
        isInitialMount = false
        return
      }
      
      // Only redirect on actual SIGNED_IN event after mount
      if (event === 'SIGNED_IN' && session?.user && !hasRedirected.current) {
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

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50 p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-6">
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">Authentication not configured</h1>
            <p className="text-sm text-gray-600 mb-3">
              Add <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_SUPABASE_URL</code> and <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code>, then restart the dev server.
            </p>
            <p className="text-sm text-gray-600">
              Need help? See <code className="bg-gray-100 px-1 rounded">CLERK_SETUP_GUIDE.md</code> or your Supabase project settings.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Create Account
          </h1>
          <p className="text-gray-600">
            Start showcasing your architecture work
          </p>
        </div>
        
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <Auth
            supabaseClient={supabase}
            appearance={{ theme: ThemeSupa }}
            redirectTo={redirectTo}
            view="sign_up"
          />
        </div>
      </div>
    </div>
  )
}

