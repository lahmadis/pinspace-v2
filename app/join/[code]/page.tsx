'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import Link from 'next/link'

export default function JoinWorkspacePage() {
  const params = useParams()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const inviteCode = params.code as string
  
  const [workspace, setWorkspace] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null)
      setIsLoaded(true)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
      setIsLoaded(true)
    })
    
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (isLoaded) {
      fetchWorkspaceInfo()
    }
  }, [inviteCode, isLoaded])

  const fetchWorkspaceInfo = async () => {
    try {
      const response = await fetch(`/api/workspaces/by-invite/${inviteCode}`)
      
      if (!response.ok) {
        setError('Invalid invite code')
        return
      }

      const data = await response.json()
      setWorkspace(data.workspace)
    } catch (error) {
      console.error('Error:', error)
      setError('Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async () => {
    if (!user || !workspace) return

    try {
      setJoining(true)

      const response = await fetch(`/api/workspaces/${workspace.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: user.fullName || user.firstName || 'Student'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join workspace')
      }

      console.log('✅ Joined workspace:', workspace.id)
      
      // Redirect to workspace studio (use workspace.id as studioId)
      router.push(`/studio/${workspace.id}`)
    } catch (error) {
      console.error('Error:', error)
      alert(error instanceof Error ? error.message : 'Failed to join workspace')
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#4444ff]/20 border-t-[#4444ff] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading invite...</p>
        </div>
      </div>
    )
  }

  if (error || !workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-gray-200 p-8 text-center">
          <div className="text-6xl mb-4">❌</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Invalid Invite</h1>
          <p className="text-gray-600 mb-6">
            {error || 'This invite code is not valid or has expired.'}
          </p>
          <Link href="/dashboard">
            <button className="px-6 py-3 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] transition-colors font-semibold">
              Go to Dashboard
            </button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50 p-4">
      <div className="max-w-lg w-full bg-white rounded-xl shadow-lg border border-gray-200 p-8">
        {/* Icon */}
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">🎓</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Join Workspace
          </h1>
          <p className="text-gray-600">
            You've been invited to join
          </p>
        </div>

        {/* Workspace Info */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 mb-6 border border-blue-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {workspace.name}
          </h2>
          <div className="flex items-center gap-4 text-sm text-gray-700">
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
              </svg>
              {workspace.memberCount} member{workspace.memberCount !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
              </svg>
              Code: {workspace.inviteCode}
            </span>
          </div>
        </div>

        {/* Actions */}
        {user ? (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">
                ✓ Signed in as <strong>{user?.user_metadata?.email?.split('@')[0] || 'User'}</strong>
              </p>
            </div>

            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full px-6 py-4 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold text-lg shadow-md hover:shadow-lg"
            >
              {joining ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Joining...
                </span>
              ) : (
                'Join as Student'
              )}
            </button>

            <p className="text-xs text-gray-500 text-center">
              By joining, you'll have access to the shared 3D studio and can add your own boards
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-900">
                ⚠️ You need to sign in before joining this workspace
              </p>
            </div>

            <Link href={`/sign-in?redirect=/join/${inviteCode}`}>
              <button className="w-full px-6 py-4 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] transition-all font-semibold text-lg shadow-md hover:shadow-lg">
                Sign In to Join
              </button>
            </Link>

            <p className="text-center text-sm text-gray-600">
              Don't have an account?{' '}
              <Link href={`/sign-up?redirect=/join/${inviteCode}`} className="text-[#4444ff] hover:underline font-semibold">
                Sign up
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

