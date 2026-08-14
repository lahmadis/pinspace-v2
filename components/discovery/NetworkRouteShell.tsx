'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, Boxes } from 'lucide-react'
import BubbleNetwork, { type BubbleNode } from '@/components/network/BubbleNetwork'
import { Button, EmptyState, StatusState } from '@/components/ui'

type NetworkRouteShellProps = {
  title: string
  eyebrow: string
  countLabel: string
  backHref: string
  backLabel: string
  nodes: BubbleNode[]
  loadState: 'loading' | 'ok' | 'error' | 'not-found'
  loadingTitle: string
  errorTitle: string
  errorDescription: string
  notFoundTitle?: string
  notFoundDescription?: string
  emptyTitle: string
  emptyDescription: string
  emptyAction?: ReactNode
  headerAction?: ReactNode
  onRetry: () => void
  onNodeClick: (node: BubbleNode) => void
}

export default function NetworkRouteShell({
  title, eyebrow, countLabel, backHref, backLabel, nodes, loadState, loadingTitle,
  errorTitle, errorDescription, notFoundTitle, notFoundDescription, emptyTitle,
  emptyDescription, emptyAction, headerAction, onRetry, onNodeClick,
}: NetworkRouteShellProps) {
  const headerRef = useRef<HTMLElement>(null)
  const [headerHeight, setHeaderHeight] = useState(80)

  useEffect(() => {
    const element = headerRef.current
    if (!element) return
    const update = () => setHeaderHeight(element.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (loadState === 'loading') {
    return <main className="flex min-h-screen items-center justify-center bg-kova-forest px-4"><StatusState status="loading" title={loadingTitle} description="Mapping rooms and connections." /></main>
  }

  if (loadState === 'error' || loadState === 'not-found') {
    const missing = loadState === 'not-found'
    return (
      <main className="flex min-h-screen items-center justify-center bg-kova-forest px-4">
        <StatusState
          status="error"
          title={missing ? (notFoundTitle ?? errorTitle) : errorTitle}
          description={missing ? (notFoundDescription ?? errorDescription) : errorDescription}
          action={<div className="flex flex-wrap gap-3">{!missing && <Button type="button" onClick={onRetry}>Try again</Button>}<Link href={backHref} className="inline-flex min-h-11 items-center rounded-kova border border-border bg-background-light px-4 py-2 text-sm font-semibold text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{backLabel}</Link></div>}
          className="w-full max-w-lg"
        />
      </main>
    )
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-kova-forest text-white">
      <header ref={headerRef} className="fixed inset-x-0 top-0 z-40 border-b border-white/15 bg-kova-forest/95 backdrop-blur-md">
        <div className="flex min-h-20 flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link href={backHref} className="inline-flex min-h-11 items-center gap-2 rounded-kova px-3 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{backLabel}</Link>
          <div className="min-w-0 flex-1 border-l border-white/20 pl-4">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
            <h1 className="break-words text-xl font-bold">{title}</h1>
            <p className="text-xs text-white/70">{nodes.length} {countLabel}</p>
          </div>
          {headerAction}
        </div>
      </header>
      {nodes.length === 0 ? (
        <main className="flex min-h-screen items-center justify-center px-4 pt-24">
          <EmptyState title={emptyTitle} description={emptyDescription} icon={<Boxes className="h-8 w-8" aria-hidden="true" />} action={emptyAction} className="w-full max-w-lg" />
        </main>
      ) : <BubbleNetwork nodes={nodes} onNodeClick={onNodeClick} fullScreen headerHeight={headerHeight} />}
    </div>
  )
}
