'use client'

import {
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { cn } from './utils'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

type OverlayStackEntry = {
  id: symbol
  restoreTargets: HTMLElement[]
}

const overlayStack: OverlayStackEntry[] = []
let scrollLockCount = 0
let savedBodyOverflow = ''

function isTopmostOverlay(id: symbol) {
  return overlayStack.at(-1)?.id === id
}

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) document.body.style.overflow = savedBodyOverflow
}

function useModalFocus(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  panelRef: RefObject<HTMLDivElement | null>,
  overlayId: symbol,
  initialFocusRef?: RefObject<HTMLElement | null>
) {
  const onOpenChangeRef = useRef(onOpenChange)

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  useEffect(() => {
    if (!open) return
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const inheritedTargets = overlayStack.at(-1)?.restoreTargets ?? []
    const restoreTargets = activeElement
      ? [activeElement, ...inheritedTargets.filter((target) => target !== activeElement)]
      : [...inheritedTargets]
    overlayStack.push({ id: overlayId, restoreTargets })
    lockBodyScroll()
    const panel = panelRef.current
    const firstFocusable = panel?.querySelector<HTMLElement>(focusableSelector)
    ;(initialFocusRef?.current ?? firstFocusable ?? panel)?.focus()

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isTopmostOverlay(overlayId)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChangeRef.current(false)
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
      if (items.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const wasTopmost = isTopmostOverlay(overlayId)
      const stackIndex = overlayStack.findLastIndex((entry) => entry.id === overlayId)
      const [removedEntry] = stackIndex >= 0 ? overlayStack.splice(stackIndex, 1) : []
      unlockBodyScroll()
      if (wasTopmost) removedEntry?.restoreTargets.find((target) => target.isConnected)?.focus()
    }
  }, [initialFocusRef, open, overlayId, panelRef])
}

type OverlayProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  closeOnOutsideClick?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  hideCloseButton?: boolean
}

function Overlay({
  kind,
  side,
  open,
  onOpenChange,
  title,
  description,
  children,
  closeOnOutsideClick = true,
  initialFocusRef,
  hideCloseButton = false,
  className,
  ...props
}: OverlayProps & { kind: 'dialog' | 'sheet'; side?: 'left' | 'right' }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [overlayId] = useState(() => Symbol(kind))
  const titleId = useId()
  const descriptionId = useId()
  useModalFocus(open, onOpenChange, panelRef, overlayId, initialFocusRef)
  if (!open) return null

  const dismissOutside = (event: MouseEvent<HTMLDivElement>) => {
    if (
      closeOnOutsideClick &&
      isTopmostOverlay(overlayId) &&
      event.target === event.currentTarget
    ) onOpenChange(false)
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex bg-pinspace-forest/55 p-4 backdrop-blur-[2px]',
        kind === 'dialog' && 'items-center justify-center',
        kind === 'sheet' && (side === 'left' ? 'justify-start' : 'justify-end')
      )}
      onMouseDown={dismissOutside}
      data-testid={`${kind}-backdrop`}
    >
      <div
        {...props}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-side={kind === 'sheet' ? side : undefined}
        className={cn(
          'relative border border-border bg-background-light text-text-primary shadow-[var(--shadow-raised)]',
          kind === 'dialog' && 'max-h-[min(90vh,48rem)] w-full max-w-lg overflow-y-auto rounded-pinspace-lg p-6',
          kind === 'sheet' && 'h-full w-full max-w-md overflow-y-auto rounded-pinspace-lg p-6',
          className
        )}
      >
        <h2 id={titleId} className="pr-10 text-xl font-bold">{title}</h2>
        {description && <div id={descriptionId} className="mt-1 text-sm text-text-secondary">{description}</div>}
        <div className="mt-5">{children}</div>
        {!hideCloseButton && (
          <button
            type="button"
            aria-label={`Close ${kind}`}
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-xl text-text-secondary hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
    </div>
  )
}

export function Dialog(props: OverlayProps) {
  return <Overlay kind="dialog" {...props} />
}

export function Sheet({ side = 'right', ...props }: OverlayProps & { side?: 'left' | 'right' }) {
  return <Overlay kind="sheet" side={side} {...props} />
}
