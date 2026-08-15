'use client'

import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { Input } from './Primitives'

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type' | 'value' | 'onChange'
> & {
  id: string
  value: string
  onChange: (value: string) => void
} & (
  /** Reveal state lifted to the parent, so one toggle can drive several fields
   *  — that is what the sign-up and reset-password pairs do, since revealing
   *  only one of the two makes a mismatch harder to spot, not easier. The union
   *  makes half-controlled usage a type error: `shown` without `onShownChange`
   *  would render an eye button that does nothing. */
  | { shown: boolean; onShownChange: (shown: boolean) => void }
  /** Omit both and the field owns its own reveal state. */
  | { shown?: never; onShownChange?: never }
)

export default function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  minLength,
  autoFocus,
  shown,
  onShownChange,
  ...inputProps
}: PasswordInputProps) {
  const [localShown, setLocalShown] = useState(false)
  const revealed = shown !== undefined ? shown : localShown

  const toggle = () => {
    if (onShownChange) onShownChange(!shown)
    else setLocalShown((v) => !v)
  }

  return (
    <div className="relative">
      <Input
        id={id}
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-11"
        autoComplete={autoComplete}
        minLength={minLength}
        autoFocus={autoFocus}
        {...inputProps}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex min-w-11 items-center justify-center rounded-r-pinspace text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}
