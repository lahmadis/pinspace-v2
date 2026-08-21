'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CritViewError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('Crit view error:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#E7ECF5]">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Space failed to load</h2>
        <p className="text-gray-600 mb-6 text-sm">
          Something went wrong loading the 3D space. This can happen if your browser
          doesn&apos;t support WebGL, or if the room data is unavailable.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full px-4 py-2 bg-[#3B6EF6] text-white rounded-lg hover:bg-[#2F5CD6] transition-colors font-medium"
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
