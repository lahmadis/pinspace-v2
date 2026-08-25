'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, Dialog, StatusState } from '@/components/ui'

interface BoardInfo {
  id: string
  title: string
  position_wall_index: number | null
  position_x: number | null
  position_y: number | null
  position_side: string | null
}

function DebugBoardsPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const studioId = searchParams.get('id') || searchParams.get('studioId') || searchParams.get('workspaceId') || ''
  
  const [boardsByWall, setBoardsByWall] = useState<Record<number | string, BoardInfo[]>>({})
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fixConfirmOpen, setFixConfirmOpen] = useState(false)
  const [fixingTypes, setFixingTypes] = useState(false)

  useEffect(() => {
    if (studioId) {
      fetchBoards()
    } else {
      // Search parameters are the external source of truth for this utility.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('No studio ID provided. Add ?id=YOUR_STUDIO_ID to the URL')
      setLoading(false)
    }
  }, [studioId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchBoards() {
    if (!studioId) {
      setError('No studio ID provided')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/debug/boards?workspaceId=${studioId}`)
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch boards')
      }

      setBoardsByWall(data.boardsByWall || {})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const updateBoardWall = async (boardId: string, currentWallIndex: number | null, newWallIndex: number) => {
    setUpdating(boardId)
    setError(null)
    
    try {
      const response = await fetch('/api/debug/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId, newWallIndex })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update board')
      }

      // Refresh the board list
      await fetchBoards()
      alert(`✅ Board "${data.board.title}" moved from wall ${currentWallIndex ?? 'none'} to wall ${newWallIndex}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      alert(`❌ Error: ${msg}`)
    } finally {
      setUpdating(null)
    }
  }

  const wallIndices = Object.keys(boardsByWall)
    .map(k => k === 'null' ? null : parseInt(k, 10))
    .sort((a, b) => {
      if (a === null) return 1
      if (b === null) return -1
      return a - b
    })

  interface TypeCheckData {
    summary?: { total: number; typeCounts: Record<string, number> }
    typeIssues?: { title: string; id: string; rawValue: unknown; rawType: string; parsedValue: number }[]
  }
  const [typeInfo, setTypeInfo] = useState<TypeCheckData | null>(null)
  const [checkingTypes, setCheckingTypes] = useState(false)

  const checkTypes = async () => {
    if (!studioId) {
      alert('No studio ID provided')
      return
    }
    setCheckingTypes(true)
    try {
      const response = await fetch(`/api/debug/check-types?workspaceId=${studioId}`)
      const data = await response.json()
      if (response.ok) {
        setTypeInfo(data)
      } else {
        alert('Error: ' + data.error)
      }
    } catch (err) {
      alert('Error checking types: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCheckingTypes(false)
    }
  }

  const fixTypes = async () => {
    if (!studioId) {
      alert('No studio ID provided')
      return
    }
    if (fixingTypes) return
    setFixingTypes(true)
    try {
      const response = await fetch('/api/debug/check-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: studioId, dryRun: false })
      })
      const data = await response.json()
      if (response.ok) {
        alert(`✅ ${data.message}`)
        await fetchBoards()
        await checkTypes()
        setFixConfirmOpen(false)
      } else {
        alert('Error: ' + data.error)
      }
    } catch (err) {
      alert('Error fixing types: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setFixingTypes(false)
    }
  }

  return (
    <main className="min-h-dvh bg-background">
      <PageHeader
        eyebrow="Restricted debug utility"
        title="Board position diagnostics"
        description={<>Workspace ID: <code className="break-all font-mono text-xs">{studioId || 'not provided — add ?id=YOUR_STUDIO_ID'}</code></>}
        actions={<>
            <Button
              onClick={checkTypes}
              disabled={checkingTypes}
              variant="secondary"
            >
              {checkingTypes ? 'Checking…' : 'Check types'}
            </Button>
            <Button
              onClick={fetchBoards}
              disabled={loading}
              variant="ghost"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
            <Button
              onClick={() => router.push(`/studio/${studioId}`)}
              disabled={!studioId}
            >
              ← Back to Studio
            </Button>
          </>}
      />
      <div className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">

        {typeInfo && (
          <Card className="mb-6 border-2 border-primary">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-text-primary">Type analysis</h2>
              {typeInfo.typeIssues && typeInfo.typeIssues.length > 0 && (
                <Button variant="danger" onClick={() => setFixConfirmOpen(true)}>Fix type issues ({typeInfo.typeIssues.length})</Button>
              )}
            </div>
            <div className="space-y-2 text-sm text-text-secondary">
              <p><strong>Total boards:</strong> {typeInfo.summary?.total}</p>
              <p><strong>Type distribution:</strong> {JSON.stringify(typeInfo.summary?.typeCounts)}</p>
              {typeInfo.typeIssues && typeInfo.typeIssues.length > 0 ? (
                <div>
                  <p className="font-semibold text-text-primary">Found {typeInfo.typeIssues.length} board(s) with string wallIndex values:</p>
                  <ul className="list-disc list-inside ml-4 mt-2">
                    {typeInfo.typeIssues.map((issue, i: number) => (
                      <li key={i}>
                        {issue.title} (ID: {issue.id}): {'"'}{String(issue.rawValue)}{'"'} (type: {issue.rawType}) &rarr; {issue.parsedValue}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <StatusState status="success" title="All wallIndex values are numbers." description="No type issues found." />
              )}
            </div>
          </Card>
        )}

        {error && (
          <StatusState className="mb-6" status="error" title="Debug request failed" description={error} />
        )}

        {loading ? (
          <StatusState status="loading" title="Loading boards…" />
        ) : (
          <div className="space-y-6">
            {wallIndices.map(wallIndex => {
              const wallKey = wallIndex === null ? 'null' : wallIndex
              const boards = boardsByWall[wallKey] || []
              const wallLabel = wallIndex === null ? 'No Wall (null)' : `Wall ${wallIndex}`

              return (
                <Card key={wallKey}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-text-primary">
                      {wallLabel} <span className="text-text-secondary">({boards.length} board{boards.length !== 1 ? 's' : ''})</span>
                    </h2>
                    {wallIndex === null && (
                      <Badge variant="warning">Boards not assigned to any wall</Badge>
                    )}
                  </div>

                  {boards.length === 0 ? (
                    <p className="text-text-secondary italic">No boards on this wall</p>
                  ) : (
                    <div className="space-y-3">
                      {boards.map(board => (
                        <div
                          key={board.id}
                          className="flex flex-col gap-4 rounded-pinspace border border-border bg-background p-4 lg:flex-row lg:items-center lg:justify-between"
                        >
                          <div className="flex-1">
                            <div className="font-medium text-text-primary">{board.title}</div>
                            <div className="text-sm text-text-secondary mt-1">
                              ID: {board.id}
                              {board.position_x !== null && board.position_y !== null && (
                                <> • Position: ({board.position_x}, {board.position_y})</>
                              )}
                              {board.position_side && (
                                <> • Side: {board.position_side}</>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-text-secondary">Move to wall:</span>
                            {[0, 1, 2, 3].map(targetWall => (
                              <button
                                key={targetWall}
                                onClick={() => updateBoardWall(board.id, wallIndex, targetWall)}
                                disabled={updating === board.id || wallIndex === targetWall}
                                className={`min-h-11 min-w-11 rounded-pinspace px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                                  wallIndex === targetWall
                                    ? 'bg-border text-text-secondary cursor-not-allowed'
                                    : 'border border-pinspace-ink bg-primary text-pinspace-ink hover:bg-primary-light'
                                } disabled:opacity-50`}
                              >
                                {targetWall}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}

        <Card className="mt-8">
          <h2 className="mb-2 font-bold text-text-primary">How to use</h2>
          <ul className="space-y-1 text-sm text-text-secondary">
            <li>• This page shows all boards grouped by their current wallIndex</li>
            <li>• If Wall 1 appears empty, look for boards in other walls that should be on Wall 1</li>
            <li>• Click the numbered buttons (0, 1, 2, 3) to move a board to that wall</li>
            <li>• After moving boards, refresh the studio page to see the changes</li>
          </ul>
        </Card>
        <Dialog
          open={fixConfirmOpen}
          onOpenChange={(next) => { if (!fixingTypes) setFixConfirmOpen(next) }}
          closeOnOutsideClick={!fixingTypes}
          hideCloseButton={fixingTypes}
          title="Normalize wall index types?"
          description="This writes numeric wallIndex values for every string value in this workspace."
        >
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setFixConfirmOpen(false)} disabled={fixingTypes}>Cancel</Button>
            <Button variant="danger" onClick={fixTypes} loading={fixingTypes}>{fixingTypes ? 'Normalizing…' : 'Normalize values'}</Button>
          </div>
        </Dialog>
      </div>
    </main>
  )
}

export default function DebugBoardsPage() {
  return (
    <Suspense fallback={null}>
      <DebugBoardsPageInner />
    </Suspense>
  )
}
