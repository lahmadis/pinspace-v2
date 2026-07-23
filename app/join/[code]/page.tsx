'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import Link from 'next/link'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import { toast } from '@/lib/toast'

export default function JoinWorkspacePage() {
  const params = useParams()
  const router = useRouter()
  interface WorkspaceInfo {
    id: string
    name: string
    inviteCode: string
    memberCount: number
    institutionSlug?: string
  }
  const [user, setUser] = useState<User | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const inviteCode = params.code as string

  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  // In-flight guard for join (a membership-creating POST). Ref, not `joining`
  // state, so a same-tick double-click can't slip a second POST past the stale
  // render value. The server route also dedupes membership, so this mainly avoids
  // a redundant request; the guard keeps the client consistent with the others.
  const joiningRef = useRef(false)
  const [error, setError] = useState('')
  const [profileFullName, setProfileFullName] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user || null)
      setIsLoaded(true)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
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

  useEffect(() => {
    if (!user?.id) return
    fetch('/api/user-profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const fullName = typeof data?.full_name === 'string' ? data.full_name.trim() : ''
        setProfileFullName(fullName || null)
      })
      .catch(() => setProfileFullName(null))
  }, [user?.id])

  const profileFirstName = profileFullName ? profileFullName.split(/\s+/)[0] : null

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
    if (joiningRef.current) return

    try {
      joiningRef.current = true
      setJoining(true)

      const response = await fetch(`/api/workspaces/${workspace.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: profileFullName || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Student'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        const msg = data.message || data.error || 'Failed to join workspace'
        throw new Error(msg)
      }

      console.log('✅ Joined workspace:', workspace.id)

      // Phase 6.2: send joiners to the rooms list so they can see all rooms
      // in the workspace and pick which one to enter, rather than dumping
      // them straight into the first room.
      router.push(`/workspace/${workspace.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to join workspace')
    } finally {
      // Re-enable on success and failure so a failed join can be retried.
      joiningRef.current = false
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
            You&apos;ve been invited to join
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
                ✓ Signed in as <strong>{profileFirstName || user?.email?.split('@')[0] || 'User'}</strong>
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
                'Join'
              )}
            </button>

            <p className="text-xs text-gray-500 text-center">
              By joining, you&apos;ll have access to the shared 3D studio and can add your own boards
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-900">
                ⚠️ You need to sign in before joining this workspace
              </p>
            </div>

            <Link href={workspace?.institutionSlug ? `/sign-in?institution=${workspace.institutionSlug}&redirect=/join/${inviteCode}` : `/sign-in?redirect=/join/${inviteCode}`}>
              <button className="w-full px-6 py-4 bg-[#4444ff] text-white rounded-lg hover:bg-[#3333ee] transition-all font-semibold text-lg shadow-md hover:shadow-lg">
                Sign In to Join
              </button>
            </Link>

            <p className="text-center text-sm text-gray-600">
              Don&apos;t have an account?{' '}
              <Link href={workspace?.institutionSlug ? `/sign-up?institution=${workspace.institutionSlug}&redirect=/join/${inviteCode}` : `/sign-up?redirect=/join/${inviteCode}`} className="text-[#4444ff] hover:underline font-semibold">
                Sign up
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

