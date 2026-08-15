"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        className="bg-kova-forest text-text-primary"
        style={{
          margin: 0,
          minHeight: '100dvh',
          background: 'Canvas',
          color: 'CanvasText',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main
          role="alert"
          className="flex min-h-screen items-center justify-center bg-kova-forest p-6"
          style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '1.5rem' }}
        >
          <section
            aria-labelledby="global-error-title"
            className="w-full max-w-lg rounded-kova-lg border border-border bg-background-light p-6 text-center shadow-[var(--shadow-raised)]"
            style={{ width: '100%', maxWidth: '32rem', boxSizing: 'border-box', textAlign: 'center' }}
          >
            <p aria-hidden="true" className="font-mono text-sm font-bold uppercase tracking-[0.14em] text-text-secondary">
              Kova
            </p>
            <h1 id="global-error-title" className="mt-2 text-2xl font-black">
              Something went wrong
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-text-secondary">
              We couldn&apos;t open this page. Try again, or return later if the problem continues.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-kova border border-kova-ink bg-primary px-5 py-2 font-semibold text-kova-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              style={{ minHeight: '44px', marginTop: '1.5rem', padding: '0.5rem 1.25rem', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
