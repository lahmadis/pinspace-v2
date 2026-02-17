'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

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
    router.replace(`/?institution=${encodeURIComponent(slug)}`)
  }, [slug, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
    </div>
  )
}
