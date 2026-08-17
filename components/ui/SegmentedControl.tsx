'use client'

import React from 'react'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: string
  count?: number
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  ariaLabel = 'Filter options',
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center rounded-lg border border-border bg-background-lighter p-1 ${className}`}
    >
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              isActive
                ? 'bg-primary text-accent shadow-xs border border-border-light'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-light/50'
            }`}
          >
            <span>{option.label}</span>
            {typeof option.count === 'number' && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  isActive ? 'bg-accent/15 text-accent' : 'bg-background-light text-text-dim'
                }`}
              >
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
