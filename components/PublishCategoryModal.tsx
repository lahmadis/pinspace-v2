'use client'

import { useRef, useState } from 'react'

import { Button, Dialog, Select, StatusState } from '@/components/ui'
import { DEPARTMENTS, YEAR_LEVELS, yearLabel } from '@/lib/constants/departments'

type Option = { label: string; value: string }

// Derived rather than hand-listed. Nothing imports this modal today, which is
// exactly why its copies were the ones left behind when the canonical lists
// changed — deriving them means a revived caller gets the current lists.
const DEPT_OPTIONS: Option[] = DEPARTMENTS.map((d) => ({ label: d, value: d }))

const YEAR_OPTIONS: Option[] = YEAR_LEVELS.map((y) => ({ label: yearLabel(y), value: y }))

interface PublishCategoryModalProps {
  workspaceName: string
  defaultValues?: {
    department?: string
    year?: string
  }
  onConfirm: (metadata: { department: string; year: string }) => void
  onCancel: () => void
}

export default function PublishCategoryModal({
  workspaceName,
  defaultValues,
  onConfirm,
  onCancel,
}: PublishCategoryModalProps) {
  const [department, setDepartment] = useState(defaultValues?.department || '')
  const [year, setYear] = useState(defaultValues?.year || '')
  const [error, setError] = useState<string | null>(null)
  const confirmingRef = useRef(false)
  const errorId = 'publish-category-error'

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (confirmingRef.current) return
    if (!department || !year) {
      setError('Select a department and grade level to publish this studio.')
      return
    }

    confirmingRef.current = true
    onConfirm({ department, year })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onCancel() }}
      title="Publish to network"
      description={<>Choose where <strong>{workspaceName}</strong> appears in the public network.</>}
      className="max-w-lg pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>button.absolute]:h-11 [&>button.absolute]:w-11"
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="publish-category-department" className="mb-1.5 block text-sm font-semibold text-text-primary">
            Department
          </label>
          <Select
            id="publish-category-department"
            value={department}
            onChange={(event) => {
              setDepartment(event.target.value)
              setError(null)
            }}
            aria-invalid={Boolean(error && !department)}
            aria-describedby={error && !department ? errorId : undefined}
          >
            <option value="">Select a department</option>
            {DEPT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="publish-category-year" className="mb-1.5 block text-sm font-semibold text-text-primary">
            Grade Level
          </label>
          <Select
            id="publish-category-year"
            value={year}
            onChange={(event) => {
              setYear(event.target.value)
              setError(null)
            }}
            aria-invalid={Boolean(error && !year)}
            aria-describedby={error && !year ? errorId : undefined}
          >
            <option value="">Select a year</option>
            {YEAR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>

        <div className="rounded-pinspace border border-border bg-background-lighter p-4 text-sm text-text-secondary">
          <p className="font-semibold text-text-primary">Network path</p>
          <p className="mt-1 break-words">{department || 'Department'} → {year || 'Year'} → {workspaceName}</p>
        </div>

        {error && <StatusState id={errorId} status="error" title={error} className="p-3 text-sm" />}

        <p className="rounded-pinspace border border-border bg-primary-muted p-3 text-sm text-text-primary">
          Visitors can view the studio after publication. Editing remains limited to members.
        </p>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Publish to network</Button>
        </div>
      </form>
    </Dialog>
  )
}
