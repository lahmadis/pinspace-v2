'use client'

import {
  createContext,
  forwardRef,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type MutableRefObject,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { cn } from './utils'

type MenuContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: MutableRefObject<HTMLButtonElement | null>
  contentRef: MutableRefObject<HTMLDivElement | null>
  contentId: string
  focusEdge: MutableRefObject<'first' | 'last'>
  setTrigger: (node: HTMLButtonElement | null) => void
  setContent: (node: HTMLDivElement | null) => void
  openAt: (edge: 'first' | 'last') => void
}

const MenuContext = createContext<MenuContextValue | null>(null)

function useMenu() {
  const context = useContext(MenuContext)
  if (!context) throw new Error('Menu components must be used inside <Menu>')
  return context
}

export function Menu({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const focusEdge = useRef<'first' | 'last'>('first')
  const contentId = useId()
  const setTrigger = (node: HTMLButtonElement | null) => { triggerRef.current = node }
  const setContent = (node: HTMLDivElement | null) => { contentRef.current = node }
  const openAt = (edge: 'first' | 'last') => {
    focusEdge.current = edge
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!contentRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const hasPosition = className?.includes('absolute') || className?.includes('fixed') || className?.includes('sticky')

  return (
    <MenuContext.Provider value={{ open, setOpen, triggerRef, contentRef, contentId, focusEdge, setTrigger, setContent, openAt }}>
      <div className={cn(!hasPosition && 'relative', 'inline-block', className)} {...props}>{children}</div>
    </MenuContext.Provider>
  )
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

export const MenuTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function MenuTrigger({ onClick, onKeyDown, className, type = 'button', ...props }, forwardedRef) {
    const menu = useMenu()
    return (
      <button
        {...props}
        ref={(node) => {
          menu.setTrigger(node)
          assignRef(forwardedRef, node)
        }}
        type={type}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.contentId : undefined}
        className={cn(
          'min-h-11 rounded-pinspace border border-border bg-background-light px-3 py-2 font-semibold hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          className
        )}
        onClick={(event) => {
          menu.setOpen(!menu.open)
          onClick?.(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            menu.openAt(event.key === 'ArrowDown' ? 'first' : 'last')
          }
          onKeyDown?.(event)
        }}
      />
    )
  }
)

function getItems(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'))
}

export const MenuContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function MenuContent({ className, onKeyDown, ...props }, forwardedRef) {
    const menu = useMenu()
    useEffect(() => {
      if (!menu.open || !menu.contentRef.current) return
      const items = getItems(menu.contentRef.current)
      const target = menu.focusEdge.current === 'last' ? items.at(-1) : items[0]
      target?.focus()
    }, [menu.open, menu.contentRef, menu.focusEdge])
    if (!menu.open) return null

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      const items = getItems(event.currentTarget)
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault()
        menu.setOpen(false)
        menu.triggerRef.current?.focus()
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && items.length) {
        event.preventDefault()
        let next = current
        if (event.key === 'ArrowDown') next = (current + 1) % items.length
        if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = items.length - 1
        items[next]?.focus()
      }
      onKeyDown?.(event)
    }

    return (
      <div
        {...props}
        ref={(node) => {
          menu.setContent(node)
          assignRef(forwardedRef, node)
        }}
        id={menu.contentId}
        role="menu"
        className={cn(
          'absolute right-0 z-50 mt-2 min-w-44 rounded-pinspace border border-border bg-background-light p-1.5 shadow-[var(--shadow-raised)]',
          className
        )}
        onKeyDown={handleKeyDown}
      />
    )
  }
)

type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { className, onClick, onSelect, type = 'button', ...props },
  ref
) {
  const menu = useMenu()
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      role="menuitem"
      tabIndex={-1}
      className={cn(
        'flex min-h-10 w-full items-center rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-text-primary hover:bg-background-lighter focus:bg-primary-muted focus:outline-none disabled:opacity-50',
        className
      )}
      onClick={(event) => {
        onSelect?.()
        onClick?.(event)
        if (!event.defaultPrevented) {
          menu.setOpen(false)
          menu.triggerRef.current?.focus()
        }
      }}
    />
  )
})
