'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

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

  useEffect(() => {
    if (studioId) {
      fetchBoards()
    } else {
      setError('No studio ID provided. Add ?id=YOUR_STUDIO_ID to the URL')
    }
  }, [studioId])

  const fetchBoards = async () => {
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
    } catch (err: any) {
      setError(err.message)
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
    } catch (err: any) {
      setError(err.message)
      alert(`❌ Error: ${err.message}`)
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

  const [typeInfo, setTypeInfo] = useState<any>(null)
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
    } catch (err: any) {
      alert('Error checking types: ' + err.message)
    } finally {
      setCheckingTypes(false)
    }
  }

  const fixTypes = async () => {
    if (!studioId) {
      alert('No studio ID provided')
      return
    }
    if (!confirm('This will convert all string wallIndex values to numbers. Continue?')) return
    
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
      } else {
        alert('Error: ' + data.error)
      }
    } catch (err: any) {
      alert('Error fixing types: ' + err.message)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Board Position Debug Tool</h1>
            <p className="text-gray-600">
              Workspace ID: {studioId || <span className="text-red-600 font-semibold">NOT PROVIDED - Add ?id=YOUR_STUDIO_ID to URL</span>}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={checkTypes}
              disabled={checkingTypes}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {checkingTypes ? 'Checking...' : '🔍 Check Types'}
            </button>
            <button
              onClick={fetchBoards}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Loading...' : '🔄 Refresh'}
            </button>
            <button
              onClick={() => router.push(`/studio/${studioId}`)}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              ← Back to Studio
            </button>
          </div>
        </div>

        {typeInfo && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-yellow-900">📊 Type Analysis</h3>
              {typeInfo.typeIssues && typeInfo.typeIssues.length > 0 && (
                <button
                  onClick={fixTypes}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  🔧 Fix Type Issues ({typeInfo.typeIssues.length})
                </button>
              )}
            </div>
            <div className="text-sm text-yellow-800 space-y-2">
              <p><strong>Total boards:</strong> {typeInfo.summary?.total}</p>
              <p><strong>Type distribution:</strong> {JSON.stringify(typeInfo.summary?.typeCounts)}</p>
              {typeInfo.typeIssues && typeInfo.typeIssues.length > 0 ? (
                <div>
                  <p className="font-semibold text-red-700">⚠️ Found {typeInfo.typeIssues.length} board(s) with string wallIndex values:</p>
                  <ul className="list-disc list-inside ml-4 mt-2">
                    {typeInfo.typeIssues.map((issue: any, i: number) => (
                      <li key={i}>
                        {issue.title} (ID: {issue.id}): "{issue.rawValue}" (type: {issue.rawType}) → {issue.parsedValue}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-green-700">✅ All wallIndex values are numbers (no type issues found)</p>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
            <strong>Error:</strong> {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading boards...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {wallIndices.map(wallIndex => {
              const wallKey = wallIndex === null ? 'null' : wallIndex
              const boards = boardsByWall[wallKey] || []
              const wallLabel = wallIndex === null ? 'No Wall (null)' : `Wall ${wallIndex}`

              return (
                <div key={wallKey} className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-gray-900">
                      {wallLabel} <span className="text-gray-500">({boards.length} board{boards.length !== 1 ? 's' : ''})</span>
                    </h2>
                    {wallIndex === null && (
                      <span className="text-sm text-orange-600 bg-orange-100 px-3 py-1 rounded-full">
                        Boards not assigned to any wall
                      </span>
                    )}
                  </div>

                  {boards.length === 0 ? (
                    <p className="text-gray-500 italic">No boards on this wall</p>
                  ) : (
                    <div className="space-y-3">
                      {boards.map(board => (
                        <div
                          key={board.id}
                          className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
                        >
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{board.title}</div>
                            <div className="text-sm text-gray-600 mt-1">
                              ID: {board.id}
                              {board.position_x !== null && board.position_y !== null && (
                                <> • Position: ({board.position_x}, {board.position_y})</>
                              )}
                              {board.position_side && (
                                <> • Side: {board.position_side}</>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-500">Move to wall:</span>
                            {[0, 1, 2, 3].map(targetWall => (
                              <button
                                key={targetWall}
                                onClick={() => updateBoardWall(board.id, wallIndex, targetWall)}
                                disabled={updating === board.id || wallIndex === targetWall}
                                className={`px-3 py-1 text-sm rounded ${
                                  wallIndex === targetWall
                                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                                    : 'bg-blue-600 text-white hover:bg-blue-700'
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
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-semibold text-blue-900 mb-2">💡 How to use:</h3>
          <ul className="text-blue-800 space-y-1 text-sm">
            <li>• This page shows all boards grouped by their current wallIndex</li>
            <li>• If Wall 1 appears empty, look for boards in other walls that should be on Wall 1</li>
            <li>• Click the numbered buttons (0, 1, 2, 3) to move a board to that wall</li>
            <li>• After moving boards, refresh the studio page to see the changes</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default function DebugBoardsPage() {
  return (
    <Suspense fallback={null}>
      <DebugBoardsPageInner />
    </Suspense>
  )
}

