'use client'

import { useEffect, useRef, useState } from 'react'
import {
  subscribeToToasts,
  subscribeToToastDismiss,
  type ToastItem,
  type ToastPosition,
} from '@/lib/toast'

const ICONS: Record<Exclude<ToastItem['type'], 'loading'>, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

const STYLES: Record<ToastItem['type'], string> = {
  success: 'bg-emerald-600 border-emerald-500',
  error: 'bg-[#C2452D] border-[#a5391f]',
  warning: 'bg-amber-500 border-amber-400',
  info: 'bg-[#3B6EF6] border-[#2f5cd6]',
  loading: 'bg-[#16181D] border-[#16181D]',
}

const CONTAINER_CLASSES: Record<ToastPosition, string> = {
  'top-right': 'fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none items-end',
  'bottom-center':
    'fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none items-center',
}

const ENTER_ANIM: Record<ToastPosition, string> = {
  'top-right': 'animate-in fade-in slide-in-from-right-4 duration-300',
  'bottom-center': 'animate-in fade-in slide-in-from-bottom-4 duration-300',
}

export default function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // setTimeout handles keyed by toast id. We need to cancel them when:
  //   (a) an id-based update replaces an existing toast (e.g. loading → success)
  //   (b) toast.dismiss(id) is called explicitly
  // Without (a), the original short-duration timer would fire and remove the
  // newly-updated toast prematurely.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const scheduleDismiss = (item: ToastItem) => {
      const prior = timersRef.current.get(item.id)
      if (prior) clearTimeout(prior)
      // Infinity (loading) and 0 stay sticky. setTimeout with Infinity is
      // clamped by the HTML spec to ~1 ms — we MUST skip the call entirely,
      // not pass Infinity through.
      if (!Number.isFinite(item.duration) || item.duration <= 0) {
        timersRef.current.delete(item.id)
        return
      }
      const handle = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id))
        timersRef.current.delete(item.id)
      }, item.duration)
      timersRef.current.set(item.id, handle)
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
      scheduleDismiss(item)
    })

    const unsubDismiss = subscribeToToastDismiss((id) => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      const handle = timersRef.current.get(id)
      if (handle) {
        clearTimeout(handle)
        timersRef.current.delete(id)
      }
    })

    return () => {
      unsubAdd()
      unsubDismiss()
      timersRef.current.forEach((h) => clearTimeout(h))
      timersRef.current.clear()
    }
  }, [])

  if (toasts.length === 0) return null

  const topRight = toasts.filter((t) => t.position === 'top-right')
  const bottomCenter = toasts.filter((t) => t.position === 'bottom-center')

  const renderToast = (t: ToastItem) => (
    <div
      key={t.id}
      className={`flex items-center gap-3 px-4 py-3 rounded-full border text-white text-sm font-semibold shadow-xl pointer-events-auto max-w-sm ${ENTER_ANIM[t.position]} ${STYLES[t.type]}`}
    >
      {t.type === 'loading' ? (
        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <span className="text-base leading-none font-bold">{ICONS[t.type]}</span>
      )}
      <span>{t.message}</span>
    </div>
  )

  return (
    <>
      {topRight.length > 0 && (
        <div className={CONTAINER_CLASSES['top-right']}>{topRight.map(renderToast)}</div>
      )}
      {bottomCenter.length > 0 && (
        <div className={CONTAINER_CLASSES['bottom-center']}>{bottomCenter.map(renderToast)}</div>
      )}
    </>
  )
}
