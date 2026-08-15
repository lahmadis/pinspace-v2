'use client'

import { useEffect, useRef, useState } from 'react'
import {
  subscribeToToasts,
  subscribeToToastDismiss,
  toast,
  type ToastItem,
  type ToastPosition,
} from '@/lib/toast'
import { NetworkStatus } from '@/components/system/NetworkStatus'

const ICONS: Record<Exclude<ToastItem['type'], 'loading'>, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

const STYLES: Record<ToastItem['type'], string> = {
  success: 'border-[rgb(var(--color-success))]',
  error: 'border-[rgb(var(--color-danger))]',
  warning: 'border-[rgb(var(--color-warning))]',
  info: 'border-accent',
  loading: 'border-border',
}

const ICON_STYLES: Record<ToastItem['type'], string> = {
  success: 'text-[rgb(var(--color-success))]',
  error: 'text-[rgb(var(--color-danger))]',
  warning: 'text-[rgb(var(--color-warning))]',
  info: 'text-accent',
  loading: 'text-accent',
}

const CONTAINER_CLASSES: Record<ToastPosition, string> = {
  'top-right': 'fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none items-end',
  'bottom-center':
    'fixed left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none items-center',
}

const ENTER_ANIM: Record<ToastPosition, string> = {
  'top-right': 'animate-in fade-in slide-in-from-right-4 duration-300 motion-reduce:animate-none',
  'bottom-center': 'animate-in fade-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none',
}

export default function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [networkNoticeHeight, setNetworkNoticeHeight] = useState(0)
  const [politeAnnouncement, setPoliteAnnouncement] = useState({ message: '', sequence: 0 })
  // setTimeout handles keyed by toast id. We need to cancel them when:
  //   (a) an id-based update replaces an existing toast (e.g. loading → success)
  //   (b) toast.dismiss(id) is called explicitly
  // Without (a), the original short-duration timer would fire and remove the
  // newly-updated toast prematurely.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const timers = timersRef.current
    const scheduleDismiss = (item: ToastItem) => {
      const prior = timers.get(item.id)
      if (prior) clearTimeout(prior)
      // Infinity (loading) and 0 stay sticky. setTimeout with Infinity is
      // clamped by the HTML spec to ~1 ms — we MUST skip the call entirely,
      // not pass Infinity through.
      if (!Number.isFinite(item.duration) || item.duration <= 0) {
        timers.delete(item.id)
        return
      }
      const handle = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id))
        timers.delete(item.id)
      }, item.duration)
      timers.set(item.id, handle)
    }

    const unsubAdd = subscribeToToasts((item) => {
      setToasts((prev) => {
        const idx = prev.findIndex((t) => t.id === item.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = item
          return next
        }
        return [...prev, item]
      })
      if (item.type !== 'error' && item.type !== 'warning') {
        setPoliteAnnouncement((current) => ({
          message: item.message,
          sequence: current.sequence + 1,
        }))
      }
      scheduleDismiss(item)
    })

    const unsubDismiss = subscribeToToastDismiss((id) => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      const handle = timers.get(id)
      if (handle) {
        clearTimeout(handle)
        timers.delete(id)
      }
    })

    return () => {
      unsubAdd()
      unsubDismiss()
      timers.forEach((h) => clearTimeout(h))
      timers.clear()
    }
  }, [])

  const topRight = toasts.filter((t) => t.position === 'top-right')
  const bottomCenter = toasts.filter((t) => t.position === 'bottom-center')

  const renderToast = (t: ToastItem) => (
    <div
      key={t.id}
      role={t.type === 'error' || t.type === 'warning' ? 'alert' : 'status'}
      aria-label={t.message}
      aria-live={t.type === 'error' || t.type === 'warning' ? 'assertive' : 'off'}
      aria-atomic="true"
      className={`pointer-events-auto flex w-fit max-w-sm items-center gap-3 rounded-pinspace border bg-background-light py-2 pl-4 pr-1 text-sm font-medium text-text-primary shadow-[var(--shadow-raised)] ${ENTER_ANIM[t.position]} ${STYLES[t.type]}`}
    >
      {t.type === 'loading' ? (
        <span aria-hidden="true" className={`h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none ${ICON_STYLES[t.type]}`} />
      ) : (
        <span aria-hidden="true" className={`text-base font-bold leading-none ${ICON_STYLES[t.type]}`}>{ICONS[t.type]}</span>
      )}
      <span className="min-w-0 flex-1 break-words">{t.message}</span>
      <button
        type="button"
        aria-label={`Dismiss: ${t.message}`}
        onClick={() => toast.dismiss(t.id)}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-pinspace text-xl text-text-secondary hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )

  return (
    <>
      <div
        role="status"
        aria-label="Toast notifications"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        <span key={politeAnnouncement.sequence}>{politeAnnouncement.message}</span>
      </div>
      <NetworkStatus onNoticeHeightChange={setNetworkNoticeHeight} />
      {topRight.length > 0 && (
        <div className={CONTAINER_CLASSES['top-right']}>{topRight.map(renderToast)}</div>
      )}
      {bottomCenter.length > 0 && (
        <div
          className={CONTAINER_CLASSES['bottom-center']}
          style={{
            bottom: `calc(max(1.5rem, env(safe-area-inset-bottom)) + ${networkNoticeHeight}px + ${networkNoticeHeight > 0 ? '0.75rem' : '0px'})`,
          }}
        >
          {bottomCenter.map(renderToast)}
        </div>
      )}
    </>
  )
}
