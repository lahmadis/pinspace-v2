import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/components/ui/utils'

export interface StudioShellProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  children: ReactNode
  controls?: ReactNode
  label?: string
}

export function StudioShell({
  children,
  controls,
  label = 'Studio',
  className,
  ...props
}: StudioShellProps) {
  return (
    <main
      aria-label={label}
      className={cn(
        'relative isolate min-h-dvh w-full max-w-full overflow-hidden bg-primary-dark text-background-light',
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 min-h-0 min-w-0">{children}</div>
      {controls && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end p-3 sm:p-4">
          <div
            role="group"
            aria-label="Studio controls"
            className="pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-2 rounded-pinspace border border-background-light/25 bg-primary-dark/75 p-2 shadow-[var(--shadow-raised)] backdrop-blur-md"
          >
            {controls}
          </div>
        </div>
      )}
    </main>
  )
}
