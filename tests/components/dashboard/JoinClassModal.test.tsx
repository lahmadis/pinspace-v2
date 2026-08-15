import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import JoinClassModal from '@/components/JoinClassModal'

const { push, toastError } = vi.hoisted(() => ({ push: vi.fn(), toastError: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: toastError } }))

describe('JoinClassModal', () => {
  beforeEach(() => {
    push.mockReset()
    toastError.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('uses the shared dialog, focuses the field, closes with Escape, and restores focus', async () => {
    const user = userEvent.setup()
    function Example() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Join project</button>
          {open && <JoinClassModal onClose={() => setOpen(false)} />}
        </>
      )
    }

    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Join project' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Join a Project' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Invite code or link' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Join a Project' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('normalizes a full invite link and prevents duplicate submission while pending', async () => {
    const user = userEvent.setup()
    let resolveFetch: ((value: { ok: boolean }) => void) | undefined
    const fetchMock = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    render(<JoinClassModal onClose={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: 'Invite code or link' }), 'https://pinspace.test/join/ab%2012')
    const submit = screen.getByRole('button', { name: 'Continue' })
    await user.click(submit)
    await user.click(submit)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/by-invite/AB%2012')
    expect(screen.getByRole('button', { name: 'Checking invite code' })).toBeDisabled()

    resolveFetch?.({ ok: true })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/join/AB%2012'))
  })
})
