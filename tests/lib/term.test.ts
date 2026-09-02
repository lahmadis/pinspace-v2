import { afterEach, describe, expect, it, vi } from 'vitest'

import { compareTermsDesc, currentTerm, isTerm, termFor, termOptions } from '@/lib/term'

/**
 * The month boundaries and the sort are the two things here that are easy to
 * get subtly wrong and impossible to notice: a term one month off files a
 * section into the wrong semester bubble, and a term list sorted as plain
 * strings looks ordered until Fall and Spring meet.
 */
describe('termFor', () => {
  it('maps months to Spring / Summer / Fall with July on the Fall side', () => {
    expect(termFor(new Date(2026, 0, 15))).toBe('Spring 2026')
    expect(termFor(new Date(2026, 3, 30))).toBe('Spring 2026')
    expect(termFor(new Date(2026, 4, 1))).toBe('Summer 2026')
    expect(termFor(new Date(2026, 5, 30))).toBe('Summer 2026')
    // July is Fall, inherited from the July academic-year rollover: a class
    // created in late July is being set up for the coming Fall.
    expect(termFor(new Date(2026, 6, 1))).toBe('Fall 2026')
    expect(termFor(new Date(2026, 11, 31))).toBe('Fall 2026')
  })

  it('keeps every date in the academic year the old rollover gave it', () => {
    // Fall Y, Spring Y+1 and Summer Y+1 are the three terms of 'Y-(Y+1)'.
    // This is what lets migrations/046 rewrite stored values without moving a
    // row into a different academic year.
    expect(termFor(new Date(2025, 6, 29))).toBe('Fall 2025') // was 2025-2026
    expect(termFor(new Date(2026, 4, 9))).toBe('Summer 2026') // was 2025-2026
    expect(termFor(new Date(2026, 6, 23))).toBe('Fall 2026') // was 2026-2027
  })
})

describe('isTerm', () => {
  it('accepts terms this app writes and rejects everything else', () => {
    expect(isTerm('Fall 2025')).toBe(true)
    expect(isTerm('Summer 2026')).toBe(true)
    // The format this replaced must NOT pass: the write paths use isTerm as the
    // gate that stops a stale client filing a section into a bucket the
    // drill-down can never reach.
    expect(isTerm('2025-2026')).toBe(false)
    expect(isTerm('Winter 2025')).toBe(false)
    expect(isTerm('Fall')).toBe(false)
    expect(isTerm(undefined)).toBe(false)
  })
})

describe('compareTermsDesc', () => {
  it('orders newest first across a season boundary, where string sort fails', () => {
    // 'Fall 2025' > 'Spring 2026' alphabetically and < it in time. Sorting
    // these as plain strings is the bug this comparator exists to prevent.
    expect(['Spring 2026', 'Fall 2025', 'Fall 2026', 'Summer 2026'].sort(compareTermsDesc)).toEqual([
      'Fall 2026',
      'Summer 2026',
      'Spring 2026',
      'Fall 2025',
    ])
  })

  it('sorts the unfiled bucket last, not first', () => {
    // Descending is written out rather than negated for exactly this: negating
    // the ascending comparator would float 'No semester' to the top.
    expect(['No semester', 'Fall 2026', 'Spring 2026'].sort(compareTermsDesc)).toEqual([
      'Fall 2026',
      'Spring 2026',
      'No semester',
    ])
  })
})

describe('termOptions', () => {
  afterEach(() => vi.useRealTimers())

  it('leads with future terms and never makes the current term the default', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 1)) // Fall 2026

    expect(termOptions({ back: 4 })).toEqual([
      'Summer 2027',
      'Spring 2027',
      'Fall 2026',
      'Summer 2026',
      'Spring 2026',
      'Fall 2025',
      'Summer 2025',
    ])
    // The lookahead is why every form defaults to currentTerm() rather than
    // options[0] — otherwise a new section files itself two semesters out.
    expect(currentTerm()).toBe('Fall 2026')
    expect(termOptions({ back: 4 })[0]).not.toBe(currentTerm())
  })

  it('offers eight years of history to admin provisioning', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 1))

    const options = termOptions({ back: 23 })
    expect(options).toHaveLength(26)
    expect(options).toContain(currentTerm())
    expect(options.at(-1)).toBe('Spring 2019')
  })
})
