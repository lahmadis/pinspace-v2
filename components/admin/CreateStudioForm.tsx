'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { DEPARTMENTS, YEAR_LEVELS } from '@/lib/constants/departments'
import { academicYearOptions } from '@/lib/academicYear'
import { toast } from '@/lib/toast'
import InstructorPicker, { type UserSearchResult } from './InstructorPicker'

/**
 * Provision a studio FOR an instructor.
 *
 * Lifted out of app/admin/page.tsx so the instructor detail page reuses this
 * exact form — and therefore the exact POST /api/admin/studios call — rather
 * than growing a second creation path. The only addition is `lockedInstructor`:
 * when the form is opened from a page that is ALREADY about one person, the
 * picker is replaced by a read-only chip so an admin cannot start on Professor
 * A's page and accidentally provision for Professor B.
 *
 * The lock is a UI affordance, not a security boundary — the route is
 * admin-only either way and re-checks everything it is sent.
 */
export default function CreateStudioForm({
  onCreated,
  lockedInstructor = null,
  triggerLabel = 'New studio',
}: {
  onCreated: () => void
  /** When set, this instructor is fixed and the picker is not rendered. */
  lockedInstructor?: UserSearchResult | null
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [instructor, setInstructor] = useState<UserSearchResult | null>(null)
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0])
  const [yearLevel, setYearLevel] = useState<string>(YEAR_LEVELS[0])
  const years = academicYearOptions(4)
  const [academicYear, setAcademicYear] = useState<string>(years[0])

  // The locked instructor always wins over local picker state, so there is no
  // way for the two to disagree about who this studio is for.
  const effectiveInstructor = lockedInstructor ?? instructor

  const reset = () => {
    setName('')
    setInstructor(null)
    setDepartment(DEPARTMENTS[0])
    setYearLevel(YEAR_LEVELS[0])
    setAcademicYear(years[0])
    setError('')
  }

  const close = () => { reset(); setOpen(false) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Studio name is required'); return }
    if (!effectiveInstructor) { setError('Pick an instructor'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/admin/studios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          instructorUserId: effectiveInstructor.userId,
          department,
          yearLevel,
          academicYear,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to create studio'); return }
      // The studio exists and is owned correctly even when its explore metadata
      // failed to write, so this is a warning rather than an error — but it must
      // not report as a clean success either.
      if (data.metadataApplied === false) {
        toast.error('Studio created, but department/year did not save. Set them from the studio.')
      }
      close()
      onCreated()
    } catch {
      setError('Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
      >
        <Plus className="w-4 h-4" />
        {triggerLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={close}>
          <div
            className="bg-white rounded-xl border border-gray-200 shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900">
                {lockedInstructor ? 'Create studio' : 'Create studio for an instructor'}
              </h3>
              <button type="button" onClick={close} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Studio name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Studio 3 — Housing"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Instructor</label>
                {lockedInstructor ? (
                  <div className="px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {lockedInstructor.fullName || lockedInstructor.email || lockedInstructor.userId}
                    </p>
                    {lockedInstructor.fullName && lockedInstructor.email && (
                      <p className="text-xs text-gray-500 truncate">{lockedInstructor.email}</p>
                    )}
                  </div>
                ) : (
                  <InstructorPicker selected={instructor} onSelect={setInstructor} />
                )}
                <p className="text-xs text-gray-500 mt-1">
                  They become the owner — the studio is theirs, exactly as if they had made it.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                  >
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Year level</label>
                  <select
                    value={yearLevel}
                    onChange={(e) => setYearLevel(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                  >
                    {YEAR_LEVELS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Academic year</label>
                <select
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                >
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={close}
                  className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium text-sm"
                >
                  {loading ? 'Creating…' : 'Create studio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
