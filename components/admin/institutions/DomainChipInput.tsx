'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { DOMAIN_REGEX } from '@/lib/validations/admin'

export interface DomainChipInputProps {
  inputId: string
  domains: string[]
  onAdd: (domain: string) => void
  onRemove: (domain: string) => void
  error: string
  onErrorClear: () => void
  disabled?: boolean
}

export function DomainChipInput({
  inputId,
  domains,
  onAdd,
  onRemove,
  error,
  onErrorClear,
  disabled = false,
}: DomainChipInputProps) {
  const [input, setInput] = useState('')

  const commit = () => {
    const d = input.trim().toLowerCase().replace(/^https?:\/\//i, '')
    onErrorClear()
    if (!d) return
    if (!DOMAIN_REGEX.test(d)) {
      onAdd('\x00INVALID:' + d)
      return
    }
    onAdd(d)
    setInput('')
  }

  return (
    <div>
      <div className="flex gap-2">
        <Input
          id={inputId}
          disabled={disabled}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          placeholder="e.g. wit.edu"
          className="flex-1"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        <Button
          type="button"
          onClick={commit}
          disabled={disabled}
          variant="secondary"
        >
          Add
        </Button>
      </div>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-danger mt-1">
          {error}
        </p>
      )}
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {domains.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-muted text-accent rounded text-xs font-medium border border-accent"
            >
              {d}
              <Button
                type="button"
                onClick={() => onRemove(d)}
                disabled={disabled}
                aria-label={`Remove ${d}`}
                variant="ghost"
                size="sm"
                className="ml-0.5 min-w-11 px-2 text-accent"
              >
                <X className="w-3 h-3" />
              </Button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default DomainChipInput
