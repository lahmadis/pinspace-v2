'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Search, UserCheck } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Input,
  SegmentedControl,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableStateRow,
  TablePagination,
  buttonStyles,
} from '@/components/ui'
import type { AdminInstructor } from '@/types/admin'

function getInitials(name: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export interface InstructorsTableProps {
  instructors: AdminInstructor[]
  loading: boolean
  failed: boolean
}

type FilterTab = 'ALL' | 'OWNERS' | 'CANDIDATES'

export function InstructorsTable({ instructors, loading, failed }: InstructorsTableProps) {
  const [query, setQuery] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const handleQueryChange = (val: string) => {
    setQuery(val)
    setPage(1)
  }

  const handleFilterTabChange = (tab: FilterTab) => {
    setFilterTab(tab)
    setPage(1)
  }

  const q = query.trim().toLowerCase()
  const filtered = instructors.filter((i) => {
    const matchesQuery =
      q.length === 0 ||
      (i.fullName ?? '').toLowerCase().includes(q) ||
      (i.email ?? '').toLowerCase().includes(q) ||
      (i.organization ?? '').toLowerCase().includes(q)

    if (!matchesQuery) return false
    if (filterTab === 'OWNERS') return i.classCount > 0
    if (filterTab === 'CANDIDATES') return i.classCount === 0
    return true
  })

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="px-6 py-3.5 border-b border-border bg-background-light/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <UserCheck className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-bold text-text-primary">Instructors</h2>
          <span className="text-xs font-medium text-text-dim">({instructors.length} total)</span>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
          {/* Segmented Filter Tabs */}
          <SegmentedControl
            value={filterTab}
            onChange={(val) => handleFilterTabChange(val as 'ALL' | 'OWNERS' | 'CANDIDATES')}
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'OWNERS', label: 'Studio Owners' },
              { value: 'CANDIDATES', label: 'Candidates' },
            ]}
          />

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-dim absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              aria-label="Search instructors"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search instructors..."
              className="h-9 w-44 pl-8 text-xs rounded-lg bg-background-lighter border-border focus:border-accent"
            />
          </div>
        </div>
      </div>

      <DataTable label="Instructor accounts">
        <TableHeader>
          <TableRow>
            <TableHead>Instructor</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead align="right">Studios</TableHead>
            <TableHead align="right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableSkeletonRows rows={5} cols={5} colWidths={['w-48', 'w-36', 'w-24', 'w-16', 'w-20']} />
          ) : failed ? (
            <TableStateRow
              colSpan={5}
              status="error"
              title="Couldn’t load instructors."
              description="This is a failed request, not an empty list. Reload to try again."
            />
          ) : instructors.length === 0 ? (
            <TableStateRow colSpan={5} status="empty" title="No instructors yet." />
          ) : filtered.length === 0 ? (
            <TableStateRow colSpan={5} status="empty" title={`No instructor matches your filter criteria.`} />
          ) : (
            paginated.map((i) => (
              <TableRow key={i.userId}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-primary-muted text-accent font-semibold text-xs flex items-center justify-center border border-accent/30 shrink-0">
                      {getInitials(i.fullName)}
                    </div>
                    <div>
                      <p className="font-medium text-text-primary">{i.fullName || '—'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {i.accountRole !== 'instructor' && (
                          <Badge variant="warning">No instructor role</Badge>
                        )}
                        {!i.hasProfile && (
                          <span className="text-xs text-text-dim">Has not onboarded</span>
                        )}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-text-secondary">{i.email || '—'}</TableCell>
                <TableCell className="text-text-secondary">
                  {i.organization ? (
                    <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-background-lighter text-text-secondary border border-border">
                      {i.organization}
                    </span>
                  ) : (
                    <span className="text-text-dim">—</span>
                  )}
                </TableCell>
                <TableCell align="right" className="text-text-primary tabular-nums">
                  <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-primary-muted text-accent border border-accent/30">
                    {i.classCount} {i.classCount === 1 ? 'studio' : 'studios'}
                  </span>
                </TableCell>
                <TableCell align="right">
                  <Link
                    href={`/admin/instructors/${i.userId}`}
                    className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                  >
                    View
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </DataTable>

      {!loading && !failed && filtered.length > 0 && (
        <TablePagination
          currentPage={page}
          pageSize={pageSize}
          totalItems={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </Card>
  )
}

export default InstructorsTable
