'use client'

import { useEffect, useRef, useState } from 'react'

export function NetworkStatus({
  onNoticeHeightChange,
}: {
  onNoticeHeightChange?: (height: number) => void
} = {}) {
  const [online, setOnline] = useState(true)
  const [showRestored, setShowRestored] = useState(false)
  const hasBeenOffline = useRef(false)
  const noticeRef = useRef<HTMLDivElement>(null)
  const restoredTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clearRestoredTimer = () => {
      if (restoredTimer.current) clearTimeout(restoredTimer.current)
      restoredTimer.current = null
    }
    const markOffline = () => {
      clearRestoredTimer()
      hasBeenOffline.current = true
      setShowRestored(false)
      setOnline(false)
    }
    const markOnline = () => {
      setOnline(true)
      if (!hasBeenOffline.current) return
      setShowRestored(true)
      clearRestoredTimer()
      restoredTimer.current = setTimeout(() => {
        setShowRestored(false)
        restoredTimer.current = null
      }, 4000)
    }

    if (!window.navigator.onLine) markOffline()
    window.addEventListener('offline', markOffline)
    window.addEventListener('online', markOnline)
    return () => {
      window.removeEventListener('offline', markOffline)
      window.removeEventListener('online', markOnline)
      clearRestoredTimer()
    }
  }, [])

  const announcement = online
    ? (showRestored ? 'Back online' : '')
    : "You're offline. Some updates may not save until your connection returns. We'll reconnect automatically."

  useEffect(() => {
    const notice = noticeRef.current
    if (!notice) {
      onNoticeHeightChange?.(0)
      return
    }

    const reportHeight = () => {
      onNoticeHeightChange?.(Math.ceil(notice.getBoundingClientRect().height))
    }
    reportHeight()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', reportHeight)
      return () => window.removeEventListener('resize', reportHeight)
    }

    const observer = new ResizeObserver(reportHeight)
    observer.observe(notice)
    return () => observer.disconnect()
  }, [announcement, onNoticeHeightChange])

  return (
    <>
      <div
        role="status"
        aria-label="Network status updates"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>
      {announcement && (
        <div
          ref={noticeRef}
          aria-hidden="true"
          data-network-notice
          className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-[90] w-[min(30rem,calc(100vw-7rem))] rounded-pinspace border border-border bg-background-light p-3 text-sm text-text-primary shadow-[var(--shadow-raised)] sm:w-[min(24rem,calc(100vw-16rem))]"
        >
          <p className="font-semibold">{online ? 'Back online' : "You're offline"}</p>
          {!online && (
            <p className="mt-0.5 text-text-secondary">
              Some updates may not save until your connection returns. We&apos;ll reconnect automatically.
            </p>
          )}
        </div>
      )}
    </>
  )
}
