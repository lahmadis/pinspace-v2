'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { generateOwnerColor } from '@/lib/ownerColors'

export default function UploadPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true)
  
  const [formData, setFormData] = useState({
    studentName: '',
    studentEmail: '',
    title: '',
    description: '',
    workspaceId: '',
    tags: ''
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      fetchWorkspaces()
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      fetchWorkspaces()
    })
    
    return () => subscription.unsubscribe()
  }, [router])

  const fetchWorkspaces = async () => {
    try {
      setLoadingWorkspaces(true)
      const response = await fetch('/api/workspaces')
      if (response.ok) {
        const data = await response.json()
        const workspacesArray = Array.isArray(data) ? data : (data.workspaces || [])
        setWorkspaces(workspacesArray)
        // Auto-select first workspace if available
        if (workspacesArray.length > 0 && !formData.workspaceId) {
          setFormData(prev => ({ ...prev, workspaceId: workspacesArray[0].id }))
        }
      }
    } catch (error) {
      console.error('Error fetching workspaces:', error)
    } finally {
      setLoadingWorkspaces(false)
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)

    if (!selectedFile) {
      alert('Please select an image')
      setLoading(false)
      return
    }

    if (!formData.workspaceId) {
      alert('Please select a workspace or room')
      setLoading(false)
      return
    }

    const submitData = new FormData()
    submitData.append('image', selectedFile)
    submitData.append('studentName', formData.studentName)
    submitData.append('studentEmail', formData.studentEmail)
    submitData.append('title', formData.title)
    submitData.append('description', formData.description)
    submitData.append('workspaceId', formData.workspaceId)
    submitData.append('tags', formData.tags)
    
    // Add owner information if user is logged in
    if (user) {
      submitData.append('ownerId', user.id)
      submitData.append('ownerName', user.user_metadata?.email?.split('@')[0] || 'Anonymous')
      submitData.append('ownerColor', generateOwnerColor(user.id))
    }

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: submitData,
      })

      if (response.ok) {
        const data = await response.json()
        const boardId = data.board.id
        const workspaceId = formData.workspaceId
        
        if (confirm('Board uploaded! Do you want to view it in the room now?')) {
          router.push(`/studio/${workspaceId}?pinBoard=${boardId}`)
        } else {
          router.push('/dashboard')
        }
      } else {
        const error = await response.text()
        alert('Upload failed: ' + error)
      }
    } catch (error) {
      alert('Upload failed: ' + error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <motion.header 
        className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-b border-border shadow-sm"
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="p-2 hover:bg-background-lighter rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold text-text-primary">Upload Your Board</h1>
          </div>
        </div>
      </motion.header>

      {/* Main content */}
      <div className="pt-24 px-6 pb-12">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl shadow-lg border border-border p-8"
          >
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Image upload */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Board Image *
                </label>
                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors">
                  {preview ? (
                    <div className="space-y-4">
                      <img src={preview} alt="Preview" className="max-h-64 mx-auto rounded" />
                      <label className="cursor-pointer text-primary hover:text-primary-dark">
                        <span>Change image</span>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={handleImageChange}
                          className="hidden"
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="cursor-pointer">
                      <div className="space-y-2">
                        <svg className="w-12 h-12 mx-auto text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="text-text-primary font-medium">Click to upload</p>
                        <p className="text-text-muted text-sm">PNG, JPG, or PDF up to 10MB</p>
                      </div>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleImageChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Student info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Your Name *
                  </label>
                  <input
                    type="text"
                    value={formData.studentName}
                    onChange={(e) => setFormData({...formData, studentName: e.target.value})}
                    className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="Jane Doe"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.studentEmail}
                    onChange={(e) => setFormData({...formData, studentEmail: e.target.value})}
                    className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="jane@example.com"
                  />
                </div>
              </div>

              {/* Project info */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Project Title *
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="Community Center Redesign"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                  rows={3}
                  placeholder="Brief description of your project..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Workspace / Room *
                </label>
                {loadingWorkspaces ? (
                  <div className="w-full px-4 py-2 border border-border rounded-lg bg-gray-50">
                    <span className="text-text-muted">Loading your workspaces...</span>
                  </div>
                ) : workspaces.length === 0 ? (
                  <div className="w-full px-4 py-2 border border-border rounded-lg bg-yellow-50">
                    <p className="text-sm text-yellow-800 mb-2">No workspaces found. Create one first!</p>
                    <button
                      type="button"
                      onClick={() => router.push('/workspace/new')}
                      className="text-sm text-primary hover:underline"
                    >
                      Create a workspace →
                    </button>
                  </div>
                ) : (
                  <select
                    value={formData.workspaceId}
                    onChange={(e) => setFormData({...formData, workspaceId: e.target.value})}
                    className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                    required
                  >
                    <option value="">Select a workspace or room...</option>
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name} {ws.type === 'personal' ? '(Personal Room)' : '(Class)'}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({...formData, tags: e.target.value})}
                  className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="sustainable, residential, urban"
                />
              </div>

              {/* Submit */}
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="flex-1 px-6 py-3 bg-background-lighter hover:bg-background-light text-text-primary rounded-lg transition-colors border border-border"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Uploading...' : 'Upload Board'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  )
}