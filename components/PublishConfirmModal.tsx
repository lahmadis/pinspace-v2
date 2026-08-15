'use client'

import { useRef, useState } from 'react'

import { Button, Dialog, Input, Select } from '@/components/ui'
import { academicYearOptions, currentAcademicYear } from '@/lib/academicYear'

export interface NetworkMetadata {
  department: string
  year: string
  instructor: string
  academicYear: string
}

interface PublishConfirmModalProps {
  workspaceName: string
  isCurrentlyPublic: boolean
  currentMetadata?: NetworkMetadata
  onConfirm: (metadata?: NetworkMetadata) => void
  onCancel: () => void
}

const DEPARTMENTS = [
  'Aerospace Engineering',
  'Architecture',
  'Civil Engineering',
  'Electrical Engineering',
  'Industrial Design',
  'Interior Design',
  'Mechanical Engineering',
  'Robotics Engineering',
]

const YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters']

type FieldErrors = Partial<Record<'department' | 'year' | 'academicYear' | 'instructor', string>>

export default function PublishConfirmModal({
  workspaceName,
  isCurrentlyPublic,
  currentMetadata,
  onConfirm,
  onCancel,
}: PublishConfirmModalProps) {
  const [department, setDepartment] = useState(currentMetadata?.department || '')
  const [year, setYear] = useState(currentMetadata?.year || '')
  const [academicYear, setAcademicYear] = useState(currentMetadata?.academicYear || currentAcademicYear())
  const [instructor, setInstructor] = useState(currentMetadata?.instructor || '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const confirmingRef = useRef(false)

  const handleConfirm = (event: React.FormEvent) => {
    event.preventDefault()
    if (confirmingRef.current) return

    if (isCurrentlyPublic) {
      confirmingRef.current = true
      onConfirm()
      return
    }

    const newErrors: FieldErrors = {}
    if (!department) newErrors.department = 'Select a department.'
    if (!year) newErrors.year = 'Select a year.'
    if (!academicYear) newErrors.academicYear = 'Select an academic year.'
    if (!instructor.trim()) newErrors.instructor = 'Enter the instructor name.'
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    confirmingRef.current = true
    onConfirm({ department, year, academicYear, instructor: instructor.trim() })
  }

  if (isCurrentlyPublic) {
    return (
      <Dialog
        open
        onOpenChange={(open) => { if (!open) onCancel() }}
        title="Remove from network?"
        description={<>Make <strong>{workspaceName}</strong> private again.</>}
        className="max-w-md pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>button.absolute]:h-11 [&>button.absolute]:w-11"
      >
        <form onSubmit={handleConfirm} className="space-y-5">
          <div className="rounded-kova border border-border bg-background-lighter p-4 text-sm text-text-secondary">
            <p className="font-semibold text-text-primary">This will:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Remove the workspace from the public network</li>
              <li>Limit access to members</li>
              <li>Public links will stop working</li>
            </ul>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="danger">Remove from network</Button>
          </div>
        </form>
      </Dialog>
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onCancel() }}
      title="Publish to network"
      description={<>Add public discovery details for <strong>{workspaceName}</strong>.</>}
      className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] max-w-lg pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>button.absolute]:h-11 [&>button.absolute]:w-11"
    >
      <form onSubmit={handleConfirm} className="space-y-4" noValidate>
        <Field label="Department" id="publish-department" error={errors.department}>
          <Select
            id="publish-department"
            value={department}
            onChange={(event) => {
              setDepartment(event.target.value)
              setErrors((previous) => ({ ...previous, department: undefined }))
            }}
            aria-invalid={Boolean(errors.department)}
            aria-describedby={errors.department ? 'publish-department-error' : undefined}
          >
            <option value="">Select department</option>
            {DEPARTMENTS.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>

        <Field label="Year" id="publish-year" error={errors.year}>
          <Select
            id="publish-year"
            value={year}
            onChange={(event) => {
              setYear(event.target.value)
              setErrors((previous) => ({ ...previous, year: undefined }))
            }}
            aria-invalid={Boolean(errors.year)}
            aria-describedby={errors.year ? 'publish-year-error' : undefined}
          >
            <option value="">Select year</option>
            {YEARS.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>

        <Field label="Academic year" id="publish-academic-year" error={errors.academicYear}>
          <Select
            id="publish-academic-year"
            value={academicYear}
            onChange={(event) => {
              setAcademicYear(event.target.value)
              setErrors((previous) => ({ ...previous, academicYear: undefined }))
            }}
            aria-invalid={Boolean(errors.academicYear)}
            aria-describedby={errors.academicYear ? 'publish-academic-year-error' : undefined}
          >
            <option value="">Select academic year</option>
            {academicYearOptions().map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>

        <Field label="Instructor" id="publish-instructor" error={errors.instructor}>
          <Input
            id="publish-instructor"
            type="text"
            value={instructor}
            maxLength={80}
            onChange={(event) => {
              setInstructor(event.target.value)
              setErrors((previous) => ({ ...previous, instructor: undefined }))
            }}
            placeholder="e.g. Prof. Sarah Lee"
            aria-invalid={Boolean(errors.instructor)}
            aria-describedby={errors.instructor ? 'publish-instructor-error' : undefined}
          />
        </Field>

        <p className="rounded-kova border border-border bg-primary-muted p-3 text-sm text-text-primary">
          Anyone can view this studio in the network. Only workspace members can edit or add boards.
        </p>

        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Publish to network</Button>
        </div>
      </form>
    </Dialog>
  )
}

function Field({
  label,
  id,
  error,
  children,
}: {
  label: string
  id: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-text-primary">{label}</label>
      {children}
      {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-semibold text-text-primary">{error}</p>}
    </div>
  )
}
