'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import CritWorkspace from '@/components/desk/CritWorkspace'
import { useAuthSession } from '@/hooks/useAuthSession'

/**
 * One desk crit, opened up — where the work actually happens.
 *
 * The desk board is a row of CARDS: each one an overview of a crit, enough to
 * see what you pinned and what you still have to do. This is the same crit at
 * working size: the tool rail on the left, the pinned sheets laid out, and the
 * transcript in a tab along the bottom.
 *
 * This used to mount the infinite canvas. It no longer does. A crit is a
 * handful of sheets you talk over, not an unbounded whiteboard, and putting
 * them at free-floating coordinates in a space you had to pan around meant
 * hunting for your own work. See CritWorkspace for what replaced it.
 */
export default function CritWorkspacePage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { status: authStatus } = useAuthSession()

  const [title, setTitle] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [draftTitle, setDraftTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/sign-in')
  }, [authStatus, router])

  useEffect(() => {
    if (authStatus !== 'authenticated') return
    const controller = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(`/api/canvases/${params.id}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) {
          setState('missing')
          return
        }
        const { canvas } = await res.json()
        setTitle(canvas.title || 'Untitled crit')
        setState('ready')
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setState('missing')
      }
    })()
    return () => controller.abort()
  }, [params.id, authStatus])

  const commitTitle = useCallback(async () => {
    const next = draftTitle.trim()
    setEditingTitle(false)
    if (!next || next === title) return
    const previous = title
    setTitle(next)
    try {
      const res = await fetch(`/api/canvases/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      })
      if (!res.ok) throw new Error('rename failed')
    } catch {
      // Show the name the server actually holds, not the one it refused.
      setTitle(previous)
    }
  }, [draftTitle, params.id, title])

  if (state === 'missing') {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-white gap-3">
        <h1 className="text-lg font-bold text-[#16181D]">This crit isn&rsquo;t here</h1>
        <p className="text-sm text-[#5A5E6B]">It may have been deleted, or it isn&rsquo;t yours.</p>
        <button
          type="button"
          onClick={() => router.push('/desk-crits')}
          className="mt-2 px-4 py-2 rounded-xl bg-[#3B6EF6] text-white text-sm font-semibold"
        >
          Back to your desk
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <div className="shrink-0 h-14 flex items-center gap-3 px-4 border-b border-[#16181D]/8 bg-white/80 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => router.push('/desk-crits')}
          title="Back to your desk"
          aria-label="Back to your desk"
          className="flex items-center gap-1.5 px-3 py-2 -ml-1 rounded-lg hover:bg-[#16181D]/6 text-[#5A5E6B] text-sm font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          Your desk
        </button>

        {editingTitle ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitTitle()
              if (e.key === 'Escape') setEditingTitle(false)
              // Kept from when the canvas bound single-letter tool shortcuts:
              // cheap insurance if the header ever moves inside the workspace.
              e.stopPropagation()
            }}
            className="text-sm font-bold text-[#16181D] bg-white border border-[#3B6EF6]/40 rounded-lg px-2.5 py-1.5 outline-none min-w-0 w-64"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftTitle(title ?? '')
              setEditingTitle(true)
            }}
            title="Rename"
            className="text-sm font-bold text-[#16181D] px-2 py-1.5 rounded-lg hover:bg-[#16181D]/6 truncate max-w-[50vw] text-left"
          >
            {state === 'loading' ? 'Opening…' : title}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {/* Mounted only once the crit is confirmed to exist and be ours.
            Rendering it while the title fetch is in flight would fire the node
            load against an id that may 403, and surface that as an error
            banner on a surface the user never got to see. */}
        {state === 'ready' && <CritWorkspace canvasId={params.id} />}
      </div>
    </div>
  )
}
