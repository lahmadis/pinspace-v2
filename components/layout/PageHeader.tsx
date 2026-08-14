import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/components/ui/utils'

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 border-b border-border bg-background-light px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8',
        className
      )}
      {...props}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
            {eyebrow}
          </div>
        )}
        <h1 className="break-words text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">{title}</h1>
        {description && <div className="mt-2 max-w-3xl text-sm text-text-secondary sm:text-base">{description}</div>}
      </div>
      {actions && (
        <div role="group" aria-label="Page actions" className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  )
}
