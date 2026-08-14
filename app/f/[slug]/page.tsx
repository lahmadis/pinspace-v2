'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { StatusState } from '@/components/ui'

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
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <StatusState status="loading" title="Opening sign in" description="Connecting you to the requested organization." className="w-full max-w-md" />
    </main>
  )
}
