'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { Button, Dialog, StatusState } from '@/components/ui'
import { PublicStudioShimmerCanvas } from './PublicStudioShimmer'

export function PublicStatusScreen({
  status,
  title,
  description,
  action,
}: {
  status: 'loading' | 'error' | 'info'
  title: string
  description: ReactNode
  action?: ReactNode
}) {
  if (status === 'loading') {
    return <PublicStudioShimmerCanvas title={title} description={description} />
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-pinspace-forest px-4 py-10 text-text-primary">
      <StatusState status={status} title={title} description={description} action={action} className="w-full max-w-md shadow-[var(--shadow-raised)]" />
    </main>
  )
}

export function PublicStudioHeader({
  roomName,
  modeLabel,
  boardCount,
}: {
  roomName: string | null
  modeLabel: string
  boardCount: number
}) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex flex-col gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:flex-row sm:items-start sm:justify-between sm:p-4 sm:pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href="/"
          aria-label="pinspace home"
          className="pointer-events-auto inline-flex min-h-11 shrink-0 items-center rounded-pinspace border-transparent bg-primary px-4 py-2 font-black text-pinspace-ink shadow-[0_4px_16px_rgba(255,200,0,0.35)] hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background-light focus-visible:ring-offset-2 focus-visible:ring-offset-pinspace-forest"
        >
          pinspace
        </Link>
        {roomName && (
          <p className="min-w-0 truncate rounded-pinspace border border-background-light/30 bg-pinspace-forest/85 px-3 py-2.5 text-sm font-semibold text-background-light shadow-[var(--shadow-soft)] backdrop-blur-md" title={roomName}>
            {roomName}
          </p>
        )}
      </div>
      <p className="flex w-full max-w-full self-start rounded-pinspace border border-background-light/30 bg-pinspace-forest/85 px-3 py-2.5 text-sm font-semibold text-background-light shadow-[var(--shadow-soft)] [overflow-wrap:anywhere] backdrop-blur-md sm:w-auto sm:max-w-[min(50vw,32rem)]">
        <span className="min-w-0 truncate" title={modeLabel}>{modeLabel}</span>
        <span aria-hidden="true" className="shrink-0"> · </span>
        <span className="shrink-0">{boardCount} board{boardCount === 1 ? '' : 's'}</span>
      </p>
    </header>
  )
}

export function PublicStudioNavigator({
  boards,
  models,
  onOpenBoard,
  onOpenModel,
}: {
  boards: Array<{ id: string; title: string }>
  models: Array<{ id: string; url: string }>
  onOpenBoard: (id: string) => void
  onOpenModel: (url: string) => void
}) {
  if (boards.length === 0 && models.length === 0) return null

  return (
    <details className="group pointer-events-auto fixed bottom-[max(7rem,calc(env(safe-area-inset-bottom)+7rem))] right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-pinspace border border-border bg-background-light/95 text-text-primary shadow-[var(--shadow-raised)] backdrop-blur-md sm:right-4">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-pinspace px-4 py-2.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
        Browse studio content
        <span aria-hidden="true" className="transition-transform motion-reduce:transition-none group-open:rotate-180">⌄</span>
      </summary>
      <div data-public-studio-navigator-scroll className="max-h-[min(25dvh,20rem)] space-y-4 overflow-y-auto border-t border-border p-3">
        {boards.length > 0 && (
          <section aria-labelledby="public-studio-boards-heading">
            <h2 id="public-studio-boards-heading" className="px-1 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Boards</h2>
            <ul className="mt-2 space-y-2">
              {boards.map((board) => (
                <li key={board.id}>
                  <button
                    type="button"
                    aria-label={`Open board ${board.title}`}
                    onClick={() => onOpenBoard(board.id)}
                    className="min-h-11 w-full rounded-pinspace border border-border bg-background-card px-3 py-2 text-left text-sm font-semibold shadow-sm hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    <span className="block break-words">{board.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {models.length > 0 && (
          <section aria-labelledby="public-studio-models-heading">
            <h2 id="public-studio-models-heading" className="px-1 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">3D models</h2>
            <ul className="mt-2 space-y-2">
              {models.map((model, index) => (
                <li key={model.id}>
                  <button
                    type="button"
                    aria-label={`Open 3D model ${index + 1}`}
                    onClick={() => onOpenModel(model.url)}
                    className="min-h-11 w-full rounded-pinspace border border-border bg-background-card px-3 py-2 text-left text-sm font-semibold shadow-sm hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    3D model {index + 1}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </details>
  )
}

export function PublicStudioInstructions({ children }: { children: ReactNode }) {
  return (
    <aside className="pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto max-w-3xl rounded-pinspace border border-border bg-background-light/95 px-4 py-3 text-center text-xs font-medium text-text-secondary shadow-[var(--shadow-raised)] backdrop-blur-md sm:bottom-[max(1rem,env(safe-area-inset-bottom))] sm:text-sm">
      {children}
    </aside>
  )
}

export function PublicStudioEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-4 top-1/2 z-20 mx-auto max-w-md -translate-y-1/2">
      <StatusState status="info" title={title} description={description} className="shadow-[var(--shadow-raised)]" />
    </div>
  )
}

export function PublicModelDialog({ modelUrl, onClose, children }: { modelUrl: string | null; onClose: () => void; children: ReactNode }) {
  const canOpenModelFile = Boolean(modelUrl && (modelUrl.startsWith('/') || /^https?:\/\//i.test(modelUrl)))

  return (
    <Dialog
      open={Boolean(modelUrl)}
      onOpenChange={(open) => { if (!open) onClose() }}
      title="3D model"
      description="Use pointer or touch to rotate and zoom. Keyboard users can open the model file or close this viewer."
      className="h-[min(84dvh,52rem)] max-w-5xl pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>button.absolute]:h-11 [&>button.absolute]:w-11"
    >
      <div className="h-[calc(100%-1rem)] min-h-64 overflow-hidden rounded-pinspace border border-border bg-pinspace-forest">
        {children}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {canOpenModelFile && modelUrl && (
          <a
            href={modelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-pinspace border border-border bg-background-light px-4 py-2 text-sm font-semibold text-text-primary shadow-sm hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Open model file
          </a>
        )}
        <Button type="button" variant="ghost" onClick={onClose}>Close model</Button>
      </div>
    </Dialog>
  )
}
