'use client'

import { Card } from './Primitives'
import { Skeleton } from './Skeleton'

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={`p-5 space-y-3 ${className || ''}`}>
      <div className="flex items-center justify-between">
        <Skeleton variant="text" className="w-24 h-3" />
        <Skeleton variant="circular" className="w-8 h-8" />
      </div>
      <Skeleton variant="text" className="w-16 h-7" />
      <Skeleton variant="text" className="w-32 h-3" />
    </Card>
  )
}

export function MetricsSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

export default CardSkeleton
