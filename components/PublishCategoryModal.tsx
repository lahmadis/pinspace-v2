'use client'

import { useState } from 'react'

type Option = { label: string; value: string }

const DEPT_OPTIONS: Option[] = [
  { label: 'Architecture', value: 'Architecture' },
  { label: 'Interior Design', value: 'Interior Design' },
  { label: 'Industrial Design', value: 'Industrial Design' },
]

const YEAR_OPTIONS: Option[] = [
  { label: 'Year 1', value: 'Year 1' },
  { label: 'Year 2', value: 'Year 2' },
  { label: 'Year 3', value: 'Year 3' },
  { label: 'Year 4', value: 'Year 4' },
  { label: 'Masters', value: 'Masters' },
]

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

  const handleSubmit = () => {
    if (!department || !year) {
      setError('Please select department and year')
      return
    }

    onConfirm({
      department,
      year,
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
        onClick={onCancel}
      >
        {/* Modal */}
        <div 
          className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-8"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-gray-500 font-semibold uppercase">Publish to WIT Network</p>
              <h2 className="text-2xl font-bold text-gray-900 mt-1">{workspaceName}</h2>
            </div>
            <button
              onClick={onCancel}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <div className="space-y-5">
            {/* Department */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department *</label>
              <div className="space-y-2">
                <select
                  value={department}
                  onChange={(e) => {
                    setDepartment(e.target.value)
                    setError(null)
                  }}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4444ff] focus:border-transparent"
                >
                  <option value="">Select a department</option>
                  {DEPT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Year */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year *</label>
              <div className="space-y-2">
                <select
                  value={year}
                  onChange={(e) => {
                    setYear(e.target.value)
                    setError(null)
                  }}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4444ff] focus:border-transparent"
                >
                  <option value="">Select a year</option>
                  {YEAR_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Preview */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-gray-800 mb-1">Preview:</p>
              <p className="text-sm text-gray-700">
                {(department || 'Department')} → {(year || 'Year')} → {workspaceName}
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {error}
              </div>
            )}

            {/* Info */} 
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900 flex gap-2">
              <span className="text-lg">ℹ️</span>
              <div>
                This studio will appear in the WIT public network (read-only for visitors). Only members can edit.
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="flex-1 px-4 py-3 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] transition-colors font-semibold"
              >
                Publish to Network
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

