import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import PasswordInput from '@/components/ui/PasswordInput'

describe('PasswordInput', () => {
  it('reveals an uncontrolled field and retains focus on its toggle', async () => {
    const user = userEvent.setup()
    render(<PasswordInput id="password" value="secret" onChange={() => undefined} />)

    const input = screen.getByDisplayValue('secret')
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(input).toHaveAttribute('type', 'password')
    await user.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveFocus()
  })

  it('uses one controlled reveal state across a password pair', async () => {
    const user = userEvent.setup()
    function PasswordPair() {
      const [shown, setShown] = useState(false)
      return (
        <>
          <PasswordInput id="password" value="first" onChange={() => undefined} shown={shown} onShownChange={setShown} />
          <PasswordInput id="confirm" value="second" onChange={() => undefined} shown={shown} onShownChange={setShown} />
        </>
      )
    }

    render(<PasswordPair />)
    await user.click(screen.getAllByRole('button', { name: 'Show password' })[1])
    expect(screen.getByDisplayValue('first')).toHaveAttribute('type', 'text')
    expect(screen.getByDisplayValue('second')).toHaveAttribute('type', 'text')
  })

  it('forwards value changes and native password constraints', async () => {
    const user = userEvent.setup()
    function EditablePassword() {
      const [value, setValue] = useState('')
      return (
        <>
          <label htmlFor="new-password">New password</label>
          <PasswordInput
            id="new-password"
            value={value}
            onChange={setValue}
            autoComplete="new-password"
            minLength={12}
          />
        </>
      )
    }

    render(<EditablePassword />)
    const input = screen.getByLabelText('New password')
    await user.type(input, 'correct horse')
    expect(input).toHaveValue('correct horse')
    expect(input).toHaveAttribute('autocomplete', 'new-password')
    expect(input).toHaveAttribute('minlength', '12')
  })
})
