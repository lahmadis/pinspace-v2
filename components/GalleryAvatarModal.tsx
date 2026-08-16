'use client'

import { useMemo, useRef, useState } from 'react'
import { Button, Dialog, Select } from '@/components/ui'

// Named 3D avatar material colors maintain readable contrast in the gallery scene.
export const GALLERY_AVATAR_COLOR_OPTIONS = {
  yellow: { name: 'PinSpace yellow', value: '#FFC800' },
  green: { name: 'Deep green', value: '#14705C' },
  forest: { name: 'Forest', value: '#0A2F28' },
  ocean: { name: 'Ocean blue', value: '#176B87' },
  terracotta: { name: 'Terracotta', value: '#A84432' },
  umber: { name: 'Umber', value: '#73563C' },
} as const
export const DEFAULT_GALLERY_AVATAR_COLOR = GALLERY_AVATAR_COLOR_OPTIONS.yellow.value
const AVATAR_COLORS = Object.values(GALLERY_AVATAR_COLOR_OPTIONS)
const APPEARANCES = ['Explorer', 'Builder', 'Critic']
const DEPARTMENTS = ['Architecture', 'Interior Design', 'Industrial Design']
const YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters']

export interface AvatarFormValues {
  color: string
  appearance: string
  department: string
  year: string
}

interface GalleryAvatarModalProps {
  isOpen: boolean
  onClose: () => void
  onEnter: (values: AvatarFormValues) => void
  pending?: boolean
}

export default function GalleryAvatarModal({ isOpen, onClose, onEnter, pending = false }: GalleryAvatarModalProps) {
  const [color, setColor] = useState<string>(DEFAULT_GALLERY_AVATAR_COLOR)
  const appearance = APPEARANCES[0]
  const [department, setDepartment] = useState('')
  const [year, setYear] = useState('')
  const departmentRef = useRef<HTMLSelectElement>(null)

  const avatarPreviewStyle = useMemo(() => ({
    backgroundColor: color,
    boxShadow: '0 10px 25px rgb(var(--color-forest) / 0.18)',
  }), [color])

  const handleEnter = () => {
    if (pending || !department || !year) return
    onEnter({ color, appearance, department, year })
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open && !pending) onClose() }}
      title="Create your gallery avatar"
      description="Choose how you will appear, then enter the shared 3D gallery."
      initialFocusRef={departmentRef}
      closeOnOutsideClick={!pending}
      hideCloseButton={pending}
      className="max-w-2xl overflow-x-hidden"
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section aria-labelledby="avatar-colors-heading" className="rounded-pinspace-lg border border-border bg-background p-5">
          <div className="mx-auto mb-5 flex aspect-square w-full max-w-48 items-center justify-center rounded-pinspace-lg border border-border bg-background-light">
            <div className="h-28 w-28 rounded-full motion-safe:transition-colors" style={avatarPreviewStyle} aria-hidden="true" />
          </div>
          <fieldset disabled={pending}>
            <legend id="avatar-colors-heading" className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">Avatar colour</legend>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {AVATAR_COLORS.map((choice) => (
                <label key={choice.value} className="cursor-pointer rounded-pinspace focus-within:outline-none focus-within:ring-2 focus-within:ring-accent">
                  <input type="radio" name="avatar-color" value={choice.value} checked={color === choice.value} onChange={() => setColor(choice.value)} className="sr-only" />
                  <span className="flex min-h-11 items-center justify-center rounded-pinspace border-2 px-2 text-center text-[11px] font-semibold" style={{ backgroundColor: choice.value, borderColor: color === choice.value ? 'rgb(var(--color-ink))' : 'transparent', color: choice.value === DEFAULT_GALLERY_AVATAR_COLOR ? 'rgb(var(--color-ink))' : 'white' }}>
                    {choice.name}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <div className="space-y-5">
          <div>
            <label htmlFor="gallery-department" className="mb-2 block text-sm font-semibold text-text-primary">Department</label>
            <Select ref={departmentRef} id="gallery-department" value={department} onChange={(event) => setDepartment(event.target.value)} disabled={pending}>
              <option value="">Select department…</option>
              {DEPARTMENTS.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="gallery-year" className="mb-2 block text-sm font-semibold text-text-primary">Year</label>
            <Select id="gallery-year" value={year} onChange={(event) => setYear(event.target.value)} disabled={pending}>
              <option value="">Select year…</option>
              {YEARS.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </div>
          <p className="text-sm text-text-secondary">Keyboard: arrow keys move through choices. In the gallery, use the on-screen controls as a touch alternative.</p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={handleEnter} loading={pending} disabled={!department || !year || pending}>
              {pending ? 'Entering gallery…' : 'Enter gallery'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
