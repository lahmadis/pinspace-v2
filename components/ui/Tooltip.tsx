'use client'

import {
  cloneElement,
  type ReactElement,
  useEffect,
  useId,
  useState,
} from 'react'

import { cn } from './utils'

type TooltipChildProps = {
  'aria-describedby'?: string
}

type TooltipProps = {
  content: string
  children: ReactElement<TooltipChildProps>
  className?: string
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const [closeTimer, setCloseTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()
  const show = () => {
    if (closeTimer) clearTimeout(closeTimer)
    setCloseTimer(null)
    setOpen(true)
  }
  const scheduleHide = () => {
    setCloseTimer(setTimeout(() => {
      setOpen(false)
      setCloseTimer(null)
    }, 80))
  }
  useEffect(() => {
    if (!open) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (closeTimer) clearTimeout(closeTimer)
        setCloseTimer(null)
        setOpen(false)
      }
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [closeTimer, open])
  useEffect(() => () => {
    if (closeTimer) clearTimeout(closeTimer)
  }, [closeTimer])
  const describedBy = [children.props['aria-describedby'], open ? id : null].filter(Boolean).join(' ') || undefined
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocusCapture={show}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      {cloneElement(children, {
        'aria-describedby': describedBy,
      })}
      {open && (
        <span
          role="tooltip"
          id={id}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
          className={cn(
            'absolute bottom-full left-1/2 z-[110] mb-2 w-max max-w-64 -translate-x-1/2 rounded-[var(--radius-sm)] bg-kova-forest px-2.5 py-1.5 text-xs font-medium text-white shadow-[var(--shadow-soft)]',
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  )
}
