import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CommentComposer, CommentList } from '@/components/comments/CommentThread'

const comment = {
  id: 'comment-1',
  boardId: 'board-1',
  authorName: 'Amina Khan',
  content: 'The section hierarchy is clear.',
  createdAt: new Date().toISOString(),
}

describe('shared comment thread', () => {
  it('renders loading, error, empty, and populated states consistently', () => {
    const { rerender } = render(<CommentList comments={[]} loading error="" onRetry={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading comments')

    rerender(<CommentList comments={[]} loading={false} error="Could not load" onRetry={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()

    rerender(<CommentList comments={[]} loading={false} error="" onRetry={vi.fn()} />)
    expect(screen.getByText('No comments yet')).toBeInTheDocument()

    rerender(<CommentList comments={[comment]} loading={false} error="" onRetry={vi.fn()} />)
    expect(screen.getByText('Amina Khan')).toBeInTheDocument()
    expect(screen.getByText(comment.content)).toBeInTheDocument()
  })

  it('provides one labelled composer with the shared keyboard submit behavior', () => {
    const onSubmit = vi.fn()
    const onChange = vi.fn()
    const ref = createRef<HTMLTextAreaElement>()
    render(
      <CommentComposer
        id="test-comment"
        value="Useful feedback"
        onChange={onChange}
        onSubmit={onSubmit}
        posting={false}
        textareaRef={ref}
      />,
    )

    const field = screen.getByRole('textbox', { name: 'Add a comment' })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.getByText('15 / 2000 characters')).toBeInTheDocument()
  })
})
