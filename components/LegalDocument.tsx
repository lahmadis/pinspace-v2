'use client'

import Link from 'next/link'
import ReactMarkdown from 'react-markdown'

interface LegalDocumentProps {
  content: string
}

export default function LegalDocument({ content }: LegalDocumentProps) {
  return (
    <div className="min-h-dvh bg-background text-text-primary">
      <header className="sticky top-0 z-10 border-b border-border bg-background-light/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-kova px-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ← Back to Kova
          </Link>
          <nav aria-label="Legal pages" className="flex gap-1 text-sm">
            <Link href="/terms" className="inline-flex min-h-11 items-center rounded-kova px-3 text-text-secondary transition-colors hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              Terms
            </Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center rounded-kova px-3 text-text-secondary transition-colors hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <article className="max-w-[68ch] text-text-primary leading-7">
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h1 className="mb-6 break-words text-3xl font-black tracking-tight text-text-primary sm:text-4xl">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-4 mt-10 break-words text-2xl font-bold text-text-primary">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="mb-3 mt-7 break-words text-lg font-bold text-text-primary">{children}</h3>
              ),
              p: ({ children }) => (
                <p className="mb-4 text-text-secondary">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-6 mb-4 space-y-1.5 text-text-secondary marker:text-text-muted">
                  {children}
                </ul>
              ),
              li: ({ children }) => <li>{children}</li>,
              strong: ({ children }) => (
                <strong className="font-semibold text-text-primary">{children}</strong>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  className="rounded-sm font-semibold text-accent underline decoration-2 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  target={href?.startsWith('http') ? '_blank' : undefined}
                  rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
                >
                  {children}
                </a>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  )
}
