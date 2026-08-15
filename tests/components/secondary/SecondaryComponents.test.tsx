import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DemoBanner from '@/components/DemoBanner'
import FeedbackButton from '@/components/FeedbackButton'
import LegalDocument from '@/components/LegalDocument'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}))

vi.mock('@/lib/demoMode', () => ({ isDemoMode: () => true }))

const routerPush = vi.hoisted(() => vi.fn())
const routerReplace = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}))

describe('secondary-route shared components', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    routerPush.mockReset()
    routerReplace.mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('renders legal content with navigation, main, article, and ordered headings', () => {
    render(<LegalDocument content={'# Privacy\n\n## Data we collect\n\nReadable copy.'} />)

    expect(screen.getByRole('navigation', { name: 'Legal pages' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('article'))
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Data we collect' })).toBeInTheDocument()
  })

  it('identifies demo mode as a status banner with a reachable exit action', () => {
    render(<DemoBanner message="Demo Mode - Sample studios" />)

    expect(screen.getByRole('status')).toHaveTextContent('Demo Mode - Sample studios')
    expect(screen.getByRole('button', { name: 'Exit demo mode' })).toHaveClass('min-h-11')
  })

  it('exits dedicated demo routes instead of reloading back into demo mode', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/demo/studio/sample')
    render(<DemoBanner />)

    await user.click(screen.getByRole('button', { name: 'Exit demo mode' }))
    expect(routerPush).toHaveBeenCalledWith('/')
  })

  it('removes query demo mode immediately on regular routes', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/?demo=true')
    render(<DemoBanner />)

    await user.click(screen.getByRole('button', { name: 'Exit demo mode' }))

    expect(routerReplace).toHaveBeenCalledWith('/')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('uses an accessible feedback dialog, bounds input, and restores trigger focus', async () => {
    const user = userEvent.setup()
    render(<FeedbackButton />)

    const trigger = screen.getByRole('button', { name: 'Report a bug or idea' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Report a bug or idea' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Feedback message' })).toHaveAttribute('maxlength', '4000')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('guards against duplicate feedback submissions and announces generic failures', async () => {
    const user = userEvent.setup()
    let resolveRequest: ((value: Response) => void) | undefined
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))
    render(<FeedbackButton />)

    await user.click(screen.getByRole('button', { name: 'Report a bug or idea' }))
    await user.type(screen.getByRole('textbox', { name: 'Feedback message' }), 'The board flickers.')
    const submit = screen.getByRole('button', { name: 'Submit feedback' })
    await user.click(submit)
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveRequest?.(new Response('{}', { status: 500 }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.'))
  })

  it('does not let an old feedback success timer close a newly reopened dialog', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    render(<FeedbackButton />)

    const trigger = screen.getByRole('button', { name: 'Report a bug or idea' })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByRole('textbox', { name: 'Feedback message' }), { target: { value: 'Useful note' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('Thanks — we received it.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    fireEvent.click(trigger)
    act(() => vi.advanceTimersByTime(1500))

    expect(screen.getByRole('dialog', { name: 'Report a bug or idea' })).toBeInTheDocument()
  })
})
