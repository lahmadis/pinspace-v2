import { useState, useRef, useCallback, useEffect } from 'react'
import type { Board } from '@/types'

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
  
  // Keep refs in sync
  useEffect(() => { boardsRef.current = boards }, [boards])
  useEffect(() => { boardPositionsRef.current = boardPositions }, [boardPositions])
  useEffect(() => { tempBoardsRef.current = tempBoards }, [tempBoards])
  
  // Sync with parent boards (only update if actually changed)
  useEffect(() => {
    const boardMap = new Map(boards.map(b => [b.id, b]))
    
    // Add/update boards from parent
    initialBoards.forEach(board => boardMap.set(board.id, board))
    
    // Remove deleted boards (except temp ones)
    if (initialBoards.length > 0) {
      const parentIds = new Set(initialBoards.map(b => b.id))
      Array.from(boardMap.keys()).forEach(id => {
        if (!parentIds.has(id) && !id.startsWith('temp-')) {
          boardMap.delete(id)
        }
      })
    }
    
    setBoards(Array.from(boardMap.values()))
  }, [initialBoards])
  
  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      console.log('🧹 [useBoardState] Cleaning up blob URLs')
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
  const loadWallPositions = useCallback((wallIndex: number, wallDimensions: { width: number; height: number }) => {
    console.log(`📂 [useBoardState] Loading positions for wall ${wallIndex}`)
    
    const newPositions = new Map<string, BoardPosition>()
    const wallBoards = boardsRef.current.filter(b => b.position?.wallIndex === wallIndex)
    
    console.log(`📂 [useBoardState] Found ${wallBoards.length} boards on wall ${wallIndex}`)
    
    wallBoards.forEach(board => {
      if (!board.position) return
      
      // Convert from API format (0-100) to internal normalized (-0.5 to 0.5)
      const x = apiToNormalized(board.position.x)
      const y = apiToNormalized(board.position.y)
      
      // Calculate dimensions
      let width: number
      let height: number
      
      // Priority: physical dimensions > saved dimensions > aspect ratio > defaults
      if (board.physicalWidth && board.physicalHeight) {
        const wallWidthInches = wallDimensions.width * 12
        const wallHeightInches = wallDimensions.height * 12
        width = Math.min(board.physicalWidth / wallWidthInches, 1.0)
        height = Math.min(board.physicalHeight / wallHeightInches, 1.0)
      } else if (board.position.width !== undefined && board.position.height !== undefined) {
        // Convert saved percentages to decimal
        width = apiToDecimal(board.position.width)
        height = apiToDecimal(board.position.height)
      } else if (board.aspectRatio) {
        // Calculate from aspect ratio
        const baseHeight = 0.35
        height = baseHeight
        const wallAspectRatio = wallDimensions.width / wallDimensions.height
        width = baseHeight * board.aspectRatio / wallAspectRatio
        width = Math.min(width, 0.50)
        height = Math.min(height, 0.60)
      } else {
        // Default
        width = 0.30
        height = 0.30
      }
      
      newPositions.set(board.id, { x, y, width, height })
      
      console.log(`📂 [useBoardState] Loaded ${board.id}:`, {
        api: { x: board.position.x, y: board.position.y },
        normalized: { x, y },
        dimensions: { width, height }
      })
    })
    
    setBoardPositions(newPositions)
    return newPositions
  }, [apiToNormalized, apiToDecimal])
  
  /**
   * Update board position (handles both local state and API save)
   */
  const updateBoardPosition = useCallback(async (
    boardId: string,
    wallIndex: number,
    x: number,  // normalized -0.5 to 0.5
    y: number,  // normalized -0.5 to 0.5
    width?: number,  // decimal 0.0 to 1.0
    height?: number  // decimal 0.0 to 1.0
  ) => {
    console.log('💾 [useBoardState] updateBoardPosition:', {
      boardId,
      wallIndex,
      normalized: { x, y },
      dimensions: { width, height }
    })
    
    // Update local position immediately
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
    
    // Save to API in background
    try {
      const board = boardsRef.current.find(b => b.id === boardId)
      if (!board) {
        console.warn('⚠️ [useBoardState] Board not found:', boardId)
        return
      }
      
      // Convert to API format (0-100)
      const apiX = normalizedToApi(x)
      const apiY = normalizedToApi(y)
      const apiWidth = width ? decimalToApi(width) : (board.position?.width ?? 30)
      const apiHeight = height ? decimalToApi(height) : (board.position?.height ?? 30)
      
      console.log('💾 [useBoardState] Saving to API:', {
        boardId,
        api: { x: apiX, y: apiY, width: apiWidth, height: apiHeight }
      })
      
      const response = await fetch('/api/boards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...board,
          workspaceId: board.studioId,
          studioId: board.studioId,
          position: {
            wallIndex,
            x: apiX,
            y: apiY,
            width: apiWidth,
            height: apiHeight
          }
        })
      })
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }
      
      console.log('✅ [useBoardState] Position saved successfully')
    } catch (error: any) {
      console.error('❌ [useBoardState] Failed to save position:', error)
    }
  }, [normalizedToApi, decimalToApi])
  
  /**
   * Delete a board
   */
  const deleteBoard = useCallback(async (boardId: string) => {
    console.log('🗑️ [useBoardState] Deleting board:', boardId)
    
    try {
      const response = await fetch(`/api/boards?boardId=${boardId}`, {
        method: 'DELETE'
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        if (response.status === 403) {
          alert(`You can only delete boards in workspaces you're a member of${data.ownerName ? `. This board belongs to ${data.ownerName}.` : '.'}`)
        } else if (response.status === 401) {
          alert('You must be signed in to delete boards')
        } else {
          alert(data.error || 'Failed to delete board')
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
      
      console.log('✅ [useBoardState] Board deleted successfully')
      return true
    } catch (error) {
      console.error('❌ [useBoardState] Delete failed:', error)
      alert('Failed to delete board')
      return false
    }
  }, [onRefresh])
  
  /**
   * Add a temporary board (for optimistic uploads)
   */
  const addTempBoard = useCallback((board: Board, blobUrl: string) => {
    console.log('➕ [useBoardState] Adding temp board:', board.id)
    
    setTempBoards(prev => new Map(prev).set(board.id, { board, blobUrl }))
    setBoards(prev => [...prev, board])
    
    // Add position if board has one
    if (board.position) {
      const x = apiToNormalized(board.position.x)
      const y = apiToNormalized(board.position.y)
      const width = board.position.width ? apiToDecimal(board.position.width) : 0.3
      const height = board.position.height ? apiToDecimal(board.position.height) : 0.3
      
      setBoardPositions(prev => new Map(prev).set(board.id, { x, y, width, height }))
    }
  }, [apiToNormalized, apiToDecimal])
  
  /**
   * Replace temporary board with real board from API
   */
  const replaceTempBoard = useCallback((tempId: string, realBoard: Board) => {
    console.log('🔄 [useBoardState] Replacing temp board:', tempId, '→', realBoard.id)
    
    // Revoke blob URL
    const temp = tempBoardsRef.current.get(tempId)
    if (temp) {
      URL.revokeObjectURL(temp.blobUrl)
    }
    
    // Remove temp board
    setTempBoards(prev => {
      const newMap = new Map(prev)
      newMap.delete(tempId)
      return newMap
    })
    
    // Replace in boards list
    setBoards(prev => prev.map(b => b.id === tempId ? realBoard : b))
    
    // Update positions map
    setBoardPositions(prev => {
      const newMap = new Map(prev)
      const tempPos = newMap.get(tempId)
      
      if (tempPos) {
        newMap.delete(tempId)
        newMap.set(realBoard.id, tempPos)
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
    console.log('🧹 [useBoardState] Removing temp board:', tempId)
    
    // Revoke blob URL
    const temp = tempBoardsRef.current.get(tempId)
    if (temp) {
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
  
  return {
    boards,
    boardPositions,
    loadWallPositions,
    updateBoardPosition,
    deleteBoard,
    addTempBoard,
    replaceTempBoard,
    removeTempBoard,
    // Expose conversion functions for upload logic
    normalizedToApi,
    apiToNormalized,
    decimalToApi,
    apiToDecimal
  }
}