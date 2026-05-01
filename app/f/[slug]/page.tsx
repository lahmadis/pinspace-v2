'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

/**
 * Firm handoff: /f/acme → /sign-in?institution=acme
 * Mirrors /i/[slug] for institutions. Firms share the same email-first sign-in flow.
 */
export default function FirmHandoffPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params?.slug as string | undefined

  useEffect(() => {
    if (!slug) {
      router.replace('/')
      return
    }
    router.replace(`/sign-in?institution=${encodeURIComponent(slug)}`)
  }, [slug, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
    </div>
  )
}
