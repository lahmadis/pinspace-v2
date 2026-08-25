'use client'

import * as Sentry from '@sentry/nextjs'
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'

interface SceneErrorBoundaryProps {
  children: ReactNode
  resetKey?: string
  onRetry?: () => void
}

interface SceneErrorBoundaryState {
  hasError: boolean
  retryCount: number
}

/** Keeps a WebGL or asset-loading failure contained to the 3D surface. */
export class SceneErrorBoundary extends Component<
  SceneErrorBoundaryProps,
  SceneErrorBoundaryState
> {
  state: SceneErrorBoundaryState = { hasError: false, retryCount: 0 }

  static getDerivedStateFromError(): Partial<SceneErrorBoundaryState> {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    })
  }

  componentDidUpdate(previousProps: SceneErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState((state) => ({
        hasError: false,
        retryCount: state.retryCount + 1,
      }))
    }
  }

  private retry = (): void => {
    this.props.onRetry?.()
    this.setState((state) => ({
      hasError: false,
      retryCount: state.retryCount + 1,
    }))
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex h-full min-h-64 w-full items-center justify-center bg-background p-6"
        >
          <div className="max-w-md rounded-2xl border border-border bg-background-card p-6 text-center shadow-raised">
            <h2 className="text-lg font-semibold text-text-primary">
              Room couldn&apos;t load
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              The 3D view hit a graphics or asset error. Your room data is safe.
            </p>
            <button
              type="button"
              onClick={this.retry}
              className="mt-5 rounded-xl bg-secondary px-4 py-2 text-sm font-semibold text-white transition hover:bg-secondary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
            >
              Retry room
            </button>
          </div>
        </div>
      )
    }

    return <Fragment key={this.state.retryCount}>{this.props.children}</Fragment>
  }
}
