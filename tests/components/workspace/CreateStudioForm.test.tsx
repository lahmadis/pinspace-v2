import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import CreateStudioForm from '@/components/admin/CreateStudioForm'

describe('CreateStudioForm', () => {
  it('uses an accessible dialog and labelled form controls', async () => {
    const user = userEvent.setup()
    render(<CreateStudioForm onCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'New studio' }))

    expect(screen.getByRole('dialog', { name: 'Create studio for an instructor' })).toBeInTheDocument()
    expect(screen.getByLabelText('Studio name')).toBeInTheDocument()
    expect(screen.getByLabelText('Instructor')).toBeInTheDocument()
    expect(screen.getByLabelText('Department')).toBeInTheDocument()
    expect(screen.getByLabelText('Year level')).toBeInTheDocument()
    expect(screen.getByLabelText('Academic year')).toBeInTheDocument()
  })

  it('announces validation errors and keeps invalid controls connected to them', async () => {
    const user = userEvent.setup()
    render(<CreateStudioForm onCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'New studio' }))
    await user.click(screen.getByRole('button', { name: 'Create studio' }))

    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Studio name is required')
    expect(screen.getByLabelText('Studio name')).toHaveAttribute('aria-invalid', 'true')

    await user.type(screen.getByLabelText('Studio name'), 'Housing studio')
    await user.click(screen.getByRole('button', { name: 'Create studio' }))
    const instructor = screen.getByRole('combobox', { name: 'Instructor' })
    expect(screen.getByRole('alert')).toHaveTextContent('Pick an instructor')
    expect(instructor).toHaveAttribute('aria-invalid', 'true')
    expect(instructor.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('closes with Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<CreateStudioForm onCreated={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'New studio' })

    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
