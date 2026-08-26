'use client'

import { useId, useState } from 'react'
import { Plus } from 'lucide-react'

import { Button, Dialog, Input, Select, StatusState } from '@/components/ui'
import { academicYearOptions } from '@/lib/academicYear'
import { DEPARTMENTS, YEAR_LEVELS } from '@/lib/constants/departments'
import { toast } from '@/lib/toast'
import { createStudioSchema } from '@/lib/validations/admin'
import { createAdminStudioApi } from '@/lib/api/admin'

import InstructorPicker, { type UserSearchResult } from './InstructorPicker'

export default function CreateStudioForm({
  onCreated,
  lockedInstructor = null,
  triggerLabel = 'New studio',
}: {
  onCreated: () => void
  lockedInstructor?: UserSearchResult | null
  triggerLabel?: string
}) {
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [instructor, setInstructor] = useState<UserSearchResult | null>(null)
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0])
  const [yearLevel, setYearLevel] = useState<string>(YEAR_LEVELS[0])
  const years = academicYearOptions(4)
  const [academicYear, setAcademicYear] = useState<string>(years[0])
  const effectiveInstructor = lockedInstructor ?? instructor

  const ids = {
    name: `${formId}-name`,
    instructor: `${formId}-instructor`,
    department: `${formId}-department`,
    year: `${formId}-year`,
    academicYear: `${formId}-academic-year`,
    error: `${formId}-error`,
  }

  const reset = () => {
    setName('')
    setInstructor(null)
    setDepartment(DEPARTMENTS[0])
    setYearLevel(YEAR_LEVELS[0])
    setAcademicYear(years[0])
    setError('')
  }

  const setDialogOpen = (next: boolean) => {
    if (!next && loading) return
    if (!next) reset()
    setOpen(next)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loading) return
    setError('')

    const parseResult = createStudioSchema.safeParse({
      name,
      instructorUserId: effectiveInstructor?.userId,
      department,
      yearLevel,
      academicYear,
    })

    if (!parseResult.success) {
      setError(parseResult.error.issues[0]?.message || 'Invalid form input')
      return
    }

    setLoading(true)
    try {
      const data = await createAdminStudioApi(parseResult.data)
      if (data.metadataApplied === false) {
        toast.error('Studio created, but department/year did not save. Set them from the studio.')
      } else {
        toast.success('Studio created successfully')
      }
      reset()
      setOpen(false)
      onCreated()
    } catch (err: any) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Button type="button" className="min-h-11 h-11 px-4 font-semibold inline-flex items-center gap-2" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {triggerLabel}
      </Button>

      <Dialog
        open={open}
        onOpenChange={setDialogOpen}
        closeOnOutsideClick={!loading}
        hideCloseButton={loading}
        title={lockedInstructor ? 'Create studio' : 'Create studio for an instructor'}
        description="Provision a studio and assign its owner and explore metadata."
      >
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor={ids.name} className="mb-1 block text-sm font-semibold text-text-primary">Studio name</label>
            <Input
              id={ids.name}
              type="text"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Studio 3 — Housing"
              disabled={loading}
              aria-invalid={error === 'Studio name is required'}
              aria-describedby={error === 'Studio name is required' ? ids.error : undefined}
            />
          </div>

          {lockedInstructor ? (
            <div>
              <span id={`${ids.instructor}-label`} className="mb-1 block text-sm font-semibold text-text-primary">Instructor</span>
              <div aria-labelledby={`${ids.instructor}-label`} className="min-w-0 rounded-pinspace border border-border bg-background-lighter px-3 py-2">
                <p className="break-words text-sm font-semibold text-text-primary">
                  {lockedInstructor.fullName || lockedInstructor.email || lockedInstructor.userId}
                </p>
                {lockedInstructor.fullName && lockedInstructor.email && (
                  <p className="break-all text-xs text-text-secondary">{lockedInstructor.email}</p>
                )}
              </div>
            </div>
          ) : (
            <InstructorPicker selected={instructor} onSelect={setInstructor} id={ids.instructor} label="Instructor" invalid={error === 'Pick an instructor'} describedBy={error === 'Pick an instructor' ? ids.error : undefined} />
          )}
          <p className="text-xs text-text-secondary">They become the owner, exactly as if they had created the studio.</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={ids.department} className="mb-1 block text-sm font-semibold text-text-primary">Department</label>
              <Select id={ids.department} value={department} disabled={loading} onChange={(event) => setDepartment(event.target.value)}>
                {DEPARTMENTS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>
            <div>
              <label htmlFor={ids.year} className="mb-1 block text-sm font-semibold text-text-primary">Year level</label>
              <Select id={ids.year} value={yearLevel} disabled={loading} onChange={(event) => setYearLevel(event.target.value)}>
                {YEAR_LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>
          </div>

          <div>
            <label htmlFor={ids.academicYear} className="mb-1 block text-sm font-semibold text-text-primary">Academic year</label>
            <Select id={ids.academicYear} value={academicYear} disabled={loading} onChange={(event) => setAcademicYear(event.target.value)}>
              {years.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </div>

          {error && (
            <StatusState id={ids.error} role="alert" status="error" title={error} />
          )}

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" loading={loading}>Create studio</Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
