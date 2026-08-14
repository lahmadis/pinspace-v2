interface LoadingProps {
  message?: string
  variant?: 'fullscreen' | 'compact'
}

export default function Loading({
  message = 'Loading…',
  variant = 'fullscreen',
}: LoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={variant === 'fullscreen'
        ? 'fixed inset-0 z-50 flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center'
        : 'flex min-h-24 w-full items-center justify-center p-4 text-center'}
    >
      <div className="flex min-w-0 flex-col items-center gap-3">
        <span
          aria-hidden="true"
          className="h-8 w-8 shrink-0 animate-spin rounded-full border-4 border-border border-t-accent motion-reduce:animate-none"
        />
        <p className="max-w-md text-sm font-medium text-text-secondary">{message}</p>
      </div>
    </div>
  )
}
