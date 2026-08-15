'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { Session } from '@supabase/supabase-js'
import { StatusState } from '@/components/ui'

/**
 * Institution handoff: /i/wit → /?institution=wit (home landing page)
 * Give each school a clean link, e.g. pinspace.app/i/wit
 * Client redirect avoids Next.js PathnameContext/useContext errors on server redirect.
 */
export default function InstitutionHandoffPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params?.slug as string | undefined

  useEffect(() => {
    if (!slug) {
      router.replace('/')
      return
    }
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (session) {
        router.replace(`/?institution=${encodeURIComponent(slug)}`)
      } else {
        router.replace(`/sign-in?institution=${encodeURIComponent(slug)}`)
      }
    }).catch(() => {
      router.replace(`/sign-in?institution=${encodeURIComponent(slug)}`)
    })
  }, [slug, router])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <StatusState status="loading" title="Opening your institution" description="Checking your session before continuing." className="w-full max-w-md" />
    </main>
  )
}
