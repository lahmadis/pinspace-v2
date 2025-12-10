'use client'

import { useState } from 'react'

export interface NetworkMetadata {
  department: string
  year: string
  instructor: string
}

interface PublishConfirmModalProps {
  workspaceName: string
  isCurrentlyPublic: boolean
  currentMetadata?: NetworkMetadata
  onConfirm: (metadata?: NetworkMetadata) => void
  onCancel: () => void
}

const DEPARTMENTS = [
  'Architecture',
  'Interior Design', 
  'Industrial Design',
]

const YEARS = [
  'Year 1',
  'Year 2',
  'Year 3',
  'Year 4',
  'Masters',
]

export default function PublishConfirmModal({ 
  workspaceName, 
  isCurrentlyPublic,
  currentMetadata,
  onConfirm, 
  onCancel 
}: PublishConfirmModalProps) {
  const [department, setDepartment] = useState(currentMetadata?.department || '')
  const [year, setYear] = useState(currentMetadata?.year || '')
  const [instructor, setInstructor] = useState(currentMetadata?.instructor || '')
  const [errors, setErrors] = useState<{ department?: string; year?: string; instructor?: string }>({})

  const handleConfirm = () => {
    if (isCurrentlyPublic) {
      // Unpublishing - no metadata needed
      onConfirm()
      return
    }

    // Validate fields for publishing
    const newErrors: typeof errors = {}
    if (!department) newErrors.department = 'Please select a department'
    if (!year) newErrors.year = 'Please select a year'
    if (!instructor.trim()) newErrors.instructor = 'Please enter instructor name'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onConfirm({ department, year, instructor: instructor.trim() })
  }

  // If unpublishing, show simple confirmation
  if (isCurrentlyPublic) {
    return (
      <div 
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
        onClick={onCancel}
      >
        <div 
          className="bg-white rounded-xl shadow-2xl max-w-md w-full p-8"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center mb-4">
            <div className="text-6xl mb-2">🔒</div>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
            Remove from Network?
          </h2>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="font-semibold text-gray-900 text-center">{workspaceName}</p>
          </div>

          <div className="mb-6">
            <div className="space-y-2 text-sm text-gray-700">
              <p className="font-medium">This will:</p>
              <ul className="space-y-1 ml-4">
                <li>• Remove the workspace from public network</li>
                <li>• Only members can access it</li>
                <li>• Public links will stop working</li>
              </ul>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-semibold"
            >
              Remove from Network
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Publishing - show form to collect metadata
  return (
    <div 
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div 
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🌐</div>
          <h2 className="text-2xl font-bold text-gray-900">Publish to Network</h2>
          <p className="text-gray-600 mt-1">Share your studio with the WIT community</p>
        </div>

        {/* Studio Name */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
          <p className="font-semibold text-gray-900 text-center">{workspaceName}</p>
        </div>

        {/* Form */}
        <div className="space-y-4 mb-6">
          {/* Department */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Department <span className="text-red-500">*</span>
            </label>
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value)
                setErrors(prev => ({ ...prev, department: undefined }))
              }}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                errors.department ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">Select department...</option>
              {DEPARTMENTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            {errors.department && (
              <p className="text-red-500 text-xs mt-1">{errors.department}</p>
            )}
          </div>

          {/* Year */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Year <span className="text-red-500">*</span>
            </label>
            <select
              value={year}
              onChange={(e) => {
                setYear(e.target.value)
                setErrors(prev => ({ ...prev, year: undefined }))
              }}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                errors.year ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">Select year...</option>
              {YEARS.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {errors.year && (
              <p className="text-red-500 text-xs mt-1">{errors.year}</p>
            )}
          </div>

          {/* Instructor */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Instructor <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={instructor}
              onChange={(e) => {
                setInstructor(e.target.value)
                setErrors(prev => ({ ...prev, instructor: undefined }))
              }}
              placeholder="e.g., Prof. Sarah Lee"
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                errors.instructor ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.instructor && (
              <p className="text-red-500 text-xs mt-1">{errors.instructor}</p>
            )}
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-800">
            <strong>📍 Network Connections:</strong> Studios with the same instructor, year, or department will be connected in the public network visualization.
          </p>
        </div>

        {/* Visibility Warning */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
          <p className="text-xs text-yellow-900">
            ⚠️ <strong>Note:</strong> Anyone can view this studio in the network, but only workspace members can edit or add boards.
          </p>
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
            onClick={handleConfirm}
            className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-semibold"
          >
            Publish to Network
          </button>
        </div>
      </div>
    </div>
  )
}
