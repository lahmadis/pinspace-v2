import Link from 'next/link'
import type { ReactNode } from 'react'

import { Card, StatusState } from '@/components/ui'

type AuthShellProps = {
  children: ReactNode
  eyebrow?: string
  title: string
  description?: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function AuthShell({
  children,
  eyebrow = 'Make work visible',
  title,
  description,
  footer,
  wide = false,
}: AuthShellProps) {
  return (
    <main className="min-h-screen bg-white bg-[linear-gradient(to_right,rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.04)_1px,transparent_1px)] bg-[size:40px_40px] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-6xl flex-col sm:min-h-[calc(100vh-4rem)]">
        <Link
          href="/"
          className="inline-flex min-h-11 w-fit items-center rounded-pinspace px-2 font-mono text-sm font-bold uppercase tracking-[0.18em] text-primary-dark transition-colors hover:bg-primary-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          pinspace
        </Link>

        <div className="my-auto grid items-center gap-8 py-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,0.65fr)] lg:gap-16">
          <section aria-label="About pinspace" className="hidden max-w-xl lg:block">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
            <p className="mt-4 text-5xl font-bold leading-[0.98] text-text-primary">
              Where design work lives.
            </p>
            <p className="mt-5 max-w-lg text-lg leading-8 text-text-secondary">
              Build rooms, connect work across your community, and keep critique close to the ideas it shapes.
            </p>
          </section>

          <Card className={wide ? 'w-full lg:max-w-xl' : 'w-full lg:max-w-md'}>
            <div className="mb-6">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-accent">{eyebrow}</p>
              <h1 className="mt-2 text-3xl font-bold leading-tight text-text-primary">{title}</h1>
              {description && <div className="mt-2 text-sm leading-6 text-text-secondary">{description}</div>}
            </div>
            {children}
            {footer && <div className="mt-6 border-t border-border pt-5 text-sm">{footer}</div>}
          </Card>
        </div>
      </div>
    </main>
  )
}

export function AuthLoading({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <StatusState
        status="loading"
        title={label}
        description="This will only take a moment."
        className="w-full max-w-sm bg-background-card"
      />
    </main>
  )
}

export const fieldLabelClass = 'mb-1.5 block text-sm font-semibold text-text-primary'

export const textLinkClass =
  'inline-flex min-h-11 items-center rounded-pinspace px-1 font-semibold text-accent underline-offset-4 transition-colors hover:text-accent-light hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
