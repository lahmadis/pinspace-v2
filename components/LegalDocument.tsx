'use client'

import Link from 'next/link'
import ReactMarkdown from 'react-markdown'

interface LegalDocumentProps {
  content: string
}

export default function LegalDocument({ content }: LegalDocumentProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-text-muted hover:text-primary transition-colors"
          >
            ← Back to PinSpace
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/terms" className="text-text-muted hover:text-primary transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="text-text-muted hover:text-primary transition-colors">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <article className="text-text-primary leading-relaxed">
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h1 className="text-4xl font-bold text-text-primary mb-6">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-2xl font-semibold text-text-primary mt-10 mb-4">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">{children}</h3>
              ),
              p: ({ children }) => (
                <p className="text-text-secondary mb-4">{children}</p>
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
                  className="text-primary hover:underline"
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
