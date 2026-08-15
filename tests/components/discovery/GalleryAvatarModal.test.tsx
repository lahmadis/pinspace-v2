import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import GalleryAvatarModal from '@/components/GalleryAvatarModal'

describe('GalleryAvatarModal', () => {
  it('uses a labelled dialog, closes with Escape, and restores focus', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    render(<GalleryAvatarModal isOpen onClose={onClose} onEnter={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'Create your gallery avatar' })
    expect(within(dialog).getByLabelText('Department')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Year')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('disables dismissal and submission controls while entry is pending', () => {
    render(<GalleryAvatarModal isOpen pending onClose={vi.fn()} onEnter={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Create your gallery avatar' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Entering gallery…' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: /Close dialog/i })).not.toBeInTheDocument()
  })
})
