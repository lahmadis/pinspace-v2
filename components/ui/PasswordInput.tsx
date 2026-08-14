'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type PasswordInputProps = {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
  minLength?: number
  autoFocus?: boolean
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
}: PasswordInputProps) {
  const [localShown, setLocalShown] = useState(false)
  const revealed = shown !== undefined ? shown : localShown

  const toggle = () => {
    if (onShownChange) onShownChange(!shown)
    else setLocalShown((v) => !v)
  }

  return (
    <div className="relative">
      <input
        id={id}
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 pr-11 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        autoComplete={autoComplete}
        minLength={minLength}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}
