'use client'

import { useState } from 'react'
import { GraduationCap, Search, User } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Input,
  Select,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableStateRow,
  TablePagination,
} from '@/components/ui'
import type { AdminStudio } from '@/types/admin'
import { DEPARTMENTS } from '@/lib/constants/departments'
import CreateStudioForm from '@/components/admin/CreateStudioForm'
import { TransferOwnerModal } from './TransferOwnerModal'
import { toggleStudioMembershipApi } from '@/lib/api/admin'
import { toast } from '@/lib/toast'

function getInitials(name: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export interface AdminStudiosTableProps {
  studios: AdminStudio[]
  loading: boolean
  onChanged: () => void
}

export function AdminStudiosTable({ studios, loading, onChanged }: AdminStudiosTableProps) {
  const [query, setQuery] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [transferring, setTransferring] = useState<AdminStudio | null>(null)

  const toggleMembership = async (studio: AdminStudio) => {
    setBusyId(studio.id)
    try {
      await toggleStudioMembershipApi(studio.id, studio.adminIsMember)
      onChanged()
    } catch (err: any) {
      toast.error(err.message || 'Request failed')
    } finally {
      setBusyId(null)
    }
  }

  const handleQueryChange = (val: string) => {
    setQuery(val)
    setPage(1)
  }

  const handleDeptFilterChange = (val: string) => {
    setDepartmentFilter(val)
    setPage(1)
  }

  const q = query.trim().toLowerCase()
  const filtered = studios.filter((s) => {
    const matchesQuery =
      q.length === 0 ||
      s.name.toLowerCase().includes(q) ||
      (s.ownerName ?? '').toLowerCase().includes(q) ||
      (s.department ?? '').toLowerCase().includes(q)
    const matchesDept = departmentFilter === 'ALL' || s.department === departmentFilter
    return matchesQuery && matchesDept
  })

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="px-6 py-3.5 border-b border-border bg-background-light/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <GraduationCap className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-bold text-text-primary">Studios</h2>
          <span className="text-xs font-medium text-text-dim">({studios.length} total)</span>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
          {/* Search Bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-dim absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              aria-label="Search studios"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search studios..."
              className="h-9 w-44 pl-8 text-xs rounded-lg bg-background-lighter border-border focus:border-accent"
            />
          </div>

          {/* Department Filter */}
          <Select
            aria-label="Filter by department"
            value={departmentFilter}
            onChange={(e) => handleDeptFilterChange(e.target.value)}
            className="h-9 w-40 text-xs rounded-lg bg-background-lighter border-border focus:border-accent"
          >
            <option value="ALL">All Departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>

          {/* Create Studio Trigger */}
          <CreateStudioForm onCreated={onChanged} />
        </div>
      </div>

      <DataTable label="Class Studios Table">
        <TableHeader>
          <TableRow>
            <TableHead>Studio</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Year</TableHead>
            <TableHead>Origin</TableHead>
            <TableHead align="right">Access</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableSkeletonRows rows={5} cols={6} colWidths={['w-48', 'w-36', 'w-24', 'w-16', 'w-20', 'w-16']} />
          ) : studios.length === 0 ? (
            <TableStateRow colSpan={6} status="empty" title="No studios registered yet." />
          ) : filtered.length === 0 ? (
            <TableStateRow colSpan={6} status="empty" title="No studios match your filter criteria." />
          ) : (
            paginated.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-primary-muted text-accent font-semibold text-xs flex items-center justify-center border border-accent/30 shrink-0">
                      {s.name[0]?.toUpperCase() || 'S'}
                    </div>
                    <div>
                      <p className="font-medium text-text-primary">{s.name}</p>
                      <p className="text-xs text-text-dim mt-0.5">
                        {s.type}
                        {s.isArchived && ' · archived'}
                      </p>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="text-text-primary">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-background-lighter text-text-secondary text-[10px] font-semibold flex items-center justify-center shrink-0 border border-border">
                      {getInitials(s.ownerName)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{s.ownerName || '—'}</p>
                      <Button
                        type="button"
                        onClick={() => setTransferring(s)}
                        variant="ghost"
                        size="sm"
                        className="min-h-0 px-0 py-0.5 text-xs text-accent hover:text-accent"
                      >
                        Transfer
                      </Button>
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  {s.department ? (
                    <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-background-lighter text-text-secondary border border-border">
                      {s.department}
                    </span>
                  ) : (
                    <span className="text-text-dim text-xs">—</span>
                  )}
                </TableCell>

                <TableCell className="whitespace-nowrap text-text-secondary text-xs">
                  {s.academicYear || '—'}
                </TableCell>

                <TableCell>
                  {s.provisionedByAdmin ? (
                    <Badge variant="accent">Provisioned</Badge>
                  ) : (
                    <span className="text-xs text-text-dim">Organic</span>
                  )}
                </TableCell>

                <TableCell align="right">
                  <Button
                    type="button"
                    onClick={() => toggleMembership(s)}
                    disabled={busyId === s.id}
                    variant={s.adminIsMember ? 'secondary' : 'primary'}
                    size="sm"
                    loading={busyId === s.id}
                  >
                    {s.adminIsMember ? 'Leave' : 'Join'}
                  </Button>
                </TableCell>
              </TableRow>
            ))
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

      {transferring && (
        <TransferOwnerModal
          studio={transferring}
          onClose={() => setTransferring(null)}
          onTransferred={onChanged}
        />
      )}
    </Card>
  )
}

export default AdminStudiosTable
