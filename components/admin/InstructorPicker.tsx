'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

import { IconButton, Input } from '@/components/ui'

export type UserSearchResult = {
  userId: string
  email: string | null
  fullName: string | null
  organizationId: string | null
  hasProfile: boolean
}

export default function InstructorPicker({
  selected,
  onSelect,
  emptyHint = 'No account matches. They must sign up before you can provision a studio for them.',
  id,
  label = 'Instructor',
  invalid = false,
  describedBy,
}: {
  selected: UserSearchResult | null
  onSelect: (user: UserSearchResult | null) => void
  emptyHint?: string
  id?: string
  label?: string
  invalid?: boolean
  describedBy?: string
}) {
  const generatedId = useId()
  const inputId = id ?? `instructor-${generatedId}`
  const listId = `${inputId}-results`
  const statusId = `${inputId}-status`
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (activeIndex < 0) return
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : { users: [] }))
        .then((data: { users?: UserSearchResult[] }) => {
          if (cancelled) return
          setResults(Array.isArray(data.users) ? data.users : [])
          setActiveIndex(-1)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const choose = (user: UserSearchResult) => {
    onSelect(user)
    setActiveIndex(-1)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setDismissed(true)
      setActiveIndex(-1)
      return
    }
    if (!results.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1))
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      choose(results[activeIndex])
    }
  }

  if (selected) {
    const displayName = selected.fullName || selected.email || selected.userId
    return (
      <div className="min-w-0">
        <span id={`${inputId}-label`} className="mb-1 block text-sm font-semibold text-text-primary">{label}</span>
        <div className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-kova border border-accent bg-primary-muted px-3 py-2">
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold text-text-primary">{displayName}</p>
            {selected.fullName && selected.email && (
              <p className="break-all text-xs text-text-secondary">{selected.email}</p>
            )}
          </div>
          <IconButton
            label="Clear selected instructor"
            size="md"
            onClick={() => {
              onSelect(null)
              setQuery('')
              window.setTimeout(() => inputRef.current?.focus(), 0)
            }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    )
  }

  const open = query.trim().length >= 2 && !dismissed
  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="mb-1 block text-sm font-semibold text-text-primary">{label}</label>
      <Input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined}
        aria-invalid={invalid}
        aria-describedby={[describedBy, open && (searching || results.length === 0) ? statusId : undefined].filter(Boolean).join(' ') || undefined}
        value={query}
        onChange={(event) => {
          const value = event.target.value
          setQuery(value)
          setDismissed(false)
          if (value.trim().length < 2) {
            setResults([])
            setSearching(false)
            setActiveIndex(-1)
          } else {
            setSearching(true)
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search by name or email"
      />
      {open && (
        <div id={listId} role="listbox" aria-label="Instructor search results" className="mt-2 max-h-56 overflow-y-auto rounded-kova border border-border bg-background-light p-1 shadow-[var(--shadow-soft)]">
          {searching ? (
            <p id={statusId} role="status" className="px-3 py-2 text-sm text-text-secondary">Searching…</p>
          ) : results.length === 0 ? (
            <p id={statusId} role="status" className="px-3 py-2 text-sm text-text-secondary">{emptyHint}</p>
          ) : (
            results.map((user, index) => {
              const name = user.fullName || user.email || user.userId
              return (
                <button
                  key={user.userId}
                  ref={(node) => { optionRefs.current[index] = node }}
                  id={`${inputId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(user)}
                  className="block min-h-11 w-full min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-left hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-selected:bg-primary-muted"
                >
                  <span className="block break-words text-sm font-semibold text-text-primary">{name}</span>
                  {user.fullName && user.email && <span className="block break-all text-xs text-text-secondary">{user.email}</span>}
                  {!user.hasProfile && <span className="mt-0.5 block text-xs text-text-secondary">Has not completed onboarding</span>}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
