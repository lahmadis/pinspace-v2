import {
  forwardRef,
  type HTMLAttributes,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react'

import { Button, Spinner } from './Primitives'
import { cn } from './utils'

type DataTableProps = TableHTMLAttributes<HTMLTableElement> & {
  label: string
  containerClassName?: string
}

export const DataTable = forwardRef<HTMLTableElement, DataTableProps>(function DataTable(
  { label, containerClassName, className, ...props },
  ref,
) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
        containerClassName,
      )}
    >
      <table ref={ref} aria-label={label} className={cn('w-full text-sm', className)} {...props} />
    </div>
  )
})

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-border', className)} {...props} />
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-primary-muted', className)} {...props} />
}

type Align = 'left' | 'center' | 'right'

const alignClasses: Record<Align, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

type TableHeadProps = ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }

export function TableHead({ align = 'left', className, ...props }: TableHeadProps) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap bg-background px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-dim',
        alignClasses[align],
        className,
      )}
      {...props}
    />
  )
}

type TableCellProps = TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }

export function TableCell({ align = 'left', className, ...props }: TableCellProps) {
  return (
    <td
      className={cn('px-4 py-3 text-text-primary', alignClasses[align], className)}
      {...props}
    />
  )
}

type TableStateRowProps = {
  colSpan: number
  status: 'loading' | 'empty' | 'error'
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export function TableStateRow({
  colSpan,
  status,
  title,
  description,
  actionLabel,
  onAction,
}: TableStateRowProps) {
  const role = status === 'error' ? 'alert' : 'status'
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center">
        <div role={role} className="mx-auto flex max-w-md flex-col items-center text-text-secondary">
          {status === 'loading' && <Spinner aria-hidden="true" className="mb-3 text-accent" />}
          <p className="font-semibold text-text-primary">{title}</p>
          {description && <p className="mt-1 text-sm">{description}</p>}
          {actionLabel && onAction && (
            <Button type="button" variant="ghost" className="mt-4" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}
