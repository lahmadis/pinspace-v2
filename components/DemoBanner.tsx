'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { isDemoMode } from '@/lib/demoMode'

interface DemoBannerProps {
  message?: string
}

export default function DemoBanner({ message = '🎭 Demo Mode - Sample Data for Demonstration' }: DemoBannerProps) {
  const [show, setShow] = useState(false)
  const searchParams = useSearchParams()

  useEffect(() => {
    setShow(isDemoMode(searchParams))
  }, [searchParams])

  if (!show) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-400 border-b-2 border-yellow-500 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎭</span>
          <p className="text-sm font-semibold text-yellow-900">{message}</p>
        </div>
        <button
          onClick={() => {
            // Remove demo param and reload
            const url = new URL(window.location.href)
            url.searchParams.delete('demo')
            window.location.href = url.toString()
          }}
          className="text-xs px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-yellow-900 rounded-md font-medium transition-colors"
        >
          Exit Demo
        </button>
      </div>
    </div>
  )
}
