'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GraduationCap,
  LayoutGrid,
  Pencil,
  Search,
  Users,
} from 'lucide-react'
import { Card, Input, SegmentedControl, Skeleton, TablePagination, TableSkeletonRows } from '@/components/ui'
import type { InstitutionWithCount } from '@/types/admin'

function OrgRow({
  inst,
  onEdit,
}: {
  inst: InstitutionWithCount
  onEdit: (inst: InstitutionWithCount) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isFirm = inst.type === 'firm'

  return (
    <li className="border-b border-border last:border-0">
      <div className="flex flex-col items-stretch gap-3 px-4 py-4 transition-colors hover:bg-primary-muted sm:flex-row sm:items-center sm:gap-4 sm:px-6">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-pinspace text-text-dim hover:bg-background-lighter hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title={expanded ? 'Collapse' : 'Show studios'}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 text-text-dim" />}
        </button>

        {/* Icon + Name + meta */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-full bg-primary-muted text-accent font-semibold text-xs flex items-center justify-center border border-accent/30 shrink-0">
            {isFirm ? <Building2 className="w-4 h-4" /> : <GraduationCap className="w-4 h-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium text-text-primary truncate">{inst.name}</p>
              <span className="text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.2 bg-background-lighter text-text-dim border border-border rounded">
                {inst.type || 'university'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-text-dim mt-0.5 flex-wrap">
              <span>/i/{inst.slug}</span>
              {inst.domains?.map((d) => (
                <span key={d} className="inline-flex px-1.5 py-0.2 bg-primary-muted text-accent rounded text-[11px] font-medium border border-accent/30">
                  {d}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Counts */}
        <div className="flex shrink-0 flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap px-2 py-1 bg-background-lighter rounded border border-border" title="Users">
            <Users className="w-3.5 h-3.5 text-text-dim" />
            <span className="font-semibold text-text-primary tabular-nums">{inst.user_count}</span> users
          </span>
          <span className="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap px-2 py-1 bg-background-lighter rounded border border-border" title="Studio rooms">
            <LayoutGrid className="w-3.5 h-3.5 text-text-dim" />
            <span className="font-semibold text-text-primary tabular-nums">{inst.workspace_count}</span> studios
          </span>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href={`/admin/institutions/${inst.slug}`}
            className="inline-flex min-h-11 items-center rounded-pinspace px-3 py-2 text-xs font-medium text-accent hover:bg-primary-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Full stats
          </Link>
          <button
            type="button"
            onClick={() => onEdit(inst)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pinspace text-text-dim hover:bg-background-lighter hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Edit"
            aria-label={`Edit ${inst.name}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <a
            href={`/i/${inst.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pinspace text-text-dim hover:bg-background-lighter hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Open explore"
            aria-label={`Open ${inst.name} explore page`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Expanded studio list */}
      {expanded && (
        <div className="px-6 pb-4 ml-14">
          {inst.workspaces.length === 0 ? (
            <p className="text-xs text-text-dim italic">No studio rooms registered yet under {inst.name}.</p>
          ) : (
            <ul className="space-y-1.5">
              {inst.workspaces.map((ws) => (
                <li
                  key={ws.id}
                  className="flex items-center justify-between text-xs text-text-secondary py-1.5 px-3 bg-background-lighter/60 rounded border border-border/50"
                >
                  <span className="font-medium text-text-primary">{ws.name || 'Unnamed Studio'}</span>
                  <span className="text-[11px] text-text-dim">
                    {ws.type || 'class'} · {ws.created_at ? new Date(ws.created_at).toLocaleDateString() : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

export interface InstitutionsTableProps {
  list: InstitutionWithCount[]
  loading: boolean
  onEdit: (inst: InstitutionWithCount) => void
}

type TypeFilterTab = 'ALL' | 'UNIVERSITY' | 'FIRM'

export function InstitutionsTable({ list, loading, onEdit }: InstitutionsTableProps) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilterTab>('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const handleQueryChange = (val: string) => {
    setQuery(val)
    setPage(1)
  }

  const handleTypeFilterChange = (tab: TypeFilterTab) => {
    setTypeFilter(tab)
    setPage(1)
  }

  const q = query.trim().toLowerCase()
  const filtered = list.filter((inst) => {
    const matchesQuery =
      q.length === 0 ||
      inst.name.toLowerCase().includes(q) ||
      inst.slug.toLowerCase().includes(q) ||
      (inst.network_label ?? '').toLowerCase().includes(q) ||
      (inst.domains ?? []).some((d) => d.toLowerCase().includes(q))

    const isFirm = inst.type === 'firm'
    if (!matchesQuery) return false
    if (typeFilter === 'UNIVERSITY') return !isFirm
    if (typeFilter === 'FIRM') return isFirm
    return true
  })

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="px-6 py-3.5 border-b border-border bg-background-light/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Building2 className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-bold text-text-primary">Organizations & Firms</h2>
          <span className="text-xs font-medium text-text-dim">({list.length} total)</span>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
          {/* Segmented Filter Tabs */}
          <SegmentedControl
            value={typeFilter}
            onChange={(val) => handleTypeFilterChange(val as TypeFilterTab)}
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'UNIVERSITY', label: 'Universities' },
              { value: 'FIRM', label: 'Design Firms' },
            ]}
          />

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-dim absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              aria-label="Search organizations"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search orgs..."
              className="h-9 w-44 pl-8 text-xs rounded-lg bg-background-lighter border-border focus:border-accent"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-2 border-b border-border/40 last:border-0">
              <Skeleton variant="circular" className="w-9 h-9" />
              <div className="space-y-2 flex-1">
                <Skeleton className="w-48 h-4" />
                <Skeleton className="w-32 h-3" />
              </div>
              <Skeleton className="w-24 h-6 rounded" />
              <Skeleton className="w-20 h-6 rounded" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="p-8 text-center text-text-secondary">
          <p className="font-medium text-text-primary">No organizations registered yet.</p>
          <p className="mt-1 text-sm">Create one with the button above.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-text-secondary">
          <p className="font-medium text-text-primary">No organizations match your filter criteria.</p>
        </div>
      ) : (
        <ul>
          {paginated.map((inst) => (
            <OrgRow key={inst.id} inst={inst} onEdit={onEdit} />
          ))}
        </ul>
      )}

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

export default InstitutionsTable
