'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isDemoMode } from '@/lib/demoMode'

interface DemoBannerProps {
  message?: string
  inline?: boolean
}

export default function DemoBanner({ message = 'Demo Mode — Sample data for demonstration', inline = false }: DemoBannerProps) {
  const [show, setShow] = useState(false)
  const router = useRouter()

  useEffect(() => {
    // Demo mode depends on client-only location state; defer to avoid hydration drift.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(isDemoMode() || window.location.pathname.startsWith('/demo'))
  }, [])

  if (!show) return null

  return (
    <div role="status" aria-live="polite" className={`${inline ? 'relative shrink-0' : 'fixed inset-x-0 top-0'} z-50 border-b-2 border-pinspace-ink bg-primary pt-[env(safe-area-inset-top)] text-pinspace-ink shadow-[var(--shadow-raised)]`}>
      <div className="mx-auto flex min-h-14 max-w-[96rem] items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-lg">🎭</span>
          <p className="break-words text-sm font-bold">{message}</p>
        </div>
        <button
          onClick={() => {
            setShow(false)
            if (window.location.pathname.startsWith('/demo')) {
              router.push('/')
              return
            }
            const url = new URL(window.location.href)
            url.searchParams.delete('demo')
            router.replace(`${url.pathname}${url.search}${url.hash}`)
          }}
          className="inline-flex min-h-11 shrink-0 items-center rounded-pinspace border border-pinspace-ink bg-background-light px-3 py-2 text-xs font-bold transition-colors hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
          aria-label="Exit demo mode"
        >
          Exit Demo
        </button>
      </div>
    </div>
  )
}
