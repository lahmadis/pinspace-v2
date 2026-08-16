import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  DialogActions,
  FormField,
  Input,
  Spinner,
  Switch,
  Textarea,
} from '@/components/ui'

describe('PinSpace reusable system components', () => {
  it('uses one action treatment for links and native buttons', () => {
    render(<ButtonLink href="/dashboard">Open dashboard</ButtonLink>)

    const link = screen.getByRole('link', { name: 'Open dashboard' })
    expect(link).toHaveAttribute('href', '/dashboard')
    expect(link).toHaveClass('min-h-11')
    expect(link).toHaveClass('rounded-pinspace')
  })

  it('associates labels, descriptions, errors, and native controls', () => {
    render(
      <>
        <FormField
          id="room-name"
          label="Room name"
          description="Shown to everyone in the studio."
          error="Room name is required."
        >
          {(controlProps) => <Input {...controlProps} />}
        </FormField>
        <FormField id="room-notes" label="Notes">
          {(controlProps) => <Textarea {...controlProps} />}
        </FormField>
      </>,
    )

    const name = screen.getByLabelText('Room name')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Shown to everyone in the studio. Room name is required.')
    expect(screen.getByRole('alert')).toHaveTextContent('Room name is required.')
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA')
  })

  it('keeps checkbox and switch behavior native and keyboard reachable', async () => {
    const user = userEvent.setup()
    const onSwitchChange = vi.fn()

    function Controls() {
      const [enabled, setEnabled] = useState(false)
      return (
        <>
          <label><Checkbox defaultChecked /> Email updates</label>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => {
              setEnabled(next)
              onSwitchChange(next)
            }}
            aria-label="Publish room"
          />
        </>
      )
    }

    render(<Controls />)

    expect(screen.getByRole('checkbox', { name: 'Email updates' })).toBeChecked()
    const publish = screen.getByRole('switch', { name: 'Publish room' })
    publish.focus()
    await user.keyboard(' ')
    expect(publish).toHaveAttribute('aria-checked', 'true')
    expect(onSwitchChange).toHaveBeenCalledWith(true)
  })

  it('provides consistent card structure, loading semantics, and dialog actions', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Studio access</CardTitle>
          <CardDescription>Control who can enter this room.</CardDescription>
        </CardHeader>
        <CardContent>Members only</CardContent>
        <CardFooter>
          <DialogActions><ButtonLink href="/settings">Manage access</ButtonLink></DialogActions>
        </CardFooter>
        <Spinner label="Loading access" />
      </Card>,
    )

    expect(screen.getByRole('heading', { name: 'Studio access' })).toBeInTheDocument()
    expect(screen.getByText('Control who can enter this room.')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading access' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Dialog actions' })).toBeInTheDocument()
  })
})
