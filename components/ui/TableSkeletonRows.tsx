'use client'

import { TableRow, TableCell } from './DataTable'
import { Skeleton } from './Skeleton'

export interface TableSkeletonRowsProps {
  rows?: number
  cols?: number
  colWidths?: string[]
}

export function TableSkeletonRows({
  rows = 5,
  cols = 5,
  colWidths = ['w-48', 'w-36', 'w-24', 'w-16', 'w-20'],
}: TableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rIndex) => (
        <TableRow key={rIndex} className="hover:bg-transparent">
          {Array.from({ length: cols }).map((_, cIndex) => (
            <TableCell key={cIndex}>
              <div className="flex items-center gap-2">
                {cIndex === 0 && <Skeleton variant="circular" className="w-7 h-7" />}
                <Skeleton className={colWidths[cIndex] || 'w-24'} />
              </div>
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

export default TableSkeletonRows
