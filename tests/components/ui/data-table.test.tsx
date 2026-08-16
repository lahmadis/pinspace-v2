import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  DataTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableStateRow,
} from '@/components/ui'

describe('PinSpace data table', () => {
  it('keeps native table semantics inside a labelled responsive region', () => {
    render(
      <DataTable label="Workspace members">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead align="right">Rooms</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Ada Lovelace</TableCell>
            <TableCell align="right">3</TableCell>
          </TableRow>
        </TableBody>
      </DataTable>,
    )

    const region = screen.getByRole('region', { name: 'Workspace members' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table', { name: 'Workspace members' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Rooms' })).toHaveClass('text-right')
    expect(screen.getByRole('cell', { name: '3' })).toHaveClass('text-right')
  })

  it('renders consistent loading, empty, and recoverable error rows', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    const { rerender } = render(
      <DataTable label="Studios">
        <TableBody><TableStateRow colSpan={4} status="loading" title="Loading studios" /></TableBody>
      </DataTable>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading studios')

    rerender(
      <DataTable label="Studios">
        <TableBody><TableStateRow colSpan={4} status="empty" title="No studios yet" /></TableBody>
      </DataTable>,
    )
    expect(screen.getByText('No studios yet')).toBeInTheDocument()

    rerender(
      <DataTable label="Studios">
        <TableBody>
          <TableStateRow colSpan={4} status="error" title="Could not load studios" actionLabel="Try again" onAction={retry} />
        </TableBody>
      </DataTable>,
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load studios')
    expect(retry).toHaveBeenCalledOnce()
  })
})
