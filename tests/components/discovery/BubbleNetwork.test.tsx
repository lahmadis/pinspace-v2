import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import BubbleNetwork, { type BubbleNode } from '@/components/network/BubbleNetwork'

const nodes: BubbleNode[] = [
  {
    id: 'studio-1',
    name: 'Material Ecologies',
    label: 'Material Ecologies',
    count: 12,
    department: 'Architecture',
    year: 4,
    instructor: 'Ada Lovelace',
    color: 'rgb(var(--color-primary))',
  },
  {
    id: 'studio-2',
    name: 'Public Futures',
    label: 'Public Futures',
    count: 8,
    department: 'Interior Design',
    year: 'Masters',
    color: 'rgb(var(--color-secondary))',
  },
]

describe('BubbleNetwork', () => {
  it('provides a keyboard-operable directory with the graph information in text', async () => {
    const onNodeClick = vi.fn()
    const user = userEvent.setup()
    render(<BubbleNetwork nodes={nodes} onNodeClick={onNodeClick} />)

    expect(screen.getByRole('img', { name: /network map with 2 studios/i })).toBeInTheDocument()
    const directory = screen.getByRole('region', { name: 'Network directory' })
    expect(directory).toHaveTextContent('Architecture')
    expect(directory).toHaveTextContent('Year 4')
    expect(directory).toHaveTextContent('Ada Lovelace')
    expect(directory).toHaveTextContent('12 members')

    const firstNode = screen.getByRole('button', { name: /Open Material Ecologies/i })
    firstNode.focus()
    await user.keyboard('{Enter}')
    expect(onNodeClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'studio-1' }))
  })

  it('keeps the directory usable for long and large datasets without hiding labels', () => {
    const largeNodes = Array.from({ length: 80 }, (_, index) => ({
      id: `studio-${index}`,
      name: `Studio ${index} with an exceptionally long interdisciplinary programme label`,
      label: `Studio ${index} with an exceptionally long interdisciplinary programme label`,
      count: index,
    }))
    render(<BubbleNetwork nodes={largeNodes} />)
    expect(screen.getAllByRole('button', { name: /Open Studio/i })).toHaveLength(80)
    expect(screen.getByText(/Studio 79 with an exceptionally long/i)).toBeInTheDocument()
  })

  it('normalizes legacy API colours to the semantic visualization palette', async () => {
    const { container } = render(
      <BubbleNetwork
        nodes={[{ id: 'legacy-studio', name: 'Legacy studio', label: 'Legacy studio', count: 4, color: '#6366f1' }]}
      />
    )

    await waitFor(() => {
      expect(container.querySelector('circle[fill="#6366f1"]')).not.toBeInTheDocument()
      expect(container.querySelector('circle[fill="rgb(var(--color-primary))"]')).toBeInTheDocument()
    })
  })
})
