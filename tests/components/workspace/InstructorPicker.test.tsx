import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import InstructorPicker from '@/components/admin/InstructorPicker'

describe('InstructorPicker', () => {
  it('exposes a labelled combobox with an announced loading state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const user = userEvent.setup()
    render(<InstructorPicker selected={null} onSelect={vi.fn()} id="studio-instructor" label="Instructor" />)

    const input = screen.getByRole('combobox', { name: 'Instructor' })
    await user.type(input, 'Ada')

    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'true'))
    expect(screen.getByRole('status')).toHaveTextContent('Searching')
  })

  it('supports keyboard selection and long instructor values', async () => {
    const result = {
      userId: 'user-1',
      fullName: 'Professor With An Exceptionally Long Name That Must Wrap Safely',
      email: 'professor.with.a.very.long.address@example.edu',
      organizationId: 'org-1',
      hasProfile: true,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [result] }) }))
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<InstructorPicker selected={null} onSelect={onSelect} id="studio-instructor" label="Instructor" />)

    await user.type(screen.getByRole('combobox', { name: 'Instructor' }), 'Professor')
    await screen.findByRole('option', { name: /Professor With An Exceptionally Long Name/ })
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onSelect).toHaveBeenCalledWith(result)
  })

  it('closes the result list with Escape while preserving the query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) }))
    const user = userEvent.setup()
    render(<InstructorPicker selected={null} onSelect={vi.fn()} id="studio-instructor" label="Instructor" />)
    const input = screen.getByRole('combobox', { name: 'Instructor' })

    await user.type(input, 'Ada')
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'true'))
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('Ada')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
