'use client'

import { cn } from './utils'

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular' | 'badge'
}

export function Skeleton({ className, variant = 'text', ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-background-lighter border border-border/40',
        variant === 'text' && 'h-4 w-full rounded-sm',
        variant === 'circular' && 'h-9 w-9 rounded-full shrink-0',
        variant === 'rectangular' && 'rounded-pinspace w-full h-12',
        variant === 'badge' && 'h-5 w-16 rounded-full',
        className
      )}
      {...props}
    />
  )
}

export default Skeleton
