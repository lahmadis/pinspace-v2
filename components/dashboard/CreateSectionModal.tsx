'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button, Dialog, Input, Select, StatusState } from '@/components/ui'
import { academicYearOptions } from '@/lib/academicYear'
import { DEPARTMENTS, YEAR_LEVELS, yearLabel } from '@/lib/constants/departments'
import { STUDIOS } from '@/lib/constants/studios'
import { formatSectionName, normalizeSectionNumber } from '@/lib/sections'
import { toast } from '@/lib/toast'

interface CreateSectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The instructor's stored name, used to pre-fill the name field. */
  defaultInstructorName?: string | null
}

/**
 * Create a section.
 *
 * Replaces "New Studio" for instructors. The distinction it introduces: a
 * STUDIO is a taxonomy level shared by a whole department (see
 * lib/constants/studios), and a SECTION is one instructor's instance of it. An
 * instructor was previously creating the studio itself and naming it by hand,
 * which is why the network filled up with "Studio 06", "studio 6 - Fall", and
 * "ARCH 3000" all meaning the same bucket.
 *
 * Two things follow from that, and they are the whole point of this dialog:
 *
 *  1. The NAME is generated, never typed — "Section 03 - Lahmadi". The
 *     instructor supplies a number and their own name; lib/sections builds the
 *     rest, and the success toast reports the name that was stored.
 *
 *  2. The network filing is collected HERE, not at publish time. Department,
 *     year, studio, term and instructor were four questions in the publish
 *     modal that an instructor met weeks later, out of context, on a studio
 *     already full of work — and skipping them left the section invisible to
 *     the explore filters. Answered at creation, the publish toggle becomes a
 *     pure yes/no and that modal never appears again.
 *
 * Creating does NOT publish. The section is filed and ready, and the instructor
 * flips it public from the workspace settings page when it has something in it.
 */
export default function CreateSectionModal({
  open,
  onOpenChange,
  defaultInstructorName,
}: CreateSectionModalProps) {
  const router = useRouter()
  const formId = useId()
  const years = useMemo(() => academicYearOptions(4), [])

  const [sectionNumber, setSectionNumber] = useState('')
  const [studio, setStudio] = useState<string>(STUDIOS[0])
  const [instructorName, setInstructorName] = useState(defaultInstructorName ?? '')
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0])
  const [yearLevel, setYearLevel] = useState<string>(YEAR_LEVELS[0])
  const [academicYear, setAcademicYear] = useState<string>(years[0])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  /**
   * In-flight guard as a ref, not the `loading` state: two clicks in the same
   * tick both read the render's stale `loading === false`, so only a value set
   * synchronously can stop the second POST. Same reason /workspace/new carries
   * one — this is the duplicate-workspace bug, and a duplicate SECTION is worse
   * because the two would share a generated name.
   */
  const submittingRef = useRef(false)

  const ids = {
    number: `${formId}-number`,
    studio: `${formId}-studio`,
    instructor: `${formId}-instructor`,
    department: `${formId}-department`,
    year: `${formId}-year`,
    academicYear: `${formId}-academic-year`,
    error: `${formId}-error`,
  }

  // Null until both halves are usable, which is also what gates submit — the
  // name is generated, never typed, so there is nothing to create without it.
  const generatedName = formatSectionName(sectionNumber, instructorName)

  const reset = () => {
    setSectionNumber('')
    setStudio(STUDIOS[0])
    setInstructorName(defaultInstructorName ?? '')
    setDepartment(DEPARTMENTS[0])
    setYearLevel(YEAR_LEVELS[0])
    setAcademicYear(years[0])
    setError('')
  }

  const setDialogOpen = (next: boolean) => {
    if (!next && loading) return
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return
    setError('')

    if (!normalizeSectionNumber(sectionNumber)) {
      setError('Enter a section number from 1 to 99.')
      return
    }
    if (!instructorName.trim()) {
      setError('Enter the instructor name.')
      return
    }
    const name = generatedName
    if (!name) {
      setError('Could not build a section name from that number and name.')
      return
    }

    submittingRef.current = true
    setLoading(true)
    try {
      // No creatorName or institution_slug, which /workspace/new still sends:
      // POST /api/workspaces reads neither. The owner's display name comes from
      // the session and the organization from the caller's own profile, which
      // is the correct boundary — a client-supplied org on a create call is a
      // request to file a section under someone else's school.
      const payload: Record<string, string> = {
        name,
        type: 'class',
        department,
        yearLevel,
        studio,
        instructor: instructorName.trim(),
        academicYear,
      }

      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || data?.details || 'Failed to create section')
      }

      const workspaceId = data.workspace?.id || data.id
      if (!workspaceId) throw new Error('Section created but no ID returned')

      toast.success(`${name} created`)
      reset()
      onOpenChange(false)
      // The section's own spaces page, not the dashboard: the next thing an
      // instructor does with a new section is add students and rooms to it,
      // and both live there.
      router.push(`/workspace/${workspaceId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      // Cleared on BOTH paths — a failed create must leave the dialog usable
      // for a retry, and the ref is what would otherwise lock it shut.
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setDialogOpen}
      closeOnOutsideClick={!loading}
      hideCloseButton={loading}
      title="New Section"
      description="Set up your section of a class. These details file it in the network, so you won't be asked again when you publish."
      className="max-w-lg pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Class first, then the number. The class is the thing being
            taught and the one an instructor thinks of first; the section
            number only says which run of it this is, and reading "Section 03"
            before knowing 03 of WHAT is backwards. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.studio} className="mb-1 block text-sm font-semibold text-text-primary">
              Class
            </label>
            <Select
              id={ids.studio}
              value={studio}
              disabled={loading}
              onChange={(event) => setStudio(event.target.value)}
            >
              {STUDIOS.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor={ids.number} className="mb-1 block text-sm font-semibold text-text-primary">
              Section #
            </label>
            <Input
              id={ids.number}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              value={sectionNumber}
              onChange={(event) => {
                // Digits only at the source. Stripping here rather than
                // validating on submit means the generated name can never be
                // one the server would reject.
                setSectionNumber(event.target.value.replace(/\D/g, ''))
                setError('')
              }}
              onBlur={() => {
                // Pad to two digits on the way out of the field, not on every
                // keystroke: padding "1" to "01" mid-typing turns the next
                // digit into "012", which maxLength truncates back to "01" —
                // Section 12 would be impossible to type. Leaving the field is
                // the first moment the number is finished.
                const padded = normalizeSectionNumber(sectionNumber)
                if (padded) setSectionNumber(padded)
              }}
              placeholder="03"
              disabled={loading}
            />
          </div>
        </div>

        <div>
          <label htmlFor={ids.instructor} className="mb-1 block text-sm font-semibold text-text-primary">
            Instructor
          </label>
          <Input
            id={ids.instructor}
            type="text"
            autoComplete="name"
            maxLength={80}
            value={instructorName}
            onChange={(event) => {
              setInstructorName(event.target.value)
              setError('')
            }}
            placeholder="e.g. Sarah Lahmadi"
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.department} className="mb-1 block text-sm font-semibold text-text-primary">
              Department
            </label>
            <Select
              id={ids.department}
              value={department}
              disabled={loading}
              onChange={(event) => setDepartment(event.target.value)}
            >
              {DEPARTMENTS.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor={ids.year} className="mb-1 block text-sm font-semibold text-text-primary">
              Year
            </label>
            <Select
              id={ids.year}
              value={yearLevel}
              disabled={loading}
              onChange={(event) => setYearLevel(event.target.value)}
            >
              {YEAR_LEVELS.map((item) => <option key={item} value={item}>{yearLabel(item)}</option>)}
            </Select>
          </div>
        </div>

        <div>
          <label htmlFor={ids.academicYear} className="mb-1 block text-sm font-semibold text-text-primary">
            Academic Year
          </label>
          <Select
            id={ids.academicYear}
            value={academicYear}
            disabled={loading}
            onChange={(event) => setAcademicYear(event.target.value)}
          >
            {years.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </div>

        {error && <StatusState id={ids.error} role="alert" status="error" title={error} />}

        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>Create Section</Button>
        </div>
      </form>
    </Dialog>
  )
}
