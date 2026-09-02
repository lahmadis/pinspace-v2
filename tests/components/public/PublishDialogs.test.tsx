import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import PublishCategoryModal from '@/components/PublishCategoryModal'
import PublishConfirmModal from '@/components/PublishConfirmModal'

describe('PinSpace publish dialogs', () => {
  it('uses modal semantics, visible labels, announced validation, and Escape dismissal', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    render(
      <PublishCategoryModal
        workspaceName="Material futures"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Publish to network' })
    expect(within(dialog).getByLabelText('Department')).toHaveAttribute('id', 'publish-category-department')
    expect(within(dialog).getByLabelText('Grade Level')).toHaveAttribute('id', 'publish-category-year')

    await user.click(within(dialog).getByRole('button', { name: 'Publish to network' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Select a department and grade level')
    expect(within(dialog).getByLabelText('Department')).toHaveAttribute('aria-invalid', 'true')
    expect(onConfirm).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('guards category confirmation against duplicate activation', async () => {
    const onConfirm = vi.fn()
    render(
      <PublishCategoryModal
        workspaceName="Material futures"
        defaultValues={{ department: 'Architecture', year: 'Year 4' }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    const confirm = screen.getByRole('button', { name: 'Publish to network' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('associates publish metadata errors with every required field', async () => {
    const user = userEvent.setup()
    render(
      <PublishConfirmModal
        workspaceName="Material futures"
        isCurrentlyPublic={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Publish to network' })
    await user.selectOptions(within(dialog).getByLabelText('Semester'), '')
    await user.click(within(dialog).getByRole('button', { name: 'Publish to network' }))

    // FIVE required fields, not four. Class (the studio bucket) became
    // required after this test was written — "a published workspace with no
    // studio has no bucket to appear in" — and the list here was never
    // updated, so the count assertion has been failing ever since while the
    // one field it forgot went unchecked.
    for (const name of ['Department', 'Semester', 'Grade Level', 'Class', 'Instructor']) {
      const field = within(dialog).getByLabelText(name)
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(field).toHaveAttribute('aria-describedby')
    }
    expect(within(dialog).getAllByRole('alert')).toHaveLength(5)
  })

  it('uses an explicit destructive dialog and guards duplicate unpublish', () => {
    const onConfirm = vi.fn()
    render(
      <PublishConfirmModal
        workspaceName="Material futures"
        isCurrentlyPublic
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Remove from network?' })
    expect(dialog).toHaveTextContent('Public links will stop working')
    const confirm = within(dialog).getByRole('button', { name: 'Remove from network' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
