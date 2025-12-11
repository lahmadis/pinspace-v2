'use client'

import { useMemo, useState } from 'react'

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6']
const APPEARANCES = ['Explorer', 'Builder', 'Critic']
const DEPARTMENTS = ['Architecture', 'Interior Design', 'Industrial Design']
const YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Masters']

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
  const [appearance, setAppearance] = useState(APPEARANCES[0])
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
        className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col md:flex-row">
          {/* Left: Avatar preview and quick picks */}
          <div className="md:w-2/5 bg-gradient-to-br from-indigo-50 via-white to-slate-50 p-6 border-b md:border-b-0 md:border-r border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-indigo-500 font-semibold">Gallery Mode</p>
                <h3 className="text-2xl font-bold text-slate-900">Create your avatar</h3>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="aspect-square rounded-2xl bg-white shadow-inner border border-slate-200 flex flex-col items-center justify-center gap-4">
              <div 
                className="w-28 h-28 rounded-full flex items-center justify-center text-white font-bold text-xl transition-all"
                style={avatarPreviewStyle}
              >
                {appearance[0]}
              </div>
              <div className="text-center px-6">
                <p className="text-sm text-slate-600">Pick a color and vibe for your avatar before entering the 3D gallery.</p>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-semibold mb-3">Quick colors</p>
              <div className="grid grid-cols-6 gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-10 rounded-xl border-2 transition-all ${color === c ? 'border-indigo-500 shadow-md scale-105' : 'border-transparent hover:border-slate-200'}`}
                    style={{ backgroundColor: c }}
                    aria-label={`Select color ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Right: Form */}
          <div className="md:w-3/5 p-6 space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">Appearance</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {APPEARANCES.map((option) => (
                  <button
                    key={option}
                    onClick={() => setAppearance(option)}
                    className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                      appearance === option
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm'
                        : 'border-slate-200 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50/40'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                >
                  <option value="">Select department...</option>
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">Year</label>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                >
                  <option value="">Select year...</option>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/60 text-sm text-indigo-900">
              <p className="font-semibold">What happens next?</p>
              <p className="text-indigo-800 mt-1">We will drop you into the new Gallery Mode to explore studios in 3D space.</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={onClose}
                className="sm:flex-1 px-4 py-3 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleEnter}
                disabled={!department || !year}
                className="sm:flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors font-semibold disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
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






