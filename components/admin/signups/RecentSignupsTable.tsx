'use client'

import { useState } from 'react'
import { Search, UserPlus } from 'lucide-react'
import {
  Avatar,
  Badge,
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
} from '@/components/ui'
import type { RecentSignup, SignupStatus } from '@/types/admin'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < MINUTE) return 'just now'
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour')
  const days = Math.floor(diff / DAY)
  if (days < 30) return plural(days, 'day')
  if (days < 365) return plural(Math.floor(days / 30), 'month')
  return plural(Math.floor(days / 365), 'year')
}

function getInitials(name: string | null, email: string | null) {
  const target = name || email || '?'
  const parts = target.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const SIGNUP_STATUS: Record<SignupStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-success/15 text-success border border-success/30' },
  no_profile: { label: 'No profile', className: 'bg-warning/15 text-warning border border-warning/30' },
  unverified: { label: 'Unverified', className: 'bg-background-lighter text-text-secondary border border-border' },
}

export interface RecentSignupsTableProps {
  signups: RecentSignup[]
  loading: boolean
}

type StatusFilterTab = 'ALL' | 'ACTIVE' | 'NO_PROFILE' | 'UNVERIFIED'

export function RecentSignupsTable({ signups, loading }: RecentSignupsTableProps) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilterTab>('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const handleQueryChange = (val: string) => {
    setQuery(val)
    setPage(1)
  }

  const handleStatusFilterChange = (tab: StatusFilterTab) => {
    setStatusFilter(tab)
    setPage(1)
  }

  const q = query.trim().toLowerCase()
  const filtered = signups.filter((s) => {
    const matchesQuery =
      q.length === 0 ||
      (s.fullName ?? '').toLowerCase().includes(q) ||
      (s.email ?? '').toLowerCase().includes(q) ||
      (s.organization ?? '').toLowerCase().includes(q)

    if (!matchesQuery) return false
    if (statusFilter === 'ACTIVE') return s.status === 'active'
    if (statusFilter === 'NO_PROFILE') return s.status === 'no_profile'
    if (statusFilter === 'UNVERIFIED') return s.status === 'unverified'
    return true
  })

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="px-6 py-3.5 border-b border-border bg-background-light/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <UserPlus className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-bold text-text-primary">Recent Signups Feed</h2>
          <span className="text-xs font-medium text-text-dim">({signups.length} total)</span>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
          {/* Segmented Filter Tabs */}
          <SegmentedControl
            value={statusFilter}
            onChange={(val) => handleStatusFilterChange(val as StatusFilterTab)}
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'NO_PROFILE', label: 'No Profile' },
              { value: 'UNVERIFIED', label: 'Unverified' },
            ]}
          />

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-dim absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              aria-label="Search signups"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search signups..."
              className="h-9 w-44 pl-8 text-xs rounded-lg bg-background-lighter border-border focus:border-accent"
            />
          </div>
        </div>
      </div>

      <DataTable label="Recent account signups">
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead>Signed up</TableHead>
            <TableHead>Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableSkeletonRows rows={5} cols={5} colWidths={['w-48', 'w-24', 'w-32', 'w-28', 'w-28']} />
          ) : signups.length === 0 ? (
            <TableStateRow colSpan={5} status="empty" title="No signups yet." />
          ) : filtered.length === 0 ? (
            <TableStateRow colSpan={5} status="empty" title="No signups match your filter criteria." />
          ) : (
            paginated.map((s) => {
              const status = SIGNUP_STATUS[s.status] ?? SIGNUP_STATUS.unverified
              return (
                <TableRow key={s.userId}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary-muted text-accent font-semibold text-xs flex items-center justify-center border border-accent/30 shrink-0">
                        {getInitials(s.fullName, s.email)}
                      </div>
                      <div>
                        {s.fullName ? (
                          <>
                            <p className="font-medium text-text-primary">{s.fullName}</p>
                            <p className="text-xs text-text-dim mt-0.5">{s.email || '—'}</p>
                          </>
                        ) : (
                          <p className="font-medium text-text-primary">{s.email || '—'}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${status.className}`}>
                      {status.label}
                    </span>
                  </TableCell>
                  <TableCell>
                    {s.organization ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-background-lighter text-text-secondary border border-border">
                        {s.organization}
                      </span>
                    ) : (
                      <span className="text-text-dim text-xs">Personal</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <p className="text-text-primary text-xs font-medium">{formatDate(s.createdAt)}</p>
                    <p className="text-xs text-text-dim mt-0.5">{timeAgo(s.createdAt)}</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {s.lastSignInAt ? (
                      <>
                        <p className="text-text-primary text-xs font-medium">{formatDate(s.lastSignInAt)}</p>
                        <p className="text-xs text-text-dim mt-0.5">{timeAgo(s.lastSignInAt)}</p>
                      </>
                    ) : (
                      <span className="text-text-dim text-xs">Never</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </DataTable>

      {!loading && filtered.length > 0 && (
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

export default RecentSignupsTable
