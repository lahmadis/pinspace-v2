'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import Link from 'next/link'
import type { Institution } from '@/types'
import { toast } from '@/lib/toast'
import { useAccountMode } from '@/lib/useAccountMode'

export default function NewWorkspacePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const { mode: accountMode } = useAccountMode(user?.id)
  const headerTitle =
    accountMode === 'firm' ? 'Create a Firm Room'
    : accountMode === 'personal' ? 'Create a Personal Room'
    : 'Create a Class'
  const headerSubtitle =
    accountMode === 'firm' ? 'Set up a shared studio for your firm'
    : accountMode === 'personal' ? 'Set up a personal studio space'
    : 'Set up a shared studio for your class'
  const [formData, setFormData] = useState({
    name: '',
    role: 'instructor' as 'instructor' | 'student',
    institutionSlug: ''
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session) {
        router.push('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
    })
    
    return () => subscription.unsubscribe()
  }, [router])

  useEffect(() => {
    if (!isLoaded) return
    fetch('/api/institutions', { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : [])
      .then((list: Institution[]) => {
        setInstitutions(list)
        if (list.length > 0) {
          const defaultSlug = list.find((i) => i.slug === 'wit')?.slug ?? list[0].slug
          setFormData((prev) => ({ ...prev, institutionSlug: prev.institutionSlug || defaultSlug }))
        }
      })
      .catch(() => {})
  }, [isLoaded])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      toast.error('Please enter a workspace name')
      return
    }

    try {
      setLoading(true)

      const payload: Record<string, string> = {
        name: formData.name.trim(),
        creatorName: user?.user_metadata?.email?.split('@')[0] || 'Instructor',
        role: formData.role
      }
      if (formData.institutionSlug) payload.institution_slug = formData.institutionSlug

      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (!response.ok) {
        const errorMsg = data.error || data.details || 'Failed to create workspace'
        throw new Error(errorMsg)
      }

      // API returns workspace directly, not wrapped in {workspace: ...}
      const workspaceId = data.id || data.workspace?.id
      
      if (!workspaceId) {
        throw new Error('Workspace created but no ID returned')
      }

      // Redirect to workspace settings
      router.push(`/workspace/${workspaceId}/settings`)
    } catch (error) {
      console.error('Error creating workspace:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to create workspace'
      toast.error(errorMessage)
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
              <h1 className="text-xl font-bold text-gray-900">{headerTitle}</h1>
              <p className="text-sm text-gray-600">{headerSubtitle}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {headerTitle}
            </h2>
            <p className="text-gray-600">
              {accountMode === 'firm'
                ? 'A firm room is a shared 3D studio where you can invite teammates and collaborate on design work.'
                : accountMode === 'personal'
                ? 'A personal room is your own 3D studio space for individual work.'
                : 'A class is a shared 3D studio where you can invite students and collaborate on design work.'}
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

            {/* Institution */}
            {institutions.length > 0 && (
              <div>
                <label htmlFor="institution" className="block text-sm font-medium text-gray-700 mb-2">
                  Institution / School
                </label>
                <select
                  id="institution"
                  value={formData.institutionSlug}
                  onChange={(e) => setFormData({ ...formData, institutionSlug: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4444ff] focus:border-transparent"
                >
                  {institutions.map((inst) => (
                    <option key={inst.id} value={inst.slug}>
                      {inst.name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-sm text-gray-500">
                  This workspace will appear under this school in the explore view
                </p>
              </div>
            )}

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

            {/* Info Box - Hidden for demo video */}
            {/* <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
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
            </div> */}

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
            Questions? Contact your instructor or system administrator.
          </p>
        </div>
      </div>
    </div>
  )
}

