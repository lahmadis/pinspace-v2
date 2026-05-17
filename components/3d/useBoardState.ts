import { useState, useRef, useCallback, useEffect } from 'react'
import type { Board } from '@/types'
import { toast } from '@/lib/toast'

const isDev = process.env.NODE_ENV === 'development'
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args) }

/**
 * Centralized board state management hook
 * 
 * COORDINATE SYSTEM:
 * - Internal: normalized -0.5 to 0.5 (center at 0,0)
 * - API: percentage 0 to 100
 * - Conversion happens ONLY in this hook
 */

interface BoardPosition {
  x: number      // normalized -0.5 to 0.5
  y: number      // normalized -0.5 to 0.5
  width: number  // decimal 0.0 to 1.0
  height: number // decimal 0.0 to 1.0
}

interface TempBoard {
  board: Board
  blobUrl: string
}

const fitAspectWithinBounds = (
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } => {
  if (!(width > 0) || !(height > 0)) return { width: maxWidth, height: maxHeight }
  const scale = Math.min(maxWidth / width, maxHeight / height, 1)
  return { width: width * scale, height: height * scale }
}

export function useBoardState(
  initialBoards: Board[],
  studioId: string,
  onRefresh: () => Promise<void>
) {
  // Board state
  const [boards, setBoards] = useState<Board[]>(initialBoards)
  const [boardPositions, setBoardPositions] = useState<Map<string, BoardPosition>>(new Map())
  const [tempBoards, setTempBoards] = useState<Map<string, TempBoard>>(new Map())
  
  // Refs to prevent stale closures
  const boardsRef = useRef(boards)
  const boardPositionsRef = useRef(boardPositions)
  const tempBoardsRef = useRef(tempBoards)
  const optimisticBoardUntilRef = useRef<Map<string, number>>(new Map())
  
  // Undo/redo: snapshot is serializable boardPositions for current wall
  const undoStackRef = useRef<Array<[string, BoardPosition][]>>([])
  const redoStackRef = useRef<Array<[string, BoardPosition][]>>([])
  const MAX_UNDO = 50
  
  // Keep refs in sync with latest state
  useEffect(() => {
    boardsRef.current = boards
    boardPositionsRef.current = boardPositions
    tempBoardsRef.current = tempBoards
  }, [boards, boardPositions, tempBoards])
  
  // Normalize position so wallIndex/x/y are numbers (API or cache can return strings and break wall filter)
  const normalizePosition = (p: NonNullable<Board['position']>) => ({
    ...p,
    wallIndex: Number(p.wallIndex),
    x: Number(p.x),
    y: Number(p.y),
    width: p.width != null ? Number(p.width) : undefined,
    height: p.height != null ? Number(p.height) : undefined,
  })

  // Sync with parent boards; preserve local position when parent has none (so refetches don't make boards disappear)
  useEffect(() => {
    const boardMap = new Map(boards.map(b => [b.id, b]))

    const hasValidPosition = (b: Board) =>
      b.position != null &&
      b.position.wallIndex != null &&
      b.position.x != null &&
      b.position.y != null

    initialBoards.forEach((parentBoard) => {
      const existing = boardMap.get(parentBoard.id)
      const parentHasPosition = hasValidPosition(parentBoard)
      const existingHasPosition = existing != null && hasValidPosition(existing)
      const parentSide = parentBoard.position?.side || 'front'
      const existingSide = existing?.position?.side || 'front'

      // Preserve local 'back' when API returns 'front' (e.g. position_side not in DB), but only if parent position has required fields
      if (
        parentHasPosition &&
        existingHasPosition &&
        existingSide === 'back' &&
        parentSide !== 'back' &&
        parentBoard.position &&
        parentBoard.position.wallIndex != null &&
        parentBoard.position.x != null &&
        parentBoard.position.y != null
      ) {
        boardMap.set(parentBoard.id, {
          ...parentBoard,
          position: normalizePosition({ ...parentBoard.position, side: 'back' }),
        })
      } else if (parentHasPosition && parentBoard.position) {
        boardMap.set(parentBoard.id, { ...parentBoard, position: normalizePosition(parentBoard.position) })
      } else if (existingHasPosition && existing!.position) {
        boardMap.set(parentBoard.id, { ...parentBoard, position: normalizePosition(existing!.position) })
      } else {
        boardMap.set(parentBoard.id, parentBoard)
      }
      // Once server includes this board, clear optimistic hold.
      optimisticBoardUntilRef.current.delete(parentBoard.id)
    })

    // Remove deleted boards (except temp ones)
    if (initialBoards.length > 0) {
      const parentIds = new Set(initialBoards.map((b) => b.id))
      Array.from(boardMap.keys()).forEach((id) => {
        const holdUntil = optimisticBoardUntilRef.current.get(id) ?? 0
        const keepOptimistic = holdUntil > Date.now()
        if (!parentIds.has(id) && !id.startsWith('temp-') && !keepOptimistic) {
          boardMap.delete(id)
        }
      })
    }

    setBoards(Array.from(boardMap.values()))
  }, [initialBoards])
  
  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      devLog('🧹 [useBoardState] Cleaning up blob URLs')
      tempBoardsRef.current.forEach(({ blobUrl }) => {
        URL.revokeObjectURL(blobUrl)
      })
    }
  }, [])
  
  /**
   * Convert API position (0-100) to internal normalized (-0.5 to 0.5)
   */
  const apiToNormalized = useCallback((apiPos: number): number => {
    return (apiPos / 100) - 0.5
  }, [])
  
  /**
   * Convert internal normalized (-0.5 to 0.5) to API position (0-100)
   */
  const normalizedToApi = useCallback((normalized: number): number => {
    return (normalized + 0.5) * 100
  }, [])
  
  /**
   * Convert API percentage (0-100) to internal decimal (0.0-1.0)
   */
  const apiToDecimal = useCallback((apiPercent: number): number => {
    return apiPercent / 100
  }, [])
  
  /**
   * Convert internal decimal (0.0-1.0) to API percentage (0-100)
   */
  const decimalToApi = useCallback((decimal: number): number => {
    return decimal * 100
  }, [])
  
  /**
   * Load board positions for a specific wall
   */
  const loadWallPositions = useCallback((wallIndex: number, wallDimensions: { width: number; height: number }, side: 'front' | 'back' = 'front') => {
    devLog(`📂 [useBoardState] Loading positions for wall ${wallIndex}`)
    
    const newPositions = new Map<string, BoardPosition>()
    const wallBoards = boardsRef.current.filter(b => b.position?.wallIndex === wallIndex && (b.position?.side || 'front') === side)
    
    devLog(`📂 [useBoardState] Found ${wallBoards.length} boards on wall ${wallIndex} side ${side}`)
    
    wallBoards.forEach(board => {
      if (!board.position) return
      
      // Convert from API format (0-100) to internal normalized (-0.5 to 0.5); use center when x/y missing
      const rawX = board.position.x
      const rawY = board.position.y
      const x = typeof rawX === 'number' && Number.isFinite(rawX) ? apiToNormalized(rawX) : 0
      const y = typeof rawY === 'number' && Number.isFinite(rawY) ? apiToNormalized(rawY) : 0
      
      // Calculate dimensions
      let width: number
      let height: number
      
      // Prefer saved resize (position width/height) so corner resize persists after Save & Exit
      if (board.position.width != null && board.position.height != null && board.position.width > 0 && board.position.height > 0) {
        width = apiToDecimal(board.position.width)
        height = apiToDecimal(board.position.height)
      } else if (board.physicalWidth && board.physicalHeight) {
        const wallWidthInches = wallDimensions.width * 12
        const wallHeightInches = wallDimensions.height * 12
        const rawWidth = board.physicalWidth / wallWidthInches
        const rawHeight = board.physicalHeight / wallHeightInches
        const fitted = fitAspectWithinBounds(rawWidth, rawHeight, 1.0, 1.0)
        width = fitted.width
        height = fitted.height
      } else if (board.aspectRatio) {
        // Calculate from aspect ratio
        const baseHeight = 0.35
        const wallAspectRatio = wallDimensions.width / wallDimensions.height
        const rawWidth = baseHeight * board.aspectRatio / wallAspectRatio
        const rawHeight = baseHeight
        const fitted = fitAspectWithinBounds(rawWidth, rawHeight, 0.50, 0.60)
        width = fitted.width
        height = fitted.height
      } else {
        // Default
        width = 0.30
        height = 0.30
      }
      
      newPositions.set(board.id, { x, y, width, height })
      
      devLog(`📂 [useBoardState] Loaded ${board.id}:`, {
        api: { x: board.position.x, y: board.position.y },
        normalized: { x, y },
        dimensions: { width, height }
      })
    })
    
    setBoardPositions(newPositions)
    return newPositions
  }, [apiToNormalized, apiToDecimal])
  
  /**
   * Push current boardPositions to undo stack (call before mutating)
   */
  const pushUndo = useCallback(() => {
    const current = boardPositionsRef.current
    if (current.size === 0) return
    const snapshot = Array.from(current.entries())
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), snapshot]
    redoStackRef.current = []
  }, [])

  /**
   * Restore boardPositions and sync boards array from a snapshot
   */
  const applySnapshot = useCallback((snapshot: [string, BoardPosition][]) => {
    const map = new Map(snapshot)
    setBoardPositions(map)
    setBoards(prev => prev.map(b => {
      const pos = map.get(b.id)
      if (!pos || !b.position) return b
      return {
        ...b,
        position: {
          ...b.position,
          x: normalizedToApi(pos.x),
          y: normalizedToApi(pos.y),
          width: decimalToApi(pos.width),
          height: decimalToApi(pos.height)
        }
      }
    }))
  }, [normalizedToApi, decimalToApi])

  const undo = useCallback(() => {
    const stack = undoStackRef.current
    if (stack.length === 0) return
    const current = Array.from(boardPositionsRef.current.entries())
    redoStackRef.current = [...redoStackRef.current, current]
    const snapshot = stack[stack.length - 1]
    undoStackRef.current = stack.slice(0, -1)
    applySnapshot(snapshot)
  }, [applySnapshot])

  const redo = useCallback(() => {
    const stack = redoStackRef.current
    if (stack.length === 0) return
    const current = Array.from(boardPositionsRef.current.entries())
    undoStackRef.current = [...undoStackRef.current, current]
    const snapshot = stack[stack.length - 1]
    redoStackRef.current = stack.slice(0, -1)
    applySnapshot(snapshot)
  }, [applySnapshot])

  /**
   * Update board position (handles both local state and API save)
   */
  const updateBoardPosition = useCallback(async (
    boardId: string,
    wallIndex: number,
    x: number,  // normalized -0.5 to 0.5
    y: number,  // normalized -0.5 to 0.5
    width?: number,  // decimal 0.0 to 1.0
    height?: number,  // decimal 0.0 to 1.0
    side: 'front' | 'back' = 'front',
    rotation?: number  // radians; passed through to /api/boards PUT for persistence
  ) => {
      devLog('💾 [useBoardState] updateBoardPosition:', {
      boardId,
      wallIndex,
      normalized: { x, y },
        dimensions: { width, height },
        side,
    })
    
    pushUndo()

    // Capture prior local state for rollback if the API save fails.
    const priorPosition = boardPositionsRef.current.get(boardId)
    const priorBoard = boardsRef.current.find(b => b.id === boardId)
    const priorBoardPosition = priorBoard?.position ? { ...priorBoard.position } : null

    // Update local position immediately (normalized)
    setBoardPositions(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(boardId)

      newMap.set(boardId, {
        x,
        y,
        width: width ?? existing?.width ?? 0.3,
        height: height ?? existing?.height ?? 0.3
      })

      return newMap
    })

    const board = boardsRef.current.find(b => b.id === boardId)
    if (!board) {
      console.warn('⚠️ [useBoardState] Board not found:', boardId)
      return Promise.resolve()
    }

    const rollback = () => {
      setBoardPositions(prev => {
        const newMap = new Map(prev)
        if (priorPosition) {
          newMap.set(boardId, priorPosition)
        } else {
          newMap.delete(boardId)
        }
        return newMap
      })
      setBoards(prev => prev.map(b => {
        if (b.id !== boardId) return b
        if (priorBoardPosition) return { ...b, position: priorBoardPosition }
        const { position: _drop, ...rest } = b
        void _drop
        return rest as Board
      }))
    }

    // API format (0-100) for optimistic update and PUT
    const apiX = normalizedToApi(x)
    const apiY = normalizedToApi(y)
    const apiWidth = width != null ? decimalToApi(width) : (board.position?.width ?? 30)
    const apiHeight = height != null ? decimalToApi(height) : (board.position?.height ?? 30)
    const positionSide = side || 'front'

    // Optimistically update board.position so sync/loadWallPositions include this board (boards stay visible even if PUT fails)
    setBoards(prev => prev.map(b => {
      if (b.id !== boardId) return b
      return {
        ...b,
        position: {
          wallIndex,
          x: apiX,
          y: apiY,
          width: apiWidth,
          height: apiHeight,
          side: positionSide,
          // Preserve rotation: use the explicitly-passed value when given,
          // otherwise fall back to whatever the board already has. Without
          // this, rebuilding the position object here would silently strip
          // rotation set earlier in the same edit session by Callsite B's
          // /position PATCH success branch.
          rotation: rotation ?? b.position?.rotation,
        },
      }
    }))
    
    // Save to API in background (skip for temp/demo/sample so we don't 404)
    try {
      const boardWorkspaceId = board.workspaceId || board.studioId || ''
      const shouldSkipPersistence =
        boardId.startsWith('temp-') ||
        boardId.startsWith('demo-') ||
        boardId.startsWith('sample-') ||
        boardWorkspaceId.startsWith('demo-') ||
        boardWorkspaceId.startsWith('sample-') ||
        boardWorkspaceId.startsWith('mock-')
      if (shouldSkipPersistence) {
        devLog('⚠️ [useBoardState] Skipping API save for non-persisted board', { boardId, boardWorkspaceId })
        return Promise.resolve()
      }
      
      devLog('💾 [useBoardState] Saving to API:', {
        boardId,
        api: { x: apiX, y: apiY, width: apiWidth, height: apiHeight }
      })
      
      // Create board object without position, then add it explicitly
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { position: _position, ...boardWithoutPosition } = board
      
      const response = await fetch('/api/boards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...boardWithoutPosition,
          workspaceId: board.studioId,
          studioId: board.studioId,
          position: {
            wallIndex,
            x: apiX,
            y: apiY,
            width: apiWidth,
            height: apiHeight,
            side: positionSide,
            // Forward rotation when known so /api/boards PUT can persist
            // position_rotation. Caller passes undefined when it doesn't
            // know — the route's update branch ignores undefined.
            rotation,
          }
        })
      })
      
      if (!response.ok) {
        console.error('❌ [useBoardState] API save failed', { status: response.status, statusText: response.statusText })
        rollback()
        toast.error('Failed to save board position. Please try again.')
        return
      }
      
      // Update the board in the boards array with new position (in API format)
      // This ensures WallSystem sees the updated position immediately
      setBoards(prev => prev.map(b => {
        if (b.id === boardId) {
          return {
            ...b,
            position: {
              wallIndex,
              x: apiX,
                y: apiY,
                width: apiWidth,
                height: apiHeight,
                side: b.position?.side || side || 'front',
                rotation: rotation ?? b.position?.rotation,
            }
          }
        }
        return b
      }))
      
      devLog('✅ [useBoardState] Position saved successfully and boards array updated')
    } catch (error: unknown) {
      // Network failure: roll back the optimistic local state and notify the user.
      console.error('❌ [useBoardState] Failed to save position:', error)
      rollback()
      toast.error('Failed to save board position. Please try again.')
      return
    }
  }, [normalizedToApi, decimalToApi])
  
  /**
   * Delete a board
   */
  const deleteBoard = useCallback(async (boardId: string) => {
    devLog('🗑️ [useBoardState] Deleting board:', boardId)
    
    try {
      const response = await fetch(`/api/boards?boardId=${boardId}`, {
        method: 'DELETE'
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        if (response.status === 403) {
          toast.error(`You can only delete boards in workspaces you're a member of${data.ownerName ? `. This board belongs to ${data.ownerName}.` : '.'}`)
        } else if (response.status === 401) {
          toast.error('You must be signed in to delete boards')
        } else {
          toast.error(data.error || 'Failed to delete board')
        }
        return false
      }
      
      // Remove from local state
      setBoards(prev => prev.filter(b => b.id !== boardId))
      setBoardPositions(prev => {
        const newMap = new Map(prev)
        newMap.delete(boardId)
        return newMap
      })
      
      // Refresh from server
      await onRefresh()
      
      devLog('✅ [useBoardState] Board deleted successfully')
      return true
    } catch (error) {
      console.error('❌ [useBoardState] Delete failed:', error)
      toast.error('Failed to delete board')
      return false
    }
  }, [onRefresh])
  
  /**
   * Add a temporary board (for optimistic uploads)
   */
  const addTempBoard = useCallback((board: Board, blobUrl: string) => {
    devLog('➕ [useBoardState] Adding temp board:', board.id)
    setTempBoards(prev => new Map(prev).set(board.id, { board, blobUrl }))
    setBoards(prev => [...prev, board])
    
    // Add position: temp boards always at center (0,0) so sync effect never overwrites with corner
    if (board.position) {
      const isTemp = board.id.startsWith('temp-')
      const x = isTemp ? 0 : apiToNormalized(board.position.x)
      const y = isTemp ? 0 : apiToNormalized(board.position.y)
      const width = board.position.width ? apiToDecimal(board.position.width) : 0.3
      const height = board.position.height ? apiToDecimal(board.position.height) : 0.3
      setBoardPositions(prev => new Map(prev).set(board.id, { x, y, width, height }))
    }
  }, [apiToNormalized, apiToDecimal])
  
  /**
   * Replace temporary board with real board from API
   */
  const replaceTempBoard = useCallback((tempId: string, realBoard: Board) => {
    devLog('🔄 [useBoardState] Replacing temp board:', tempId, '→', realBoard.id)
    const temp = tempBoardsRef.current.get(tempId)
    if (temp && typeof temp.blobUrl === 'string' && temp.blobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(temp.blobUrl)
    }
    
    // Remove temp board
    setTempBoards(prev => {
      const newMap = new Map(prev)
      newMap.delete(tempId)
      return newMap
    })
    
    // Replace in boards list
    optimisticBoardUntilRef.current.set(realBoard.id, Date.now() + 30000)
    setBoards(prev => {
      let replaced = false
      const next = prev.map(b => {
        if (b.id === tempId) {
          replaced = true
          return realBoard
        }
        return b
      })
      if (!replaced) next.push(realBoard)
      return next
    })
    
    // Update positions map
    setBoardPositions(prev => {
      const newMap = new Map(prev)
      const tempPosInner = newMap.get(tempId)
      
      if (tempPosInner) {
        newMap.delete(tempId)
        newMap.set(realBoard.id, tempPosInner)
      } else if (realBoard.position) {
        // Add position from real board
        const x = apiToNormalized(realBoard.position.x)
        const y = apiToNormalized(realBoard.position.y)
        const width = realBoard.position.width ? apiToDecimal(realBoard.position.width) : 0.3
        const height = realBoard.position.height ? apiToDecimal(realBoard.position.height) : 0.3
        newMap.set(realBoard.id, { x, y, width, height })
      }
      
      return newMap
    })
  }, [apiToNormalized, apiToDecimal])
  
  /**
   * Remove a temporary board (cleanup on error)
   */
  const removeTempBoard = useCallback((tempId: string) => {
    devLog('🧹 [useBoardState] Removing temp board:', tempId)
    
    const temp = tempBoardsRef.current.get(tempId)
    if (temp && typeof temp.blobUrl === 'string' && temp.blobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(temp.blobUrl)
    }
    
    setTempBoards(prev => {
      const newMap = new Map(prev)
      newMap.delete(tempId)
      return newMap
    })
    
    setBoards(prev => prev.filter(b => b.id !== tempId))

    setBoardPositions(prev => {
      const newMap = new Map(prev)
      newMap.delete(tempId)
      return newMap
    })
  }, [])

  /**
   * Local-only rotation update — mirrors a successful rotate / resize PATCH
   * back into the boards array so post-edit-mode rendering (WallSystem reads
   * board.position.rotation) sees the new value without waiting for a refetch.
   *
   * Bails out via referential equality when the value hasn't changed, so
   * callers can fire it from a per-PATCH success branch without forcing a
   * re-render of consumers each time.
   */
  const applyBoardRotationLocal = useCallback((boardId: string, rotation: number) => {
    setBoards(prev => {
      let changed = false
      const next = prev.map(b => {
        if (b.id !== boardId) return b
        const current = b.position?.rotation ?? b.position_rotation ?? 0
        if (current === rotation) return b
        changed = true
        return {
          ...b,
          position: b.position ? { ...b.position, rotation } : b.position,
          position_rotation: rotation,
        }
      })
      return changed ? next : prev
    })
  }, [])

  return {
    boards,
    boardPositions,
    loadWallPositions,
    updateBoardPosition,
    applyBoardRotationLocal,
    deleteBoard,
    addTempBoard,
    replaceTempBoard,
    removeTempBoard,
    undo,
    redo,
    // Expose conversion functions for upload logic
    normalizedToApi,
    apiToNormalized,
    decimalToApi,
    apiToDecimal
  }
}