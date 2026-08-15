import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { back, captureException, push } = vi.hoisted(() => ({
  back: vi.fn(),
  captureException: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({ captureException }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back, push }) }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

import GlobalError from '@/app/global-error'
import StudioError from '@/app/studio/[id]/error'
import StudioViewError from '@/app/studio/[id]/view/error'
import FeedbackButton from '@/components/FeedbackButton'
import Loading from '@/components/Loading'
import Toaster from '@/components/Toaster'
import { Dialog } from '@/components/ui'
import { toast } from '@/lib/toast'

describe('global feedback and exceptional states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('announces useful loading text and supports compact and fullscreen layouts', () => {
    const { rerender } = render(<Loading message="Preparing your studio" />)
    const full = screen.getByRole('status')
    expect(full).toHaveAttribute('aria-live', 'polite')
    expect(full).toHaveAttribute('aria-atomic', 'true')
    expect(full).toHaveTextContent('Preparing your studio')
    expect(full).toHaveClass('fixed', 'inset-0')
    expect(full.querySelector('[aria-hidden="true"]')).toHaveClass('motion-reduce:animate-none')

    rerender(<Loading variant="compact" message="Loading comments" />)
    expect(screen.getByRole('status')).not.toHaveClass('fixed')
  })

  it('renders a resilient generic global error and retries without exposing details', async () => {
    const user = userEvent.setup()
    const reset = vi.fn()
    // A global error boundary must render its own html/body. RTL mounts inside a
    // div, so React reports an expected nesting warning that cannot occur in Next.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<GlobalError error={new Error('DATABASE_PASSWORD=private')} reset={reset} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('alert')).not.toHaveTextContent('DATABASE_PASSWORD')
    const retry = screen.getByRole('button', { name: 'Try again' })
    retry.focus()
    expect(retry).toHaveFocus()
    await user.click(retry)
    expect(reset).toHaveBeenCalledOnce()
    expect(captureException).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('preserves retry and navigation behavior in PinSpace route error boundaries', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reset = vi.fn()
    const { unmount } = render(<StudioError error={new Error('private studio data')} reset={reset} />)

    expect(screen.getByRole('alert')).not.toHaveTextContent('private studio data')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Back to dashboard' }))
    expect(push).toHaveBeenCalledWith('/dashboard')
    unmount()

    render(<StudioViewError error={new Error('private room data')} reset={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(back).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('uses live-region semantics, updates duplicate IDs, and dismisses without stealing focus', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>Keep focus</button>
        <Toaster />
      </>
    )
    const focusTarget = screen.getByRole('button', { name: 'Keep focus' })
    focusTarget.focus()
    const politeAnnouncements = screen.getByRole('status', { name: 'Toast notifications' })

    act(() => { toast.loading('Saving studio', { id: 'save-studio' }) })
    expect(politeAnnouncements).toHaveTextContent('Saving studio')
    expect(screen.getByRole('status', { name: 'Saving studio' })).toHaveAttribute('aria-live', 'off')
    act(() => { toast.success('Studio saved', { id: 'save-studio', duration: 0 }) })
    expect(politeAnnouncements).toHaveTextContent('Studio saved')
    expect(screen.getAllByRole('status', { name: 'Studio saved' })).toHaveLength(1)
    expect(focusTarget).toHaveFocus()

    act(() => { toast.error('Could not save', { id: 'save-error', duration: 0 }) })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    const dismiss = screen.getByRole('button', { name: 'Dismiss: Could not save' })
    expect(dismiss).toHaveClass('min-h-11', 'min-w-11')
    await user.click(dismiss)
    expect(screen.queryByText('Could not save')).not.toBeInTheDocument()
  })

  it('cleans up toast timers after auto-dismissal', () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => { toast.info('Short message', { id: 'short', duration: 1000 }) })
    expect(screen.getByRole('status', { name: 'Toast notifications' })).toHaveTextContent('Short message')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('status', { name: 'Short message' })).not.toBeInTheDocument()
  })

  it('announces reliable offline and restored-online transitions without blocking actions', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    render(<Toaster />)

    const networkAnnouncements = screen.getByRole('status', { name: 'Network status updates' })
    expect(networkAnnouncements).toHaveTextContent("You're offline")
    const offlineNotice = screen.getByText("You're offline").closest('[data-network-notice]')
    expect(offlineNotice).toHaveClass('pointer-events-none', 'z-[90]')
    expect(offlineNotice).toHaveClass('sm:w-[min(24rem,calc(100vw-16rem))]')
    expect(screen.queryByRole('button', { name: 'Retry connection' })).not.toBeInTheDocument()

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(networkAnnouncements).toHaveTextContent('Back online')
  })

  it('positions bottom toasts above the measured offline notice and safe area', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = this.hasAttribute('data-network-notice') ? 96 : 0
      return {
        bottom: height,
        height,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })
    render(<Toaster />)
    act(() => {
      toast.info('Bottom update', { id: 'bottom-update', duration: 0, position: 'bottom-center' })
    })

    const toastContainer = screen.getByRole('status', { name: 'Bottom update' }).parentElement
    await waitFor(() => {
      const bottomStyle = toastContainer?.getAttribute('style') ?? ''
      expect(bottomStyle).toContain('96px')
      expect(bottomStyle).toContain('safe-area-inset-bottom')
    })
  })

  it('uses semantic PinSpace state tokens rather than raw palette utilities', () => {
    const source = readFileSync('components/ui/Primitives.tsx', 'utf8')
    const statusStateSource = source.slice(source.indexOf('export function StatusState'))
    expect(statusStateSource).not.toMatch(/\b(?:red|amber|emerald)-\d+/)
    expect(statusStateSource).toContain('--color-danger')
    expect(statusStateSource).toContain('--color-warning')
    expect(statusStateSource).toContain('--color-success')
  })

  it('keeps global dialog close targets at least 44px', () => {
    render(<Dialog open onOpenChange={vi.fn()} title="Example dialog">Content</Dialog>)
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveClass('h-11', 'w-11')
  })

  it('prevents duplicate feedback submissions and announces async progress', async () => {
    let resolveRequest!: (value: { ok: boolean }) => void
    const request = new Promise<{ ok: boolean }>((resolve) => { resolveRequest = resolve })
    const fetchMock = vi.fn(() => request)
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<FeedbackButton />)

    await user.click(screen.getByRole('button', { name: 'Report a bug or idea' }))
    await user.type(screen.getByLabelText('Feedback message'), 'The upload button is unclear')
    const submit = screen.getByRole('button', { name: 'Submit feedback' })
    await user.dblClick(submit)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Sending feedback' })).toHaveAttribute('aria-busy', 'true')
    await act(async () => { resolveRequest({ ok: true }) })
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks')
  })
})
