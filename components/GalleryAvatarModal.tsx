'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6']
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
}

export default function GalleryAvatarModal({ isOpen, onClose, onEnter }: GalleryAvatarModalProps) {
  const [color, setColor] = useState(COLORS[0])
  const appearance = APPEARANCES[0]
  const [department, setDepartment] = useState('')
  const [year, setYear] = useState('')

  const avatarPreviewStyle = useMemo(
    () => ({
      background: `radial-gradient(circle at 30% 30%, #ffffff80 0%, transparent 35%), ${color}`,
      boxShadow: `0 10px 25px ${color}33`
    }),
    [color]
  )

  if (!isOpen) return null

  const handleEnter = () => {
    if (!department || !year) return
    onEnter({ color, appearance, department, year })
  }

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-2xl rounded-2xl border border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col md:flex-row">
          {/* Left: Avatar preview and quick picks */}
          <div className="md:w-2/5 bg-gradient-to-br from-primary/5 to-primary/10 p-8 border-b md:border-b-0 md:border-r border-border">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold">Gallery Mode</p>
                <h3 className="text-xl font-semibold text-text-primary mt-1">Create your avatar</h3>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg border border-border flex items-center justify-center hover:bg-background-lighter transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-text-secondary" />
              </button>
            </div>

            <div className="aspect-square rounded-xl bg-background-light shadow-inner border border-border flex items-center justify-center mb-6">
              <div 
                className="w-32 h-32 rounded-full flex items-center justify-center text-white font-bold text-xl transition-all"
                style={avatarPreviewStyle}
              >
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-text-muted font-semibold mb-3">Quick Colors</p>
              <div className="grid grid-cols-6 gap-2.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-11 rounded-lg border-2 transition-all ${
                      color === c 
                        ? 'border-primary shadow-md scale-105 ring-2 ring-primary/20' 
                        : 'border-transparent hover:border-border hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Select color ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Right: Form */}
          <div className="md:w-3/5 p-8 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm bg-background-light transition-all hover:border-primary/50"
                >
                  <option value="">Select department...</option>
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Year</label>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm bg-background-light transition-all hover:border-primary/50"
                >
                  <option value="">Select year...</option>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={onClose}
                className="sm:flex-1 px-5 py-2.5 bg-background-light hover:bg-background-lighter text-text-primary rounded-lg border border-border transition-all font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleEnter}
                disabled={!department || !year}
                className="sm:flex-1 px-5 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-all font-semibold text-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
              >
                Enter Gallery
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}






