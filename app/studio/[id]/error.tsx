'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui'
import { PublicStatusScreen } from '@/components/public/PublicStudioShell'

export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('Studio error:', error)
  }, [error])

  return (
    <PublicStatusScreen
      status="error"
      title="Studio failed to load"
      description="The 3D studio is unavailable. Your browser may not support WebGL, or the room data may be temporarily unavailable."
      action={(
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="button" onClick={reset}>Try again</Button>
          <Button type="button" variant="ghost" onClick={() => router.push('/dashboard')}>
            Back to dashboard
          </Button>
        </div>
      )}
    />
  )
}
