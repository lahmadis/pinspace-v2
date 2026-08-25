'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent, User as AuthUser } from '@supabase/supabase-js'
import { Workspace } from '@/types'
import { ArrowLeft, GraduationCap, User, Copy, Check } from 'lucide-react'

const AVATAR_GRADIENTS = [
  'linear-gradient(140deg, #FFB08A, #E86A92)',
  'linear-gradient(140deg, #8FD3C8, #4E9F8F)',
  'linear-gradient(140deg, #A6B8FF, #5B6FE0)',
  'linear-gradient(140deg, #FFD08A, #E8965A)',
  'linear-gradient(140deg, #C9A6FF, #8A5BE0)',
]

function avatarStyle(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]
}

export default function WorkspacePeoplePage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.id as string

  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

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
    if (!isLoaded || !user) return
    fetch(`/api/workspaces/${workspaceId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        // Non-member arriving at a shared workspace by link: bounce to the
        // join prompt, same as the rooms-list page — otherwise `data.workspace`
        // is undefined and the page spins forever.
        if (data.canJoin && data.inviteCode) {
          router.replace(`/join/${encodeURIComponent(data.inviteCode)}`)
          return
        }
        if (!data.workspace) throw new Error('Workspace data missing in response')
        setWorkspace(data.workspace)
        setLoading(false)
      })
      .catch(() => router.push('/dashboard'))
  }, [isLoaded, user, workspaceId, router])

  const isInstructor = workspace?.members.find((m) => m.userId === user?.id)?.role === 'instructor'

  const handleCopy = () => {
    if (!workspace) return
    navigator.clipboard.writeText(workspace.inviteCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading || !workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#3B6EF6]/20 border-t-[#3B6EF6]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
      <div className="border-b border-[#16181D]/8 bg-white/70 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center gap-4">
          <Link href={`/workspace/${workspaceId}`}>
            <button className="p-2 hover:bg-[#16181D]/6 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-[#5A5E6B]" />
            </button>
          </Link>
          <div>
            <h1 className="text-xl font-extrabold text-[#16181D]">{workspace.name}</h1>
            <p className="text-sm text-[#8A8FA0] mt-0.5">People · {workspace.members.length} member{workspace.members.length === 1 ? '' : 's'}</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {isInstructor && (
          <div className="flex items-center gap-3 bg-white/80 border border-[#16181D]/8 rounded-full px-5 py-2.5 mb-8 w-fit">
            <span className="font-mono text-sm tracking-[0.12em] text-[#16181D]">{workspace.inviteCode}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#3B6EF6] text-white rounded-full text-xs font-bold hover:bg-[#16181D] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy invite code'}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {workspace.members.map((member) => (
            <div
              key={member.userId}
              className="bg-white/80 border border-[#16181D]/8 rounded-2xl px-5 py-4 flex items-center gap-3.5 shadow-[0_8px_24px_rgba(22,24,29,0.06)]"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-extrabold text-sm shrink-0"
                style={{ background: avatarStyle(member.userId) }}
              >
                {member.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#16181D] truncate">{member.name}</p>
                <p className="text-xs text-[#8A8FA0] mt-0.5 flex items-center gap-1.5">
                  {member.role === 'instructor' ? (
                    <>
                      <GraduationCap className="w-3.5 h-3.5" />
                      {workspace.type === 'personal' ? 'Owner' : 'Instructor'}
                    </>
                  ) : (
                    <>
                      <User className="w-3.5 h-3.5" />
                      Student
                    </>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
