import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DashboardActionDialogs } from '@/components/dashboard/DashboardActionDialogs'

describe('DashboardActionDialogs', () => {
  it('requires explicit destructive confirmation and restores focus', async () => {
    const user = userEvent.setup()
    const onConfirmDelete = vi.fn()

    function Example() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open delete</button>
          <DashboardActionDialogs
            rename={null}
            deletion={open ? { id: 'workspace-1', name: 'North Studio' } : null}
            leave={null}
            onRenameChange={vi.fn()}
            onCancelRename={vi.fn()}
            onSubmitRename={vi.fn()}
            onCancelDelete={() => setOpen(false)}
            onConfirmDelete={onConfirmDelete}
            onCancelLeave={vi.fn()}
            onConfirmLeave={vi.fn()}
          />
        </>
      )
    }

    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Open delete' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Delete project?' })
    expect(dialog).toHaveTextContent('North Studio')
    expect(onConfirmDelete).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Delete project?' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('disables destructive actions and communicates pending state', () => {
    render(
      <DashboardActionDialogs
        rename={null}
        deletion={{ id: 'workspace-1', name: 'North Studio' }}
        leave={{ id: 'workspace-2', name: 'Shared Lab' }}
        deletePending
        leavePending
        onRenameChange={vi.fn()}
        onCancelRename={vi.fn()}
        onSubmitRename={vi.fn()}
        onCancelDelete={vi.fn()}
        onConfirmDelete={vi.fn()}
        onCancelLeave={vi.fn()}
        onConfirmLeave={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Deleting project' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Leaving project' })).toBeDisabled()
  })
})
