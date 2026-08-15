'use client'

import {
  createContext,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useId,
  useState,
} from 'react'

import { cn } from './utils'

type TabsContextValue = {
  value: string
  setValue: (value: string) => void
  baseId: string
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabs() {
  const context = useContext(TabsContext)
  if (!context) throw new Error('Tabs components must be used inside <Tabs>')
  return context
}

type TabsProps = HTMLAttributes<HTMLDivElement> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

export function Tabs({ value, defaultValue, onValueChange, className, children, ...props }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? value ?? '')
  const baseId = useId()
  const currentValue = value ?? internalValue
  const setValue = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue)
    onValueChange?.(nextValue)
  }
  return (
    <TabsContext.Provider value={{ value: currentValue, setValue, baseId }}>
      <div className={className} {...props}>{children}</div>
    </TabsContext.Provider>
  )
}

export const TabList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function TabList(
  { className, onKeyDown, ...props },
  ref
) {
  const { setValue } = useTabs()
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'))
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0 || tabs.length === 0) return
    event.preventDefault()
    let next = current
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
    if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = tabs.length - 1
    tabs[next].focus()
    const value = tabs[next].dataset.value
    if (value) setValue(value)
  }
  return (
    <div
      ref={ref}
      role="tablist"
      className={cn('inline-flex gap-1 rounded-pinspace bg-background-lighter p-1', className)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
})

type TabProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> & { value: string }

export const Tab = forwardRef<HTMLButtonElement, TabProps>(function Tab(
  { value, className, onClick, ...props },
  ref
) {
  const tabs = useTabs()
  const selected = tabs.value === value
  const tabId = `${tabs.baseId}-tab-${value}`
  const panelId = `${tabs.baseId}-panel-${value}`
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={tabId}
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      data-value={value}
      className={cn(
        'min-h-9 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected && 'bg-background-light text-text-primary shadow-sm',
        className
      )}
      onClick={(event) => {
        tabs.setValue(value)
        onClick?.(event)
      }}
      {...props}
    />
  )
})

type TabPanelProps = HTMLAttributes<HTMLDivElement> & { value: string; children: ReactNode }

export const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
  { value, className, ...props },
  ref
) {
  const tabs = useTabs()
  if (tabs.value !== value) return null
  return (
    <div
      ref={ref}
      role="tabpanel"
      id={`${tabs.baseId}-panel-${value}`}
      aria-labelledby={`${tabs.baseId}-tab-${value}`}
      tabIndex={0}
      className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', className)}
      {...props}
    />
  )
})
