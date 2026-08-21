'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound, useParams, useRouter, useSearchParams } from 'next/navigation'
import { Network } from 'lucide-react'
import BubbleNetwork, { type BubbleNode } from '@/components/network/BubbleNetwork'
import { NetworkShimmerCanvas } from '@/components/network/NetworkShimmer'
import { Button, Card, EmptyState, Select, StatusState } from '@/components/ui'

const DEPARTMENTS: Record<string, string> = {
  'aerospace-engineering': 'Aerospace Engineering', architecture: 'Architecture',
  'civil-engineering': 'Civil Engineering', 'electrical-engineering': 'Electrical Engineering',
  'industrial-design': 'Industrial Design', 'interior-design': 'Interior Design',
  'mechanical-engineering': 'Mechanical Engineering', 'robotics-engineering': 'Robotics Engineering',
}

type ViewMode = 'years' | 'all'
type YearItem = { year: string; slug: string; studioCount: number }
type StudioItem = { id: string; name: string; studioId?: string; memberCount?: number; members?: unknown[]; instructor?: string; semester?: string; networkMetadata?: { year?: string } }
type LoadState = 'loading' | 'ok' | 'error'

function yearColor(year?: string) {
  const colors = ['rgb(var(--color-primary))', 'rgb(var(--color-secondary))', 'rgb(var(--color-warning))', 'rgb(var(--color-success))', 'rgb(var(--color-paper))']
  const match = year?.match(/\d+/)?.[0]
  return colors[Math.max(0, Math.min(colors.length - 1, Number(match || 1) - 1))]
}

export default function DepartmentPage() {
  const params = useParams<{ department: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const departmentName = DEPARTMENTS[params.department]
  const [viewMode, setViewMode] = useState<ViewMode>(searchParams.get('view') === 'all' ? 'all' : 'years')
  const [years, setYears] = useState<YearItem[]>([])
  const [studios, setStudios] = useState<StudioItem[]>([])
  const [yearFilter, setYearFilter] = useState('All years')
  const [selectedAcademicYear, setSelectedAcademicYear] = useState('')
  const [academicYears, setAcademicYears] = useState<{ year: string; count: number }[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => { if (departmentName) document.title = `${departmentName} Studios – pinspace` }, [departmentName])
  useEffect(() => {
    if (!departmentName) return
    const load = async () => {
      try {
        const response = await fetch('/api/explore/academic-years', { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        const nextYears = data.academicYears || []
        setAcademicYears(nextYears)
        setSelectedAcademicYear(nextYears[0]?.year ?? '')
      } catch (error) { console.error(error) }
    }
    void load()
  }, [departmentName])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (viewMode === 'all') url.searchParams.set('view', 'all')
    else url.searchParams.delete('view')
    router.replace(url.pathname + url.search, { scroll: false })
  }, [router, viewMode])

  const loadResults = useCallback(async () => {
    if (!departmentName) return
    await Promise.resolve()
    setLoadState('loading')
    try {
      if (viewMode === 'years') {
        const query = selectedAcademicYear ? `?academic_year=${encodeURIComponent(selectedAcademicYear)}` : ''
        const response = await fetch(`/api/explore/${params.department}/years${query}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Department years request failed')
        const data = await response.json()
        setYears(data.years || [])
      } else {
        const query = new URLSearchParams({ department: departmentName })
        if (selectedAcademicYear) query.set('academic_year', selectedAcademicYear)
        const response = await fetch(`/api/workspaces/public?${query}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Department studios request failed')
        const data = await response.json()
        setStudios(data.workspaces || [])
      }
      setLoadState('ok')
    } catch (error) { console.error(error); setLoadState('error') }
  }, [departmentName, params.department, selectedAcademicYear, viewMode])
  // The effect starts an external request; loading state is part of that request lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadResults() }, [loadResults])

  if (!departmentName) return notFound()

  const filteredStudios = yearFilter === 'All years' ? studios : studios.filter((studio) => studio.networkMetadata?.year === yearFilter)
  const nodes: BubbleNode[] = viewMode === 'years'
    ? years.map((year) => ({ id: year.slug, name: year.year, label: year.year, count: year.studioCount, url: `/explore/${params.department}/${year.slug}`, color: yearColor(year.year), radius: 70 }))
    : filteredStudios.map((studio) => ({ id: studio.id, name: studio.name, label: studio.name, count: studio.memberCount ?? studio.members?.length ?? 0, memberCount: studio.memberCount ?? studio.members?.length ?? 0, url: `/studio/${studio.studioId || studio.id}/view`, color: yearColor(studio.networkMetadata?.year), instructor: studio.instructor, semester: studio.semester, year: studio.networkMetadata?.year === 'Masters' ? 'Masters' : Number(studio.networkMetadata?.year?.match(/\d+/)?.[0] || 0) || undefined }))
  const uniqueYears = ['All years', ...Array.from(new Set(studios.map((studio) => studio.networkMetadata?.year).filter((year): year is string => Boolean(year))))]

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-text-primary">
      <header className="border-b border-border bg-background-light">
        <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm"><Link href="/explore" className="min-h-11 content-center rounded-pinspace px-2 font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Explore</Link><span aria-hidden="true">/</span><span className="break-words">{departmentName}</span></nav>
          <p className="mt-5 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">Department discovery</p>
          <h1 className="mt-1 break-words text-3xl font-black sm:text-5xl">{departmentName}</h1>
          <p className="mt-2 text-text-secondary">Browse published studios by programme year or as one network.</p>
          <Link href="/my-boards" className="mt-4 inline-flex min-h-11 items-center rounded-pinspace border border-border bg-background px-4 py-2 text-sm font-semibold text-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">My boards</Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-[96rem] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Department view">
              <Button type="button" variant={viewMode === 'years' ? 'primary' : 'ghost'} aria-pressed={viewMode === 'years'} onClick={() => setViewMode('years')}>By year</Button>
              <Button type="button" variant={viewMode === 'all' ? 'primary' : 'ghost'} aria-pressed={viewMode === 'all'} onClick={() => setViewMode('all')}>All studios</Button>
            </div>
            {academicYears.length > 0 && <div className="w-full sm:ml-auto sm:w-56"><label htmlFor="department-academic-year" className="mb-1 block text-xs font-semibold">Academic year</label><Select id="department-academic-year" value={selectedAcademicYear} onChange={(event) => setSelectedAcademicYear(event.target.value)}><option value="">All years</option>{academicYears.map(({ year, count }) => <option key={year} value={year}>{year} ({count})</option>)}</Select></div>}
            {viewMode === 'all' && <div className="w-full sm:w-48"><label htmlFor="programme-year" className="mb-1 block text-xs font-semibold">Programme year</label><Select id="programme-year" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>{uniqueYears.map((year) => <option key={year}>{year}</option>)}</Select></div>}
          </div>

          <section aria-label={`${departmentName} network`} className="min-h-[34rem] overflow-hidden rounded-pinspace-lg border border-border bg-pinspace-forest sm:min-h-[40rem]">
            {loadState === 'loading' ? <NetworkShimmerCanvas title={`Loading ${departmentName} studios...`} />
              : loadState === 'error' ? <div className="flex min-h-[34rem] items-center justify-center p-4"><StatusState status="error" title="Could not load department studios" description="Try again without changing your filters." action={<Button type="button" onClick={() => void loadResults()}>Try again</Button>} className="w-full max-w-lg" /></div>
                : nodes.length === 0 ? <div className="flex min-h-[34rem] items-center justify-center p-4"><EmptyState title="No studios match these filters" description="Choose another year or check back when studios are published." icon={<Network className="h-8 w-8" aria-hidden="true" />} className="w-full max-w-lg" /></div>
                  : <BubbleNetwork nodes={nodes} onNodeClick={(node) => { if (node.url) window.location.href = node.url }} />}
          </section>
        </div>

        <aside><Card><p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">Programme summary</p><h2 className="mt-2 break-words text-xl font-bold">{viewMode === 'years' ? 'Studios by year' : 'Published studios'}</h2><dl className="mt-4 space-y-2 text-sm">{viewMode === 'years' ? years.map((year) => <div key={year.slug} className="flex justify-between gap-4"><dt>{year.year}</dt><dd className="font-bold">{year.studioCount}</dd></div>) : <div className="flex justify-between gap-4"><dt>Visible studios</dt><dd className="font-bold">{filteredStudios.length}</dd></div>}</dl></Card></aside>
      </main>
    </div>
  )
}
