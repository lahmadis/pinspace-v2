'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function StudioViewError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('Studio view error:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#B3B3FF]">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Studio failed to load</h2>
        <p className="text-gray-600 mb-6 text-sm">
          Something went wrong loading the 3D studio. This can happen if your browser
          doesn&apos;t support WebGL, or if the room data is unavailable.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            Try again
          </button>
          <button
            onClick={() => router.back()}
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  )
}
