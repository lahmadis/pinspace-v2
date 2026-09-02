'use client'

import { useRef, useState } from 'react'

import { Button, Dialog, Input, Select } from '@/components/ui'
import { currentTerm, termOptions } from '@/lib/term'
import { DEPARTMENTS, YEAR_LEVELS, yearLabel } from '@/lib/constants/departments'
import { STUDIOS } from '@/lib/constants/studios'

export interface NetworkMetadata {
  department: string
  year: string
  /**
   * Which studio this section belongs to (lib/constants/studios).
   *
   * Optional on the TYPE, required by this form. Sections created through the
   * new-section dialog always carry one; workspaces that predate it do not, and
   * this modal is where they get one — so the field has to be able to arrive
   * empty and leave filled.
   */
  studio?: string
  instructor: string
  /**
   * The SEMESTER this section runs in — 'Fall 2025'. Still named academicYear:
   * it is the wire name for `workspaces.academic_year`, which now carries a
   * term. See lib/term.
   */
  academicYear: string
}

interface PublishConfirmModalProps {
  workspaceName: string
  isCurrentlyPublic: boolean
  /**
   * What this dialog is being used AS.
   *
   * 'publish' is the original job: a room is going public and its section has
   * never been filed, so these details are collected as a condition of
   * publishing. 'settings' is the same form reached deliberately from the
   * spaces page to CHANGE a filing that already exists — nothing is being
   * published, and titling it "Publish to network" made an edit look like it
   * would go live.
   *
   * Only the wording differs; the fields, the validation and the save are one
   * implementation, which is what keeps the two from drifting.
   */
  variant?: 'publish' | 'settings'
  currentMetadata?: NetworkMetadata
  onConfirm: (metadata?: NetworkMetadata) => void
  onCancel: () => void
}

// Both lists now come from lib/constants/departments, which is what CLAUDE.md
// asks for and what keeps this modal's options in step with the rest of the app.

type FieldErrors = Partial<Record<'department' | 'year' | 'studio' | 'term' | 'instructor', string>>

export default function PublishConfirmModal({
  workspaceName,
  isCurrentlyPublic,
  variant = 'publish',
  currentMetadata,
  onConfirm,
  onCancel,
}: PublishConfirmModalProps) {
  const [department, setDepartment] = useState(currentMetadata?.department || '')
  const [year, setYear] = useState(currentMetadata?.year || '')
  const [studio, setStudio] = useState(currentMetadata?.studio || '')
  const [term, setTerm] = useState(currentMetadata?.academicYear || currentTerm())
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
    if (!year) newErrors.year = 'Select a grade level.'
    if (!studio) newErrors.studio = 'Select a class.'
    if (!term) newErrors.term = 'Select a semester.'
    if (!instructor.trim()) newErrors.instructor = 'Enter the instructor name.'
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    confirmingRef.current = true
    onConfirm({ department, year, studio, academicYear: term, instructor: instructor.trim() })
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
          <div className="rounded-pinspace border border-border bg-background-lighter p-4 text-sm text-text-secondary">
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
      title={variant === 'settings' ? 'Section settings' : 'Publish to network'}
      // Named but not drawn in the settings variant: it opens from a button
      // inside a sheet already headed "Section Settings", listing the very
      // fields below — so a heading and a subtitle repeating both is the third
      // and fourth time. Publish still shows its own, since that one is reached
      // cold from a room and has to say what it is about to do.
      hideTitle={variant === 'settings'}
      description={
        variant === 'settings'
          ? undefined
          : <>Add public discovery details for <strong>{workspaceName}</strong>.</>
      }
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

        {/* Department, Semester, Grade Level, Class, Instructor — the
            order the section is actually filed in, widest bucket first. It used
            to run Department, Grade Level, Class, Semester, which put the grade
            level on one side of Class and asked for the term last, after the
            two things the term scopes. */}
        <Field label="Semester" id="publish-semester" error={errors.term}>
          <Select
            id="publish-semester"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value)
              setErrors((previous) => ({ ...previous, term: undefined }))
            }}
            aria-invalid={Boolean(errors.term)}
            aria-describedby={errors.term ? 'publish-semester-error' : undefined}
          >
            <option value="">Select semester</option>
            {termOptions().map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>

        {/* GRADE LEVEL, not "Year" — the options are Freshman…Masters, and
            calling them "Year" next to a term field read as two fields about
            the same thing. The stored values are untouched; only the label
            changes. */}
        <Field label="Grade Level" id="publish-year" error={errors.year}>
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
            <option value="">Select grade level</option>
            {/* value stays the stored 'Year N'; only the text changes. */}
            {YEAR_LEVELS.map((item) => (
              <option key={item} value={item}>{yearLabel(item)}</option>
            ))}
          </Select>
        </Field>

        {/* The drill-down level between year and section. Required here as
            well as in the create dialog: a published workspace with no studio
            has no bucket to appear in, so it would reach the network and then
            be unreachable from it. */}
        <Field label="Class" id="publish-studio" error={errors.studio}>
          <Select
            id="publish-studio"
            value={studio}
            onChange={(event) => {
              setStudio(event.target.value)
              setErrors((previous) => ({ ...previous, studio: undefined }))
            }}
            aria-invalid={Boolean(errors.studio)}
            aria-describedby={errors.studio ? 'publish-studio-error' : undefined}
          >
            <option value="">Select class</option>
            {STUDIOS.map((item) => <option key={item} value={item}>{item}</option>)}
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

        {variant === 'publish' && (
          <p className="rounded-pinspace border border-border bg-primary-muted p-3 text-sm text-text-primary">
            Anyone can view this studio in the network. Only workspace members can edit or add boards.
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit">{variant === 'settings' ? 'Save' : 'Publish to network'}</Button>
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
