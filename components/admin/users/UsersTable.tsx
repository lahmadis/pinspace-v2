'use client'

import { useState } from 'react'
import { GraduationCap, Search, ShieldCheck, Users } from 'lucide-react'
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
} from '@/components/ui'
import type { AdminUser, AccountRole } from '@/types/admin'
import { updateUserRoleApi } from '@/lib/api/admin'
import { toast } from '@/lib/toast'

function getInitials(name: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export interface UsersTableProps {
  users: AdminUser[]
  loading: boolean
  loadError: string
  onChanged: () => void
}

type FilterTab = 'ALL' | 'STUDENTS' | 'INSTRUCTORS'

export function UsersTable({ users, loading, loadError, onChanged }: UsersTableProps) {
  const [query, setQuery] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [savingId, setSavingId] = useState<string | null>(null)

  const toggleRole = async (u: AdminUser) => {
    const next: AccountRole = u.accountRole === 'instructor' ? 'student' : 'instructor'
    setSavingId(u.userId)
    try {
      await updateUserRoleApi({ userId: u.userId, accountRole: next })
      toast.success(`Role updated for ${u.fullName || u.email || 'user'}`)
      onChanged()
    } catch (err: any) {
      toast.error(err.message || 'Failed to update user role')
    } finally {
      setSavingId(null)
    }
  }

  const handleQueryChange = (val: string) => {
    setQuery(val)
    setPage(1)
  }

  const handleFilterTabChange = (tab: FilterTab) => {
    setFilterTab(tab)
    setPage(1)
  }

  const q = query.trim().toLowerCase()
  const filtered = users.filter((u) => {
    const matchesQuery =
      q.length === 0 ||
      (u.fullName ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q) ||
      (u.organization ?? '').toLowerCase().includes(q)

    if (!matchesQuery) return false
    if (filterTab === 'STUDENTS') return u.accountRole === 'student'
    if (filterTab === 'INSTRUCTORS') return u.accountRole === 'instructor'
    return true
  })

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="px-6 py-3.5 border-b border-border bg-background-light/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Users className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-bold text-text-primary">Accounts & Roles</h2>
          <span className="text-xs font-medium text-text-dim">({users.length} total)</span>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
          {/* Segmented Filter Tabs */}
          <SegmentedControl
            value={filterTab}
            onChange={(val) => handleFilterTabChange(val as 'ALL' | 'STUDENTS' | 'INSTRUCTORS')}
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'STUDENTS', label: 'Students' },
              { value: 'INSTRUCTORS', label: 'Instructors' },
            ]}
          />

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-dim absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              aria-label="Search users"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search accounts..."
              className="h-9 w-44 pl-8 text-xs rounded-lg bg-background-lighter border-border focus:border-accent"
            />
          </div>
        </div>
      </div>

      <DataTable label="Users and roles">
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead>Demographic</TableHead>
            <TableHead>Account role</TableHead>
            <TableHead align="right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableSkeletonRows rows={5} cols={6} colWidths={['w-48', 'w-36', 'w-24', 'w-20', 'w-20', 'w-24']} />
          ) : loadError ? (
            <TableStateRow
              colSpan={6}
              status="error"
              title={loadError}
              description="The request failed; reload to try again."
              actionLabel="Try again"
              onAction={onChanged}
            />
          ) : users.length === 0 ? (
            <TableStateRow colSpan={6} status="empty" title="No users registered yet." />
          ) : filtered.length === 0 ? (
            <TableStateRow colSpan={6} status="empty" title="No users match your filter criteria." />
          ) : (
            paginated.map((u) => {
              const isInstr = u.accountRole === 'instructor'
              return (
                <TableRow key={u.userId}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary-muted text-accent font-semibold text-xs flex items-center justify-center border border-accent/30 shrink-0">
                        {getInitials(u.fullName)}
                      </div>
                      <p className="font-medium text-text-primary">{u.fullName || '—'}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-text-secondary">{u.email || '—'}</TableCell>
                  <TableCell className="text-text-secondary">
                    {u.organization ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-background-lighter text-text-secondary border border-border">
                        {u.organization}
                      </span>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </TableCell>
                  <TableCell className="capitalize text-text-secondary">{u.role || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={isInstr ? 'accent' : 'neutral'} className="gap-1">
                      {isInstr ? <ShieldCheck className="w-3 h-3" /> : <GraduationCap className="w-3 h-3" />}
                      {u.accountRole}
                    </Badge>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      type="button"
                      onClick={() => toggleRole(u)}
                      loading={savingId === u.userId}
                      variant={isInstr ? 'ghost' : 'secondary'}
                      size="sm"
                    >
                      {isInstr ? 'Demote to student' : 'Promote to instructor'}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </DataTable>

      {!loading && !loadError && filtered.length > 0 && (
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

export default UsersTable
