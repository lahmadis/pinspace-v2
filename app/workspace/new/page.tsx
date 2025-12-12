'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import Link from 'next/link'

export default function NewWorkspacePage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    role: 'instructor'
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
    })
    
    return () => subscription.unsubscribe()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      alert('Please enter a workspace name')
      return
    }

    try {
      setLoading(true)

      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          creatorName: user?.user_metadata?.email?.split('@')[0] || 'Instructor',
          role: formData.role
        })
      })

      const data = await response.json()

      if (!response.ok) {
        const errorMsg = data.error || data.details || 'Failed to create workspace'
        throw new Error(errorMsg)
      }

      // API returns workspace directly, not wrapped in {workspace: ...}
      const workspaceId = data.id || data.workspace?.id
      
      if (!workspaceId) {
        console.error('No workspace ID in response:', data)
        throw new Error('Workspace created but no ID returned')
      }

      console.log('✅ Workspace created:', workspaceId)
      
      // Redirect to workspace settings
      router.push(`/workspace/${workspaceId}/settings`)
    } catch (error: any) {
      console.error('Error creating workspace:', error)
      const errorMessage = error?.message || error?.error || 'Failed to create workspace'
      console.error('Full error details:', JSON.stringify(error, null, 2))
      alert(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#4444ff]/20 border-t-[#4444ff] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-gray-600" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                  <path d="M15 19l-7-7 7-7"></path>
                </svg>
              </button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Create Workspace</h1>
              <p className="text-sm text-gray-600">Set up a shared studio for your class</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Create a New Workspace
            </h2>
            <p className="text-gray-600">
              A workspace is a shared 3D studio where you can invite students and collaborate on design work.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Workspace Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Workspace Name *
              </label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Studio 08 - Fall 2024"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4444ff] focus:border-transparent"
                required
              />
              <p className="mt-2 text-sm text-gray-500">
                Choose a descriptive name for your studio class
              </p>
            </div>

            {/* Role */}
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-2">
                Your Role
              </label>
              <select
                id="role"
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as 'instructor' | 'student' })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4444ff] focus:border-transparent"
              >
                <option value="instructor">Instructor / Professor</option>
                <option value="student">Organizer / Student Lead</option>
              </select>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex gap-3">
                <div className="text-2xl">💡</div>
                <div>
                  <p className="text-sm text-blue-900 font-medium mb-1">
                    What happens next?
                  </p>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• A new 3D studio room will be created</li>
                    <li>• You'll get a unique invite link to share</li>
                    <li>• Students can join using the invite code</li>
                    <li>• Everyone can add and edit their own boards</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !formData.name.trim()}
              className="w-full px-6 py-3 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold text-lg shadow-md hover:shadow-lg"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Creating Workspace...
                </span>
              ) : (
                'Create Workspace'
              )}
            </button>
          </form>
        </div>

        {/* Help Text */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Need help? <Link href="/docs" className="text-[#4444ff] hover:underline">View documentation</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

