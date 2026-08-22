import { useState, useRef, useCallback, useEffect } from 'react'
import type { Board } from '@/types'
import { toast } from '@/lib/toast'
import { markBoardReconciling } from '@/lib/pendingBoardReconcile'
import { enqueueBoardWrite } from '@/lib/boardPositionWriteQueue'

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
  /**
   * Full room refetch. Now used on ONE path: a delete that failed.
   *
   * deleteBoard used to await this after every deletion — a dozen sequential
   * queries to rediscover the one row it had just removed, on the
   * most-felt interaction in the room. Local state and the boards realtime
   * event already tell every client what happened, so on the happy path it was
   * pure latency.
   *
   * It is still needed when a delete comes back as a failure, because that
   * answer can be wrong: a request can commit server-side and still report an
   * error (gateway timeout, a keepalive response that never arrives). Restoring
   * the board then leaves a ghost that no realtime event will correct, since
   * this client is the one that deleted it. See restoreAndReconcile.
   */
  onRefresh: () => Promise<void>,
  // The wall + side the local user is actively editing in 2D, or null when not
  // in edit mode. While set, boardPositions is the SOLE source of truth for
  // that wall's board positions: parent refetches / realtime / reconcile may
  // refresh metadata but must NOT overwrite position for boards on this wall
  // (see parent-sync below). Incoming server positions for the wall are only
  // adopted once this clears or changes (Save & Exit / wall switch).
  editContext?: { wall: number | null; side: 'front' | 'back' }
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

  // FIX 2: temp-id → real-id alias map. A drag/resize gesture started on a temp
  // board can deliver its final position AFTER replaceTempBoard has swapped the
  // temp id for the real one (observed: pointer-up fired ~9s after the swap).
  // Such a write would land in boardPositions under a dead temp key and the
  // real board would keep its pre-drag placement — the visible "revert". Every
  // position write resolves its incoming id through this map first, so late
  // temp-keyed writes retarget the real board (and persist, since the resolved
  // id is no longer a temp id). Entries self-expire (~60s).
  const boardIdAliasRef = useRef<Map<string, { realId: string; expiry: number }>>(new Map())
  const resolveBoardId = useCallback((id: string): string => {
    const alias = boardIdAliasRef.current.get(id)
    if (!alias) return id
    if (alias.expiry < Date.now()) {
      boardIdAliasRef.current.delete(id)
      return id
    }
    return alias.realId
  }, [])

  // Active 2D edit target, mirrored into refs so the parent-sync effect (which
  // only re-runs on initialBoards) always reads the latest value without
  // re-subscribing. null wall = not editing → server positions flow normally.
  const activeEditWallRef = useRef<number | null>(editContext?.wall ?? null)
  const activeEditSideRef = useRef<'front' | 'back'>(editContext?.side ?? 'front')
  useEffect(() => {
    activeEditWallRef.current = editContext?.wall ?? null
    activeEditSideRef.current = editContext?.side ?? 'front'
  }, [editContext?.wall, editContext?.side])
  
  /**
   * Undo/redo: a snapshot of boardPositions, TAGGED with the wall it describes.
   *
   * The tag is load-bearing now that undo writes to the server. A snapshot is
   * an untagged `id -> {x,y,w,h}` map, and boardPositions is replaced wholesale
   * on wall entry — so an undo taken on wall 0 and replayed on wall 1 used to
   * wipe wall 1's live entries and, worse, would now PUT wall 0's coordinates
   * onto whatever wall those boards currently sit on. While undo was
   * local-only that was a glitch a refetch erased; persisted, it is silent
   * position loss across a wall the user was not even looking at.
   *
   * Two defences, deliberately both: the stacks are cleared whenever the edited
   * wall changes, and applySnapshot refuses a snapshot whose tag does not match
   * the wall in hand. The clear is what normally keeps this from arising; the
   * tag is what makes a missed clear harmless rather than destructive.
   */
  interface PositionSnapshot {
    wall: number | null
    side: 'front' | 'back'
    entries: [string, BoardPosition][]
  }
  const undoStackRef = useRef<PositionSnapshot[]>([])
  const redoStackRef = useRef<PositionSnapshot[]>([])
  const MAX_UNDO = 50

  /**
   * Boards removed locally whose DELETE has not landed yet.
   *
   * The parent still lists them for the length of the undo window, so without
   * this the sync effect below puts them straight back the moment anything
   * refreshes the parent's array.
   */
  const stagedDeleteIdsRef = useRef<Set<string>>(new Set())

  /**
   * Bumped whenever positions change from something OTHER than a live gesture —
   * today, an undo or a redo.
   *
   * DraggableBoard ignores incoming position props for two seconds after a drag
   * (justFinishedDragging), because a slow save's echo would otherwise snap the
   * board back to where it started. An undo is the opposite case: an
   * intentional external move that must win, and pressing Ctrl+Z immediately
   * after a drag — which is when people press it — lands squarely inside that
   * window. The board's data changed, the screen did not, and it only appeared
   * to work after leaving edit mode remounted everything from the server.
   *
   * A counter rather than a flag: it has to be distinguishable from "the same
   * external change again", and a number that only ever increases is the
   * cheapest thing every consumer can compare against what it last saw.
   */
  const [positionEpoch, setPositionEpoch] = useState(0)

  /**
   * A snapshot only means anything on the wall it was taken from.
   *
   * Cleared on every change of edited wall or side — including leaving edit
   * mode altogether, which is what stops a stale stack from being replayed
   * against the 3D room later.
   */
  useEffect(() => {
    undoStackRef.current = []
    redoStackRef.current = []
  }, [editContext?.wall, editContext?.side])
  
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

    /**
     * Phase 5.2: keep the local absolute size when a parent refetch /
     * realtime UPDATE flows in. The DB row for a freshly uploaded board
     * carries the upload-time ORIGINAL boardWidthIn/Height — no resize PATCH
     * ever fires for a temp id, so any in-session resize lives ONLY in our
     * local `boards[id].boardWidthIn`. Without this fallback, the wholesale
     * `{ ...parentBoard, ... }` assignment in the branches below silently
     * overwrites the user's NEW size with the DB's ORIGINAL, mirroring the
     * exact clobber Phase 5.1 fixed at the temp→real swap one layer down.
     * When there's no `ex`, the parent is brand-new locally — return as-is.
     */
    const preferLocalSize = (parent: Board, ex: Board | undefined): Board =>
      ex ? {
        ...parent,
        boardWidthIn:  ex.boardWidthIn  ?? parent.boardWidthIn,
        boardHeightIn: ex.boardHeightIn ?? parent.boardHeightIn,
        // linkUrl is SERVER-authoritative (set via PUT on a real board id, not
        // a temp-only local edit like size), so the parent/server value wins.
        // Stated explicitly alongside size so this clobber-prone wholesale
        // `{ ...parent }` assignment can never accidentally pin a stale local
        // link or, conversely, drop a freshly-saved one.
        linkUrl: parent.linkUrl,
      } : parent

    initialBoards.forEach((parentBoard) => {
      // A board the local user has just deleted is NOT re-added, however fresh
      // the parent's copy looks. The parent keeps listing it until the DELETE
      // lands, so any refetch inside the undo window — someone else's upload,
      // a reorder, another user's edit — would otherwise put it back on the
      // wall seconds after the user removed it. See stagedDeleteIdsRef.
      if (stagedDeleteIdsRef.current.has(parentBoard.id)) {
        // Drop the upload hold too. Returning without this leaves a dead entry
        // for a board that was uploaded and then deleted inside its own hold
        // window — harmless, but it accumulates for the life of the session.
        optimisticBoardUntilRef.current.delete(parentBoard.id)
        return
      }

      const existing = boardMap.get(parentBoard.id)
      const parentHasPosition = hasValidPosition(parentBoard)
      const existingHasPosition = existing != null && hasValidPosition(existing)
      const parentSide = parentBoard.position?.side || 'front'
      const existingSide = existing?.position?.side || 'front'
      // Single ownership during an edit session: while the user is actively
      // editing a wall in 2D, boardPositions (in StudioRoom, fed by drags /
      // temp→real swap) owns on-screen placement for every board on that wall.
      // A parent refetch / realtime UPDATE / reconcile that lands mid-session
      // must refresh metadata (thumbnail, link, size handled by preferLocalSize)
      // but NOT move the board — otherwise a fresh upload dragged while its
      // upload is in flight snaps back to the server's upload-time origin once
      // the 30s optimistic hold below expires. So whenever the LOCAL board sits
      // on the actively-edited wall+side and has a valid position, keep the
      // local position regardless of the hold. The server position is adopted
      // only after the session ends or the wall changes (activeEditWallRef
      // flips), at which point Save & Exit has already PUT the local values so
      // the adopt is a no-op. Hold is left intact (not cleared) here.
      const activeWall = activeEditWallRef.current
      const onActiveWall =
        activeWall != null &&
        existingHasPosition &&
        existing!.position != null &&
        Number(existing!.position.wallIndex) === activeWall &&
        existingSide === activeEditSideRef.current
      if (onActiveWall && existing!.position) {
        boardMap.set(parentBoard.id, {
          ...preferLocalSize(parentBoard, existing),
          position: normalizePosition(existing!.position),
        })
        return // keep local position for the whole edit session
      }

      // Optimistic hold: within the window opened by replaceTempBoard, the
      // server row is still the upload-time ORIGINAL (a move/scale done before
      // the flush PUT round-trips hasn't landed yet). Adopting
      // normalizePosition(parentBoard.position) here would snap the board back
      // to center — the exact fresh-upload revert this fixes. So while the hold
      // is active and the local board has a valid position, KEEP the local
      // position (size is still carried by preferLocalSize). The hold is NOT
      // cleared in this branch — only when it expires or when we actually adopt
      // the server position below — so the protection lasts the whole window.
      const holdUntil = optimisticBoardUntilRef.current.get(parentBoard.id) ?? 0
      const holdActive = holdUntil > Date.now()
      if (holdActive && existingHasPosition && existing!.position) {
        boardMap.set(parentBoard.id, {
          ...preferLocalSize(parentBoard, existing),
          position: normalizePosition(existing!.position),
        })
        return // keep the hold; skip the adopt-server + hold-delete below
      }

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
          ...preferLocalSize(parentBoard, existing),
          position: normalizePosition({ ...parentBoard.position, side: 'back' }),
        })
      } else if (parentHasPosition && parentBoard.position) {
        boardMap.set(parentBoard.id, {
          ...preferLocalSize(parentBoard, existing),
          position: normalizePosition(parentBoard.position),
        })
      } else if (existingHasPosition && existing!.position) {
        boardMap.set(parentBoard.id, {
          ...preferLocalSize(parentBoard, existing),
          position: normalizePosition(existing!.position),
        })
      } else {
        boardMap.set(parentBoard.id, preferLocalSize(parentBoard, existing))
      }
      // Once server includes this board (hold expired or server position
      // adopted), clear optimistic hold.
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
    // Tagged with the wall being edited, so it can never be replayed onto
    // another one. See PositionSnapshot.
    const snapshot: PositionSnapshot = {
      wall: activeEditWallRef.current,
      side: activeEditSideRef.current,
      entries: Array.from(current.entries()),
    }
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), snapshot]
    redoStackRef.current = []
  }, [])

  /**
   * Write a set of positions to the server, with no local state change and no
   * undo bookkeeping.
   *
   * The persistence half of updateBoardPosition, without the parts undo must
   * not repeat: it does not pushUndo, does not touch boardPositions, and does
   * not roll anything back locally — applySnapshot has already committed the
   * state this is catching the server up to.
   *
   * Same skip rules and the same per-board write queue as the interactive path,
   * so an undo racing a drag's own save commits in issue order rather than
   * whichever response lands last.
   */
  const persistPositions = useCallback(
    async (entries: ReadonlyArray<{ boardId: string; pos: BoardPosition }>) => {
      await Promise.all(
        entries.map(async ({ boardId: rawBoardId, pos }) => {
          // Resolved like the interactive path: a snapshot taken before an
          // upload's temp→real swap still holds the temp key, and writing
          // against that would 404 instead of moving the real board.
          const boardId = resolveBoardId(rawBoardId)
          const board = boardsRef.current.find(b => b.id === boardId)
          if (!board) return

          const boardWorkspaceId = board.workspaceId || board.studioId || ''
          const shouldSkipPersistence =
            boardId.startsWith('temp-') ||
            boardId.startsWith('demo-') ||
            boardId.startsWith('sample-') ||
            boardWorkspaceId.startsWith('demo-') ||
            boardWorkspaceId.startsWith('sample-') ||
            boardWorkspaceId.startsWith('mock-')
          if (shouldSkipPersistence) return

          // The wall and side come from the board's own current position: an
          // undo restores where a board WAS on this wall, never which wall it
          // is on, so inventing either here could move a board between walls.
          const wallIndex = board.position?.wallIndex
          if (wallIndex === undefined || wallIndex === null) return
          const side = board.position?.side ?? 'front'

          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { position: _position, comments: _comments, ...boardWithoutPosition } = board

          try {
            const response = await enqueueBoardWrite(boardId, () =>
              fetch('/api/boards', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify({
                  ...boardWithoutPosition,
                  workspaceId: board.studioId,
                  studioId: board.studioId,
                  boardWidthIn: board.boardWidthIn,
                  boardHeightIn: board.boardHeightIn,
                  position: {
                    wallIndex,
                    x: normalizedToApi(pos.x),
                    y: normalizedToApi(pos.y),
                    width: decimalToApi(pos.width),
                    height: decimalToApi(pos.height),
                    side,
                  },
                }),
              })
            )
            if (!response.ok) {
              console.error('❌ [useBoardState] Undo/redo save failed', {
                boardId,
                status: response.status,
              })
              toast.error('Undo could not be saved. Reload before continuing.', { id: 'undo-save-failed' })
            }
          } catch (error) {
            console.error('❌ [useBoardState] Undo/redo save threw', boardId, error)
            toast.error('Undo could not be saved. Reload before continuing.', { id: 'undo-save-failed' })
          }
        })
      )
    },
    [normalizedToApi, decimalToApi, resolveBoardId]
  )

  /**
   * Restore boardPositions and sync boards array from a snapshot, AND WRITE IT.
   *
   * The write is the whole point, and it used to be missing. Undo set local
   * state and stopped there, so the board slid back and then the next refetch —
   * which fires after any board mutation, and on every reload — pulled the
   * server's unchanged value and slid it forward again. Ctrl+Z looked like it
   * worked for a second and then silently undid itself, which is worse than
   * having no undo at all.
   *
   * Only CHANGED boards are written. A snapshot holds the whole wall, and
   * PUTting every board on it for a one-board undo would be a dozen needless
   * writes, each rebroadcast to everyone in the room.
   *
   * No pushUndo here: undo and redo move entries BETWEEN the two stacks
   * themselves, and recording a fresh entry would both duplicate it and wipe
   * the redo branch the user is standing in.
   */
  const applySnapshot = useCallback((snapshot: PositionSnapshot): boolean => {
    // Refuse a snapshot from a different wall or side. Normally unreachable —
    // the stacks are cleared on every wall change — but the cost of being
    // wrong here is writing one wall's coordinates onto another's boards.
    devLog('[UNDO-DIAG] applySnapshot', {
      snapshotWall: snapshot.wall,
      snapshotSide: snapshot.side,
      currentWall: activeEditWallRef.current,
      currentSide: activeEditSideRef.current,
      entries: snapshot.entries.length,
    })
    if (
      snapshot.wall !== activeEditWallRef.current ||
      snapshot.side !== activeEditSideRef.current
    ) {
      devLog('↩️ [useBoardState] Discarding a snapshot from another wall/side', {
        snapshotWall: snapshot.wall,
        currentWall: activeEditWallRef.current,
      })
      return false
    }

    const before = boardPositionsRef.current
    // MERGED over the current map, not a replacement.
    //
    // A snapshot only describes the boards that existed when it was taken. A
    // board uploaded — or delete-restored — since then has a live entry that a
    // wholesale replace would drop, quietly excluding it from persistPositions
    // and from every later snapshot. Snapshot entries win for the ids they
    // cover; anything newer is left alone.
    // Snapshot entries for boards that no longer exist are dropped: a board
    // deleted since the snapshot was taken would otherwise get its position
    // entry resurrected here, orphaned from any board. persistPositions skips
    // it (no matching board), so it writes nothing — it just lingers in the map
    // and in every snapshot taken afterwards.
    const live = snapshot.entries
      // Retargeted temp->real first, like every other position write. A board
      // uploaded, dragged, then swapped to its real id is held in the snapshot
      // under the DEAD temp key: matching that raw against boardsRef finds
      // nothing, so the undo silently skipped exactly the board most likely to
      // be the one being undone.
      .map(([id, pos]) => [resolveBoardId(id), pos] as [string, BoardPosition])
      .filter(
        ([id]) => boardsRef.current.some(b => b.id === id) && !stagedDeleteIdsRef.current.has(id)
      )
    const map = new Map([...before, ...live])

    setBoardPositions(map)
    // Written SYNCHRONOUSLY, not left to the mirroring effect.
    //
    // That effect is passive, and Ctrl+Z on key-repeat fires far faster than it
    // flushes on a loaded 3D frame. The second undo would then read this ref as
    // the state before the FIRST one: it would push a duplicate onto the redo
    // stack, and the `before` diff below would compare against the wrong map
    // and filter out boards that genuinely changed — leaving them unwritten.
    // That is the "undo doesn't stick" bug this whole change exists to fix,
    // coming back in through the diff. Three other functions in this file
    // (replaceTempBoard, applyBoardSizeLocal, applyBoardLinkLocal) already
    // write their refs eagerly for exactly this reason.
    boardPositionsRef.current = map
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

    const moved: Array<{ boardId: string; pos: BoardPosition }> = []
    for (const [boardId, pos] of map) {
      const prior = before.get(boardId)
      if (
        prior &&
        prior.x === pos.x &&
        prior.y === pos.y &&
        prior.width === pos.width &&
        prior.height === pos.height
      ) {
        continue
      }
      moved.push({ boardId, pos })
    }
    devLog('[UNDO-DIAG] applySnapshot applying', {
      moved: moved.map((m) => ({ id: m.boardId, x: m.pos.x, y: m.pos.y })),
      mapSize: map.size,
    })
    if (moved.length > 0) void persistPositions(moved)
    // Tell the boards to take this position even if they think they just
    // finished a drag. See positionEpoch.
    setPositionEpoch((n) => n + 1)
    return true
  }, [normalizedToApi, decimalToApi, persistPositions, resolveBoardId])

  /** The state we are leaving, tagged the same way, so redo can return to it. */
  const currentSnapshot = useCallback(
    (): PositionSnapshot => ({
      wall: activeEditWallRef.current,
      side: activeEditSideRef.current,
      entries: Array.from(boardPositionsRef.current.entries()),
    }),
    []
  )

  const undo = useCallback(() => {
    const stack = undoStackRef.current
    devLog('[UNDO-DIAG] undo pressed', { stackDepth: stack.length })
    if (stack.length === 0) return
    const current = currentSnapshot()
    const snapshot = stack[stack.length - 1]
    undoStackRef.current = stack.slice(0, -1)
    // History is only consumed if the snapshot was actually applied. A refusal
    // that still popped would drain the undo stack on key-repeat and fill redo
    // with copies of the present — losing real history to a guard that exists
    // to protect it.
    if (!applySnapshot(snapshot)) {
      undoStackRef.current = stack
      return
    }
    redoStackRef.current = [...redoStackRef.current, current]
  }, [applySnapshot, currentSnapshot])

  const redo = useCallback(() => {
    const stack = redoStackRef.current
    if (stack.length === 0) return
    const current = currentSnapshot()
    const snapshot = stack[stack.length - 1]
    redoStackRef.current = stack.slice(0, -1)
    if (!applySnapshot(snapshot)) {
      redoStackRef.current = stack
      return
    }
    undoStackRef.current = [...undoStackRef.current, current]
  }, [applySnapshot, currentSnapshot])

  /**
   * Update board position (handles both local state and API save)
   */
  const updateBoardPosition = useCallback(async (
    rawBoardId: string,
    wallIndex: number,
    x: number,  // normalized -0.5 to 0.5
    y: number,  // normalized -0.5 to 0.5
    width?: number,  // decimal 0.0 to 1.0
    height?: number,  // decimal 0.0 to 1.0
    side: 'front' | 'back' = 'front',
  ) => {
      // FIX 2b: resolve temp→real before any write so a late drag that still
      // carries the temp id targets the real board (boards array, boardPositions
      // map, and the PUT all use the resolved id; a resolved id is real, so
      // persistence is no longer skipped as it would be for a temp id).
      const boardId = resolveBoardId(rawBoardId)
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
      
      // Create board object without position, then add it explicitly. Also drop
      // `comments` — an unbounded array the PUT route never reads — so the
      // keepalive body stays well under the 64KB keepalive budget when Save &
      // Exit fires one PUT per board in parallel.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { position: _position, comments: _comments, ...boardWithoutPosition } = board
      
      // Serialize per board so rapid successive writes for the SAME board commit
      // in issue order (different boards stay parallel). keepalive lets an in-
      // flight save survive Save & Exit navigating away.
      const response = await enqueueBoardWrite(boardId, () => fetch('/api/boards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          ...boardWithoutPosition,
          workspaceId: board.studioId,
          studioId: board.studioId,
          // Absolute board size (inches). Save & Exit acts as the retry path
          // for a corner-resize whose dedicated PATCH failed; board.boardWidthIn
          // reflects the latest resize via applyBoardSizeLocal.
          boardWidthIn: board.boardWidthIn,
          boardHeightIn: board.boardHeightIn,
          position: {
            wallIndex,
            x: apiX,
            y: apiY,
            width: apiWidth,
            height: apiHeight,
            side: positionSide,
          }
        })
      }))
      
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
  }, [normalizedToApi, decimalToApi, resolveBoardId])
  
  /**
   * Move MANY boards as one operation — one undo step, one local commit, one
   * round of writes.
   *
   * Exists because updateBoardPosition calls pushUndo() itself, so driving it in
   * a loop for a group move produces one undo entry PER BOARD: undoing a twelve-
   * board align would take twelve Ctrl+Z presses, each visibly relocating a
   * single board. pushUndo snapshots the whole position map, so pushing exactly
   * once here is all that "one undo step for the whole operation" requires.
   *
   * Also one setState per collection rather than one per board — twelve
   * sequential updateBoardPosition calls mean twelve renders of every board on
   * the wall.
   *
   * Coordinates match updateBoardPosition: x/y normalized -0.5..0.5, width and
   * height decimal 0..1. The 0..100 API form is derived here, never passed in.
   *
   * PARTIAL FAILURE ROLLS BACK ONLY THE BOARDS THAT FAILED. Rolling back all of
   * them would be worse: the successful writes are already committed server-side,
   * so a full local revert would leave the screen disagreeing with the database
   * on every board that actually saved. Reverting just the failures keeps local
   * state matching what was persisted, and the caller is told how many fell out.
   *
   * Returns counts rather than throwing — a group move that half-lands is a real
   * outcome the caller has to report, not an exception.
   *
   * THREE THINGS THE CALLER MUST NOT ASSUME:
   *
   *   - The counts do not necessarily sum. Ids that match no known board are
   *     dropped before any work happens, so `requested` can exceed
   *     `saved + failed`. Report `failed > 0`; do not derive it by subtraction.
   *   - `saved` counts local commits, not server writes. Demo/sample/temp boards
   *     deliberately skip persistence (same rule as the single-board path) and
   *     are counted as saved, because local state is authoritative for them.
   *   - Omitting `side` PRESERVES each board's current side. It does not default
   *     to 'front'. A group move must not silently flip boards from the back of
   *     a wall to the front, so the fallback chain is
   *     `u.side ?? board.position?.side ?? 'front'` — deliberately unlike the
   *     single-board path, whose caller always supplies a side.
   *
   * Like the single-board path, this does NOT sync boardsRef synchronously —
   * that ref is a post-commit mirror (see the effect near the top of this hook).
   * A caller that chains straight into a save in the same tick would read
   * pre-move positions from it.
   */
  const updateBoardPositionsBulk = useCallback(async (
    updates: ReadonlyArray<{
      boardId: string
      wallIndex: number
      x: number
      y: number
      width?: number
      height?: number
      side?: 'front' | 'back'
    }>
  ): Promise<{ requested: number; saved: number; failed: number }> => {
    // Resolve temp->real ids up front, same as the single-board path, and drop
    // anything that no longer corresponds to a board we know about.
    const resolved = updates
      .map(u => ({ ...u, boardId: resolveBoardId(u.boardId) }))
      .filter(u => boardsRef.current.some(b => b.id === u.boardId))

    if (resolved.length === 0) {
      return { requested: updates.length, saved: 0, failed: 0 }
    }


    // ONE undo entry for the entire operation. Must happen before any local
    // mutation — pushUndo snapshots current state as the restore point.
    pushUndo()

    // Prior state per board, for the per-board rollback described above.
    const prior = new Map(resolved.map(u => [u.boardId, {
      position: boardPositionsRef.current.get(u.boardId),
      boardPosition: boardsRef.current.find(b => b.id === u.boardId)?.position
        ? { ...boardsRef.current.find(b => b.id === u.boardId)!.position! }
        : null,
    }]))

    // Single local commit for the whole group.
    setBoardPositions(prev => {
      const next = new Map(prev)
      for (const u of resolved) {
        const existing = next.get(u.boardId)
        next.set(u.boardId, {
          x: u.x,
          y: u.y,
          width: u.width ?? existing?.width ?? 0.3,
          height: u.height ?? existing?.height ?? 0.3,
        })
      }
      return next
    })

    const byId = new Map(resolved.map(u => [u.boardId, u]))
    setBoards(prev => prev.map(b => {
      const u = byId.get(b.id)
      if (!u) return b
      return {
        ...b,
        position: {
          wallIndex: u.wallIndex,
          x: normalizedToApi(u.x),
          y: normalizedToApi(u.y),
          width: u.width != null ? decimalToApi(u.width) : (b.position?.width ?? 30),
          height: u.height != null ? decimalToApi(u.height) : (b.position?.height ?? 30),
          side: u.side ?? b.position?.side ?? 'front',
        },
      }
    }))

    // Writes go out in parallel across boards; enqueueBoardWrite still
    // serializes per board, so this cannot reorder against an in-flight drag
    // save for the same board.
    const results = await Promise.all(resolved.map(async (u) => {
      const board = boardsRef.current.find(b => b.id === u.boardId)
      if (!board) return { boardId: u.boardId, ok: false as const }

      const boardWorkspaceId = board.workspaceId || board.studioId || ''
      const shouldSkipPersistence =
        u.boardId.startsWith('temp-') ||
        u.boardId.startsWith('demo-') ||
        u.boardId.startsWith('sample-') ||
        boardWorkspaceId.startsWith('demo-') ||
        boardWorkspaceId.startsWith('sample-') ||
        boardWorkspaceId.startsWith('mock-')
      // Not a failure: these ids intentionally have no server row, and local
      // state is authoritative for them. Same rule as the single-board path.
      if (shouldSkipPersistence) return { boardId: u.boardId, ok: true as const }

      const apiX = normalizedToApi(u.x)
      const apiY = normalizedToApi(u.y)
      const apiWidth = u.width != null ? decimalToApi(u.width) : (board.position?.width ?? 30)
      const apiHeight = u.height != null ? decimalToApi(u.height) : (board.position?.height ?? 30)

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { position: _position, comments: _comments, ...boardWithoutPosition } = board
        const response = await enqueueBoardWrite(u.boardId, () => fetch('/api/boards', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            ...boardWithoutPosition,
            workspaceId: board.studioId,
            studioId: board.studioId,
            boardWidthIn: board.boardWidthIn,
            boardHeightIn: board.boardHeightIn,
            position: {
              wallIndex: u.wallIndex,
              x: apiX,
              y: apiY,
              width: apiWidth,
              height: apiHeight,
              side: u.side ?? board.position?.side ?? 'front',
            },
          }),
        }))
        if (!response.ok) {
          console.error('❌ [useBoardState] Bulk position save failed', {
            boardId: u.boardId, status: response.status, statusText: response.statusText,
          })
          return { boardId: u.boardId, ok: false as const }
        }
        return { boardId: u.boardId, ok: true as const }
      } catch (error) {
        console.error('❌ [useBoardState] Bulk position save threw', u.boardId, error)
        return { boardId: u.boardId, ok: false as const }
      }
    }))

    const failedIds = results.filter(r => !r.ok).map(r => r.boardId)

    if (failedIds.length > 0) {
      const failedSet = new Set(failedIds)
      setBoardPositions(prev => {
        const next = new Map(prev)
        for (const id of failedSet) {
          const p = prior.get(id)?.position
          if (p) next.set(id, p)
          else next.delete(id)
        }
        return next
      })
      setBoards(prev => prev.map(b => {
        if (!failedSet.has(b.id)) return b
        const p = prior.get(b.id)?.boardPosition
        if (p) return { ...b, position: p }
        const { position: _drop, ...rest } = b
        void _drop
        return rest as Board
      }))
    }

    const saved = results.length - failedIds.length
    return { requested: updates.length, saved, failed: failedIds.length }
  }, [normalizedToApi, decimalToApi, resolveBoardId, pushUndo])

  /**
   * Delete a board
   */
  /**
   * Take a board off the wall LOCALLY and hand back the way to put it back.
   *
   * Split from the network call so a delete can be undone. Board deletion
   * destroys the storage objects server-side (see the cascade in
   * /api/boards DELETE), so a board cannot be restored once the request has
   * gone — the only honest undo is one that happens BEFORE it does. Staging
   * locally and committing on a delay gives exactly that window, and the worst
   * case if the commit never runs is a board that survives, which is the safe
   * direction.
   */
  const stageBoardDelete = useCallback((boardId: string): (() => void) => {
    const removedBoard = boardsRef.current.find(b => b.id === boardId)
    const removedPosition = boardPositionsRef.current.get(boardId)

    // Remembered for the whole window, so the parent-sync effect below does not
    // put this board straight back.
    //
    // The parent's array still holds it until the DELETE lands, and ANY parent
    // refetch during those seconds — someone else's upload, a reorder, another
    // user's edit — re-runs the sync and resurrects it. A resurrected board can
    // then be selected and deleted a second time, which is how one board ends
    // up with two pending deletes and a 404 that used to resurrect it for good.
    stagedDeleteIdsRef.current = new Set(stagedDeleteIdsRef.current).add(boardId)

    setBoards(prev => prev.filter(b => b.id !== boardId))
    setBoardPositions(prev => {
      const newMap = new Map(prev)
      newMap.delete(boardId)
      return newMap
    })

    return () => {
      // Cleared first and unconditionally: the board is no longer staged for
      // deletion whether or not there is anything to put back, and leaving the
      // id in the set would keep the parent-sync effect filtering it forever.
      const next = new Set(stagedDeleteIdsRef.current)
      next.delete(boardId)
      stagedDeleteIdsRef.current = next

      if (!removedBoard) return
      // Guarded against double-restore: an undo and a failed commit can both
      // reach for this, and appending twice would duplicate the board.
      setBoards(prev => (prev.some(b => b.id === boardId) ? prev : [...prev, removedBoard]))
      if (removedPosition) {
        setBoardPositions(prev => {
          const newMap = new Map(prev)
          newMap.set(boardId, removedPosition)
          return newMap
        })
      }
    }
  }, [])

  /**
   * Send the delete for a board already staged by stageBoardDelete.
   *
   * `restore` is the closure that function returned; it runs if the server
   * refuses, putting the board back where it was.
   */
  const commitBoardDelete = useCallback(async (boardId: string, restore: () => void) => {
    devLog('🗑️ [useBoardState] Deleting board:', boardId)
    /** Stop filtering this id once the server has spoken, whatever it said. */
    const unstage = () => {
      const next = new Set(stagedDeleteIdsRef.current)
      next.delete(boardId)
      stagedDeleteIdsRef.current = next
    }
    /**
     * Put the board back, then check whether it should actually be there.
     *
     * A DELETE can commit server-side and still fail here — a gateway timeout,
     * a keepalive request whose response never arrives, a non-JSON error body.
     * Restoring on those puts a board on screen that no longer exists, and
     * nothing corrects it: no realtime DELETE is coming, because the client
     * that issued it is this one. The refetch this hook used to run after
     * EVERY delete happened to cover that; it is now run only here, on the one
     * path where local state might be wrong.
     */
    const restoreAndReconcile = () => {
      restore()
      void onRefresh().catch(() => {})
    }
    try {
      const response = await fetch(`/api/boards?boardId=${boardId}`, {
        method: 'DELETE',
        // keepalive so a delete flushed on pagehide or unmount actually leaves.
        // Without it the request is cancelled with the document and the board
        // silently comes back on the next load — which is the safe direction,
        // but it made the undo window's flush a no-op and contradicted the
        // comment in StudioRoom that justifies it. Every other write in this
        // hook already sets this.
        keepalive: true,
      })

      const data = await response.json()

      // 404 means the row is already gone — a retry, or a second delete of the
      // same board. That is success, not failure: restoring here would put a
      // board back on screen that no longer exists anywhere, and no realtime
      // event is coming to correct it.
      if (response.status === 404) {
        devLog('🗑️ [useBoardState] Board already gone:', boardId)
        unstage()
        return true
      }

      if (!response.ok) {
        if (response.status === 403) {
          toast.error(`You can only delete boards in workspaces you're a member of${data.ownerName ? `. This board belongs to ${data.ownerName}.` : '.'}`)
        } else if (response.status === 401) {
          toast.error('You must be signed in to delete boards')
        } else {
          toast.error(data.error || 'Failed to delete board')
        }
        restoreAndReconcile()
        return false
      }

      // NO refetch on the happy path. The local removal above is already correct for this user,
      // and everyone else learns from the boards realtime DELETE event, which
      // the studio page applies inline. The full GET this used to await reads
      // the whole room — a dozen sequential queries — to discover one thing we
      // already knew.
      devLog('✅ [useBoardState] Board deleted successfully')
      // Unstaged only AFTER the row is really gone. From here the parent's own
      // refetch will stop returning it, so the filter has nothing left to do.
      unstage()
      return true
    } catch (error) {
      console.error('❌ [useBoardState] Delete failed:', error)
      toast.error('Failed to delete board')
      restoreAndReconcile()
      return false
    }
  }, [onRefresh])

  /**
   * Stage and commit in one go, with no undo window.
   *
   * The original single-call shape, kept for every caller that deletes without
   * offering a way back — Clear Wall, and the wall-removal path, both of which
   * confirm first and delete in bulk.
   */
  const deleteBoard = useCallback(
    async (boardId: string) => {
      const restore = stageBoardDelete(boardId)
      return commitBoardDelete(boardId, restore)
    },
    [stageBoardDelete, commitBoardDelete]
  )
  
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
    
    // Replace in boards list. Merge — don't wholesale-replace — the local
    // temp board onto the server's realBoard so any optimistic edits the
    // user made during the temp-board window survive the reconcile.
    //
    // The race the merge closes: no resize PATCH fires for temp ids (see
    // DraggableBoard.tsx's `isMockBoard` skip), so a resize done before
    // the upload POST resolves only lives in `boards[tempId].boardWidthIn`.
    // realBoard always carries the upload-time original size — wholesale-
    // replacing here would discard the user's scale and Save & Exit would
    // then persist the original to the DB. Same race shape applies to
    // position, so it's merged too. For both fields the local value is
    // either the user's edit OR identical to realBoard's (the temp board
    // was seeded from the same aspect-ratio math the server runs), so the
    // merge is a no-op when the user didn't touch anything.
    optimisticBoardUntilRef.current.set(realBoard.id, Date.now() + 30000)

    // FIX 2a: record temp→real so a drag/resize that fires its pointer-up after
    // this swap (still carrying the temp id) retargets the real board instead of
    // writing a dead key. Kept ~60s — long enough to outlast any in-flight
    // gesture, short enough not to leak. FIX 2d: also mark the real id as
    // locally reconciling so the page's realtime INSERT handler skips appending
    // it (it would otherwise duplicate the id while the temp still exists).
    if (tempId !== realBoard.id) {
      boardIdAliasRef.current.set(tempId, { realId: realBoard.id, expiry: Date.now() + 60000 })
    }
    markBoardReconciling(realBoard.id)

    // Read the local temp board + its live normalized position from the refs
    // BEFORE mutating state. Deriving the flush inputs from the refs (the same
    // source updateBoardPosition itself reads) avoids depending on setState
    // updater timing — React may run an updater during a later render, not
    // synchronously at dispatch, so values captured inside the updaters below
    // can't be trusted immediately afterward.
    const localTemp = boardsRef.current.find(b => b.id === tempId)
    const carriedPos = boardPositionsRef.current.get(tempId)

    // Merge — don't wholesale-replace — the local temp board onto realBoard so
    // optimistic size (boardWidthIn/Height) and position survive the swap. No
    // resize/move PATCH fires for temp ids, so those edits live ONLY locally;
    // realBoard carries the upload-time original. linkUrl is server-authoritative
    // (never set on a temp id), so realBoard's value wins there.
    const mergedBoard: Board = {
      ...realBoard,
      boardWidthIn: localTemp?.boardWidthIn ?? realBoard.boardWidthIn,
      boardHeightIn: localTemp?.boardHeightIn ?? realBoard.boardHeightIn,
      linkUrl: realBoard.linkUrl,
      position: localTemp?.position ?? realBoard.position,
    }

    // Sync boardsRef synchronously OUTSIDE the updater so the flush below
    // (updateBoardPosition reads boardsRef.current to find the board + build its
    // PUT body) sees the real board immediately — a setState updater may not run
    // until a later render, so an in-updater ref write can't be relied on here.
    // FIX 2d: replace the temp entry with mergedBoard AND drop any pre-existing
    // entry already carrying the real id (a realtime INSERT can append the real
    // board before this swap runs). Guarantees the array never holds the id
    // twice, whichever order the swap and the INSERT land in.
    {
      const prevRef = boardsRef.current
      let replacedRef = false
      const nextRef: Board[] = []
      for (const b of prevRef) {
        if (b.id === tempId) { replacedRef = true; nextRef.push(mergedBoard); continue }
        if (b.id === realBoard.id) continue // dedupe: merged below is authoritative
        nextRef.push(b)
      }
      if (!replacedRef && !nextRef.some(b => b.id === mergedBoard.id)) nextRef.push(mergedBoard)
      boardsRef.current = nextRef
    }
    setBoards(prev => {
      let replaced = false
      const next: Board[] = []
      for (const b of prev) {
        if (b.id === tempId) { replaced = true; next.push(mergedBoard); continue }
        if (b.id === realBoard.id) continue // dedupe pre-existing real entry
        next.push(b)
      }
      if (!replaced && !next.some(b => b.id === mergedBoard.id)) next.push(mergedBoard)
      return next
    })

    // Update positions map: carry the temp board's live position over to the
    // real id (this is what keeps the on-screen placement after the swap).
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

    // Flush pending optimistic edits to the server for the now-real id. A
    // move/scale made during the temp window is only local (temp ids skip
    // persistence), so the server row is still the upload-time original; the
    // optimistic hold protects the next refetch, and THIS makes the server
    // itself correct so the edit survives the refetch AND Save & Exit + wall
    // re-entry (which read from the server).
    //
    // Same persistence path Save & Exit uses — updateBoardPosition PUTs the
    // position + boardWidthIn/boardHeightIn (read from boardsRef, synced above)
    // and skips non-real ids. Fire once, no retry: on failure it rolls back to
    // the current local values and the hold still covers the in-session view.
    if (mergedBoard.position && carriedPos) {
      const mp = mergedBoard.position
      const r = realBoard
      const approxEq = (a?: number, b?: number) => Math.abs((a ?? 0) - (b ?? 0)) <= 0.01
      const positionDiffers =
        !r.position ||
        !approxEq(mp.x, r.position.x) ||
        !approxEq(mp.y, r.position.y) ||
        !approxEq(mp.width, r.position.width) ||
        !approxEq(mp.height, r.position.height)
      const sizeDiffers =
        (mergedBoard.boardWidthIn ?? null) !== (r.boardWidthIn ?? null) ||
        (mergedBoard.boardHeightIn ?? null) !== (r.boardHeightIn ?? null)
      if (positionDiffers || sizeDiffers) {
        void updateBoardPosition(
          r.id,
          Number(mp.wallIndex),
          carriedPos.x,
          carriedPos.y,
          carriedPos.width,
          carriedPos.height,
          mp.side === 'back' ? 'back' : 'front',
        )
      }
    }
  }, [apiToNormalized, apiToDecimal, updateBoardPosition])
  
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
   * Local-only absolute-size update — mirrors a corner-resize back into the
   * boards array (board_width_in / board_height_in, in inches) so post-edit-
   * mode rendering (WallSystem reads board.boardWidthIn) sees the new size
   * without waiting for a refetch. Bails out via value equality when unchanged.
   *
   * Also writes to boardsRef synchronously: callers (DraggableBoard) apply
   * the resize on pointer-up *before* the PATCH fires so a same-tick Save &
   * Exit (which reads boardsRef.current.find(...).boardWidthIn) gets the
   * new dimensions instead of the pre-resize ones. Without the ref write,
   * the useEffect that mirrors `boards` into the ref would still hold the
   * stale value until React's next render — and the bulk save would race
   * (and often lose to) the in-flight resize PATCH.
   */
  const applyBoardSizeLocal = useCallback((boardId: string, widthIn: number, heightIn: number) => {
    boardsRef.current = boardsRef.current.map(b => {
      if (b.id !== boardId) return b
      if (b.boardWidthIn === widthIn && b.boardHeightIn === heightIn) return b
      return { ...b, boardWidthIn: widthIn, boardHeightIn: heightIn }
    })
    setBoards(prev => {
      let changed = false
      const next = prev.map(b => {
        if (b.id !== boardId) return b
        if (b.boardWidthIn === widthIn && b.boardHeightIn === heightIn) return b
        changed = true
        return { ...b, boardWidthIn: widthIn, boardHeightIn: heightIn }
      })
      return changed ? next : prev
    })
  }, [])

  /**
   * Local-only link-url update — mirrors a just-persisted video link (PUT in
   * LightboxModal.handleSaveLink) back into the boards array so the lightbox,
   * which re-reads the board from `boards` each time it opens, shows the link
   * without waiting for a refetch. Without this the PUT lands server-side but
   * the local boards array stays stale, so closing and reopening the lightbox
   * reads the old board and the link vanishes until a full refresh.
   *
   * linkUrl is normalized to string | undefined (the Board type has no null);
   * a null/empty save clears the field. Writes boardsRef synchronously too so
   * a same-tick read (e.g. parent-sync's preferLocalSize, which trusts the
   * server value) and the next render agree. Bails via value equality.
   */
  const applyBoardLinkLocal = useCallback((boardId: string, linkUrl: string | null) => {
    const next = linkUrl || undefined
    boardsRef.current = boardsRef.current.map(b =>
      b.id === boardId && b.linkUrl !== next ? { ...b, linkUrl: next } : b
    )
    setBoards(prev => {
      let changed = false
      const out = prev.map(b => {
        if (b.id !== boardId || b.linkUrl === next) return b
        changed = true
        return { ...b, linkUrl: next }
      })
      return changed ? out : prev
    })
  }, [])

  /**
   * Local-only title update — mirrors a just-persisted board title (PATCH in
   * LightboxModal.handleSaveTitle) back into the boards array so the lightbox,
   * which re-reads the board from `boards` on open/navigation, shows the new
   * title before the debounced realtime refetch lands. The refetch then adopts
   * the identical server value wholesale (title isn't specially preserved in
   * parent-sync), so this only bridges the gap. Writes boardsRef synchronously
   * too; bails via value equality. Mirrors applyBoardLinkLocal.
   */
  const applyBoardTitleLocal = useCallback((boardId: string, title: string) => {
    boardsRef.current = boardsRef.current.map(b =>
      b.id === boardId && b.title !== title ? { ...b, title } : b
    )
    setBoards(prev => {
      let changed = false
      const out = prev.map(b => {
        if (b.id !== boardId || b.title === title) return b
        changed = true
        return { ...b, title }
      })
      return changed ? out : prev
    })
  }, [])

  return {
    boards,
    boardPositions,
    loadWallPositions,
    updateBoardPosition,
    updateBoardPositionsBulk,
    resolveBoardId,
    applyBoardSizeLocal,
    applyBoardLinkLocal,
    applyBoardTitleLocal,
    deleteBoard,
    stageBoardDelete,
    commitBoardDelete,
    addTempBoard,
    replaceTempBoard,
    removeTempBoard,
    undo,
    redo,
    positionEpoch,
    // Expose conversion functions for upload logic
    normalizedToApi,
    apiToNormalized,
    decimalToApi,
    apiToDecimal
  }
}