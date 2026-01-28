'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '@/lib/supabase/client'

export default function SignUpPage() {
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
            redirectTo="http://localhost:3000"
            view="sign_up"
          />
        </div>
      </div>
    </div>
  )
}

