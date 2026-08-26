'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Primitives'

export interface TablePaginationProps {
  currentPage: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  pageSizeOptions?: number[]
}

export function TablePagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const fromIndex = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const toIndex = Math.min(currentPage * pageSize, totalItems)

  const canPrev = currentPage > 1
  const canNext = currentPage < totalPages

  return (
    <div className="px-6 py-3.5 border-t border-border/60 bg-background-light/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-text-secondary">
      {/* Range summary */}
      <p className="tabular-nums">
        Showing <span className="font-semibold text-text-primary">{fromIndex}</span> to{' '}
        <span className="font-semibold text-text-primary">{toIndex}</span> of{' '}
        <span className="font-semibold text-text-primary">{totalItems}</span> entries
      </p>

      {/* Controls group */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Page size dropdown */}
        <div className="flex items-center gap-1.5">
          <span className="text-text-dim">Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value))
              onPageChange(1)
            }}
            className="h-8 rounded-lg border border-border bg-background-lighter px-2.5 py-0 text-xs font-medium text-text-primary focus:border-accent focus:outline-none transition-colors"
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        {/* Page indicator & prev/next buttons */}
        <div className="flex items-center gap-2">
          <span className="text-text-dim tabular-nums">
            Page <span className="font-semibold text-text-primary">{currentPage}</span> of{' '}
            <span className="font-semibold text-text-primary">{totalPages}</span>
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => onPageChange(currentPage - 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background-lighter text-text-secondary transition-colors hover:border-accent hover:bg-primary-muted hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => onPageChange(currentPage + 1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background-lighter text-text-secondary transition-colors hover:border-accent hover:bg-primary-muted hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TablePagination
