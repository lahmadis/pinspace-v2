'use client'

import { useState, useEffect } from 'react'
import { subscribeToToasts, type ToastItem } from '@/lib/toast'

const ICONS: Record<ToastItem['type'], string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

const STYLES: Record<ToastItem['type'], string> = {
  success: 'bg-emerald-600 border-emerald-500',
  error: 'bg-red-600 border-red-500',
  warning: 'bg-amber-500 border-amber-400',
  info: 'bg-blue-600 border-blue-500',
}

export default function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    return subscribeToToasts((item) => {
      setToasts((prev) => [...prev, item])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id))
      }, item.duration)
    })
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-white text-sm font-medium shadow-xl pointer-events-auto max-w-sm animate-in fade-in slide-in-from-right-4 duration-300 ${STYLES[t.type]}`}
        >
          <span className="text-base leading-none font-bold">{ICONS[t.type]}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
