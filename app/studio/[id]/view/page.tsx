'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { Board, FloorTable } from '@/types'
import WallSystem, { ROOM_SKY_COLOR, getRoomFogParams } from '@/components/3d/WallSystem'
import RoomLighting from '@/components/3d/RoomLighting'
import { CameraController, type FocusedWall } from '@/components/3d/CameraController'
import { getInitialRoomPose, ROOM_MIN_ZOOM_DISTANCE_INCHES } from '@/lib/room/cameraViews'
import TwoDView from '@/components/room/TwoDView'
import StudentsMenu from '@/components/room/StudentsMenu'
import { deriveRoomStudents } from '@/lib/room/students'
import { ROOM } from '@/lib/room/palette'
import TableWithModel from '@/components/3d/TableWithModel'
import ModelViewer from '@/components/3d/ModelViewer'
import LightboxModal from '@/components/LightboxModal'
import DemoBanner from '@/components/DemoBanner'
import { getCachedStudioData } from '@/lib/studioViewCache'
import { orderBoardsForLightbox } from '@/lib/boardOrder'
import { useAuthSession } from '@/hooks/useAuthSession'
import { toast } from '@/lib/toast'
import { ArrowLeft, LayoutGrid, Box } from 'lucide-react'

interface WallDimensions {
  height: number
  width: number
}

interface WallConfig {
  walls: WallDimensions[]
  layoutType: 'zigzag' | 'square' | 'linear' | 'lshape'
}

/**
 * Mouse mapping for the read-only room: left orbits, right pans in screen space.
 * Hoisted to a constant so the object identity is stable across renders —
 * drei re-applies changed props, and a fresh object literal every render would
 * mean re-applying this on every frame-triggered re-render.
 */
const VIEW_MOUSE_BUTTONS = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
} as const

function StudioViewCameraControls({
  wallConfig,
  orbitControlsRef,
}: {
  wallConfig: WallConfig | null
  orbitControlsRef: React.MutableRefObject<OrbitControlsType | null>
}) {
  // Match StudioRoom camera layout and scaling logic so view mode feels identical
  const maxWallWidth = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.width)) : 8
  const maxWallHeightInches = (wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.height)) : 8) * 12

  // Convert to inches (1 unit = 1 inch)
  const maxWallWidthInches = maxWallWidth * 12

  // Baseline room: 8ft wide, 8ft tall
  const baseWidthInches = 8 * 12

  const wallCount = wallConfig?.walls?.length ?? 1
  const layoutType = wallConfig?.layoutType ?? 'zigzag'
  const layoutFactor =
    layoutType === 'zigzag' || layoutType === 'square' || layoutType === 'lshape'
      ? Math.max(1, wallCount / 2)
      : 1

  // Wider rooms (or more connected walls) push the camera back more.
  const distanceScale = ((maxWallWidthInches * layoutFactor) / baseWidthInches) || 1

  // Zoom-IN floor: see ROOM_MIN_ZOOM_DISTANCE_INCHES. The zoom-out cap below
  // still scales with the room; only the near end was a wall.
  const minDistance = ROOM_MIN_ZOOM_DISTANCE_INCHES
  const maxDistance = 1200 * distanceScale     // Allow zooming further out for very long rooms

  // Aim slightly above mid-wall (where boards typically sit) so zoom goes toward the walls, not the floor.
  const targetHeight = Math.max(60, Math.min(maxWallHeightInches * 0.65, maxWallHeightInches)) || 60

  // Load-time framing comes from the same helper the 'axon' preset flies back
  // to, so "reset the view" lands exactly where the room opened rather than at
  // a separately-maintained approximation of it.
  const initial = getInitialRoomPose(
    wallConfig ?? { walls: [{ width: 8, height: 8 }], layoutType: 'zigzag' }
  )

  return (
    <>
      <OrbitControls
        ref={orbitControlsRef}
        enableDamping={false}
        dampingFactor={0}
        minDistance={minDistance}
        maxDistance={maxDistance}
        maxPolarAngle={Math.PI / 2}
        // Match StudioRoom: slightly steeper minimum angle so zoom aims toward the walls, not the floor
        minPolarAngle={0.45}
        enablePan={true}
        enableRotate={true}
        enableZoom={true}
        screenSpacePanning
        mouseButtons={VIEW_MOUSE_BUTTONS}
        target={[0, targetHeight, 0]}
      />
      <PerspectiveCamera
        makeDefault
        position={[initial.position.x, initial.position.y, initial.position.z]}
        fov={initial.fov}
        // See StudioRoom's camera: a 0.1 near plane leaves only inches of
        // depth precision at full zoom-out, which makes WallSystem's stacked
        // floor/grid/ground planes flicker. Nothing is ever within 5 inches
        // of the camera here either.
        near={5}
        // maxDistance below can exceed three.js's default far of 2000 on a
        // large room, which clips boards away as you zoom out. Same formula
        // StudioRoom uses.
        far={maxDistance + maxWallWidthInches * layoutFactor + 1000}
      />
    </>
  )
}

function StudioViewPageInner() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const studioId = params.id as string
  const { user } = useAuthSession()
  
  // Check if it's a demo studio (starts with "demo-studio-") or has demo=true param
  const isDemoStudio = studioId.startsWith('demo-studio-')
  const isDemo = searchParams?.get('demo') === 'true' || isDemoStudio
  // Cache is consumed EXACTLY ONCE here, during lazy useState init. Do not
  // re-read it inside any useEffect — re-reading on Effect A's re-run (when
  // resolvedWorkspaceId arrives) used to clobber freshly-fetched boards
  // back to whatever was cached, which was [] before the prefetch query
  // param was corrected.
  const initialCache = getCachedStudioData(studioId, isDemo)
  const [boards, setBoards] = useState<Board[]>(initialCache?.boards ?? [])
  const [wallConfig, setWallConfig] = useState<WallConfig | null>(
    (initialCache?.wallConfig as WallConfig) ?? null
  )
  // NOTE: [].length === 0 but [] is truthy. After the fix in
  // studioViewCache.ts to use roomId, cached.boards is populated correctly
  // (non-empty when boards exist). If prefetch ever fails, the cache entry
  // isn't created at all, so initialCache is null (not { boards: [] }) and
  // this expression evaluates to !(false && …) = true, surfacing the
  // spinner. The truthy-empty-array trap is therefore not a real hazard
  // here today, but it is fragile — any change that lets prefetch cache an
  // empty array would re-introduce the empty-walls bug.
  const [loading, setLoading] = useState(!(initialCache?.boards && initialCache?.wallConfig))
  const [error, setError] = useState<string | null>(null)

  /**
   * Wall focus in the read-only room: double-click a wall to fly square-on to it
   * with the rest of the room ghosted. There's no edit mode here, so this is the
   * only thing a wall double-click does.
   */
  const orbitControlsRef = useRef<OrbitControlsType | null>(null)
  const [focusedWall, setFocusedWall] = useState<FocusedWall | null>(null)
  /*
   * No presetRequest state here any more.
   *
   * It existed to serve the Axon/Fit buttons, and CameraController's
   * `presetRequest` prop is optional and defaults to null — so with those
   * buttons gone there is nothing left that could ever set it, and keeping the
   * plumbing would mean a permanently-null prop plus a setter nothing calls.
   * The editor still has both; this is the read-only page.
   */

  // Escape leaves focus, matching the editor.
  useEffect(() => {
    if (!focusedWall) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusedWall(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedWall])
  // Phase 6.2: workspace id resolved from the room id in the URL. Used for
  // wall-config + view-counter calls which remain workspace-scoped.
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(null)
  // Room name surfaced by /api/boards alongside id/workspaceId. Rendered in
  // the top bar so the user knows which studio they're viewing — view mode
  // had no room-name display previously.
  const [roomName, setRoomName] = useState<string | null>(null)
  /** The section this room belongs to, e.g. "Studio 01 - Lahmadi". */
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  /**
   * The type of the workspace this room belongs to — what the back button
   * routes on. Null until the role fetch below resolves, and for guests, who
   * never make that call; both are treated as "not personal", which is the
   * safe default (see the button).
   */
  const [workspaceType, setWorkspaceType] = useState<string | null>(null)
  // Room-level wall color (migration 031), surfaced by /api/boards. Drives the
  // 3D wall material for viewers; defaults to 'grey' (the current look).
  const [wallColor, setWallColor] = useState<'grey' | 'white'>('white')
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null)
  // The signed-in user's workspace role (owner surfaces as 'instructor'),
  // resolved best-effort below. Passed to the lightbox so the owner/instructor
  // can inline-edit a board title from this read-only view. null for public /
  // non-member viewers → no title-edit affordance.
  const [currentUserRole, setCurrentUserRole] = useState<'instructor' | 'student' | null>(null)
  /**
   * May this user set a board's slideshow position from the lightbox counter?
   * Owner or platform superadmin — the exact rule /api/boards/reorder enforces.
   * Fail-closed: stays false for guests, students and unresolved ownership.
   */
  const [canReorderBoards, setCanReorderBoards] = useState(false)
  /**
   * The flat 2D archive, browsable by person — the same surface the editor
   * reaches from its Views menu, which view mode had no way into at all. It is
   * a reading of the room's work rather than of the space, so it overlays the
   * canvas instead of replacing this route: the WebGL context stays alive
   * underneath, and toggling back is instant rather than a fresh scene build.
   */
  const [show2D, setShow2D] = useState(false)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  /**
   * The boards this viewer has pinned, by id.
   *
   * Loaded once for the whole account rather than asked per board: the shelf is
   * capped well below the size of a room, and one request answers the pin
   * button for every sheet in it. A guest or signed-out visitor gets a 401 and
   * an empty set, which is what hides the control for them.
   */
  const [pinnedBoardIds, setPinnedBoardIds] = useState<Set<string> | null>(null)
  const [compareBoardIds, setCompareBoardIds] = useState<string[]>([])
  const shiftPressedRef = useRef(false)
  const compareBoardIdsRef = useRef<string[]>([])
  const boardsRef = useRef<Board[]>([])
  const [autoEnterPresentCompare, setAutoEnterPresentCompare] = useState(false)
  const [modelViewerUrl, setModelViewerUrl] = useState<string | null>(null)

  // Tables from wall config (floor tables with 3D models) – strip blob URLs
  const tables: FloorTable[] = (() => {
    const raw = (wallConfig as { tables?: FloorTable[] })?.tables
    const list = Array.isArray(raw) ? raw : []
    return list.map((t) => ({
      ...t,
      modelUrl: t.modelUrl?.startsWith('blob:') ? undefined : t.modelUrl,
    }))
  })()

  // Increment view counter once per page visit (fire-and-forget, never blocks
  // rendering). Defer until we've resolved the workspace id — the view-counter
  // endpoint is workspace-scoped, and after the URL flip studioId is a room id.
  useEffect(() => {
    if (isDemo || !resolvedWorkspaceId) return
    fetch(`/api/studios/${resolvedWorkspaceId}/view`, { method: 'POST' }).catch(() => {})
  }, [resolvedWorkspaceId, isDemo])

  // Load wall config. The cache is NOT re-read here — that was the cause of
  // the empty-walls-on-bubble-click race: when fetchBoards resolves and
  // setResolvedWorkspaceId fires, this effect re-runs and a cache re-read
  // here would overwrite the real boards with whatever the cache had.
  // Initial-mount cache consumption happens once in the useState lazy
  // initializer above; that's the only correct read.
  useEffect(() => {
    let cancelled = false
    const loadWallConfig = async () => {
      // Wall-config remains workspace-scoped (Phase 6.2 leaves it intentionally
      // unchanged). Fall back to studioId only as a safety net in demo mode or
      // before workspaceId resolves.
      const wsKey = resolvedWorkspaceId ?? studioId
      try {
        // Phase 2b: pass roomId (= studioId after the URL flip) so the route
        // reads the per-room wall-config blob (with legacy fallback) instead of
        // only the workspace-level blob, which returns null for per-room rooms.
        const configUrl = isDemo
          ? `/api/studios/${wsKey}/wall-config?roomId=${encodeURIComponent(studioId)}&demo=true`
          : `/api/studios/${wsKey}/wall-config?roomId=${encodeURIComponent(studioId)}`
        const resConfig = await fetch(configUrl, { cache: 'no-store' })
        if (cancelled) return
        if (resConfig.ok) {
          const data = await resConfig.json()
          if (data?.config) {
            setWallConfig(data.config)
            return
          }
        }
      } catch (e) {
        if (!cancelled) console.warn('Wall config API fetch failed, falling back to localStorage', e)
      }

      if (cancelled) return
      const savedConfigKey = `studio-${wsKey}-wall-config`
      const savedConfig = localStorage.getItem(savedConfigKey)
      if (savedConfig) {
        setWallConfig(JSON.parse(savedConfig))
      } else {
        setWallConfig({
          walls: [
            { height: 10, width: 8 },
            { height: 10, width: 8 },
            { height: 10, width: 8 },
            { height: 10, width: 8 }
          ],
          layoutType: 'zigzag'
        })
      }
    }
    loadWallConfig()
    return () => { cancelled = true }
  }, [studioId, isDemo, resolvedWorkspaceId])

  useEffect(() => {
    compareBoardIdsRef.current = compareBoardIds
  }, [compareBoardIds])

  useEffect(() => {
    boardsRef.current = boards
  }, [boards])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      shiftPressedRef.current = event.shiftKey
    }
    const onKeyUp = (event: KeyboardEvent) => {
      shiftPressedRef.current = event.shiftKey
      if (event.key !== 'Shift') return
      const selectedIds = compareBoardIdsRef.current
      if (selectedIds.length <= 1) return
      const selectedBoards = selectedIds
        .map((id) => boardsRef.current.find((b) => b.id === id))
        .filter((b): b is Board => Boolean(b))
      if (selectedBoards.length <= 1) return
      setAutoEnterPresentCompare(true)
      setSelectedBoard(selectedBoards[0])
    }
    const onBlur = () => {
      shiftPressedRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    const cached = getCachedStudioData(studioId, isDemo)
    if (cached?.boards?.length !== undefined) {
      setBoards(cached.boards)
      setLoading(false)
      setError(null)
    }
    fetchBoards()
  }, [studioId, isDemo])
  
  // Open board from URL query param after boards are loaded
  useEffect(() => {
    const boardIdFromUrl = searchParams.get('boardId')
    if (boardIdFromUrl && boards.length > 0) {
      const boardToOpen = boards.find(b => b.id === boardIdFromUrl)
      if (boardToOpen) {
        // Only update if it's a different board
        if (!selectedBoard || selectedBoard.id !== boardToOpen.id) {
          setSelectedBoard(boardToOpen)
        }
      } else {
        console.warn('⚠️ [View Mode] Board not found with ID:', boardIdFromUrl)
        // Clear selection if board not found
        if (selectedBoard) {
          setSelectedBoard(null)
        }
      }
    } else if (!boardIdFromUrl && selectedBoard) {
      // Clear selection if no boardId in URL
      setSelectedBoard(null)
    }
  }, [boards, searchParams])

  useEffect(() => {
    document.title = 'Space View – pinspace'
  }, [])

  const fetchBoards = async () => {
    try {
      // Avoid flashing loading if cache was populated (e.g. prefetch completed after nav)
      if (!getCachedStudioData(studioId, isDemo)?.boards) setLoading(true)
      setError(null)
      // Phase 6.2: studioId from URL is the room id. The API resolves it
      // (falls back to workspace_id for legacy URLs). On mismatch, redirect
      // to the canonical room URL.
      const url = isDemo
        ? `/api/boards?roomId=${studioId}&demo=true`
        : `/api/boards?roomId=${studioId}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error('Failed to fetch boards')
      }

      const data = await response.json()
      setBoards(data.boards || [])
      const resolvedRoomId: string | null = data.room?.id ?? null
      const wsId: string | null = data.room?.workspaceId ?? null
      const resolvedRoomName: string | null = data.room?.name ?? null
      setResolvedWorkspaceId(wsId)
      setRoomName(resolvedRoomName)
      setWorkspaceName(data.room?.workspaceName ?? null)
      setWallColor(data.room?.wallColor === 'grey' ? 'grey' : 'white')

      if (!isDemo && resolvedRoomId && resolvedRoomId !== studioId) {
        const qs = searchParams ? searchParams.toString() : ''
        router.replace(`/studio/${resolvedRoomId}/view${qs ? `?${qs}` : ''}`, { scroll: false })
      }
    } catch (err) {
      console.error('Error fetching boards:', err)
      setError('Failed to load boards')
    } finally {
      setLoading(false)
    }
  }

  // Resolve the signed-in user's workspace role (owner surfaces as 'instructor',
  // per /api/workspaces) so the lightbox can offer inline title editing to the
  // owner/instructor in this read-only view — the same signal the edit page
  // computes. Best-effort: a 401/403 (public studio viewed by a non-member)
  // leaves the role null → no affordance. Never runs in demo mode.
  useEffect(() => {
    if (isDemo || !resolvedWorkspaceId || !user?.id) {
      setCurrentUserRole(null)
      setWorkspaceType(null)
      return
    }
    let cancelled = false
    const myUserId = user.id
    ;(async () => {
      try {
        const res = await fetch(`/api/workspaces/${resolvedWorkspaceId}`)
        if (!res.ok) {
          if (!cancelled) { setCurrentUserRole(null); setCanReorderBoards(false); setWorkspaceType(null) }
          return
        }
        const data = await res.json()
        const members = data?.workspace?.members
        if (cancelled) return
        // Same response, no extra round trip — see the reorder note below.
        setWorkspaceType(typeof data?.workspace?.type === 'string' ? data.workspace.type : null)
        if (Array.isArray(members)) {
          const mine = (members as Array<{ userId: string; role: string }>).find(
            (m) => m.userId === myUserId
          )
          setCurrentUserRole((mine?.role as 'instructor' | 'student') ?? null)
        } else {
          setCurrentUserRole(null)
        }
        // Reorder affordance: owner or platform superadmin, the exact rule
        // /api/boards/reorder enforces. Read off the SAME response the role
        // lookup already fetched — no extra round trip. `createdBy` is owner_id
        // and is read independently of `members`, so an owner keeps the
        // affordance even if the members array is missing or malformed.
        setCanReorderBoards(
          data?.workspace?.createdBy === myUserId || data?.isSuperadmin === true
        )
      } catch {
        if (!cancelled) { setCurrentUserRole(null); setCanReorderBoards(false) }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo, resolvedWorkspaceId, user?.id])

  const handleBoardClick = (board: Board) => {
    const shiftActive = shiftPressedRef.current
    if (shiftActive) {
      setCompareBoardIds((prev) =>
        prev.includes(board.id)
          ? prev.filter((id) => id !== board.id)
          : [...prev, board.id]
      )
      return
    }
    setAutoEnterPresentCompare(false)
    setCompareBoardIds((prev) => (
      prev.length > 1 && prev.includes(board.id) ? prev : []
    ))
    setSelectedBoard(board)
  }

  // Lightbox-only slideshow order (boards.sort_order). A SEPARATE sorted copy —
  // `boards` itself stays in server order for the 3D scene. The arrows here and
  // the counter inside the modal must read THIS array or they'd disagree.
  const roomOrderedBoards = useMemo(() => orderBoardsForLightbox(boards), [boards])
  const roomOrderIds = useMemo(() => roomOrderedBoards.map((b) => b.id), [roomOrderedBoards])

  /**
   * The same grouping the editor's 2D archive, the roster and the 3D name
   * plates use — derived, not fetched, so "everyone" means the same set of
   * people on every surface. Built from the slideshow-ordered copy so a
   * person's sheets read in the order the room presents them.
   */
  const roomStudents = useMemo(() => deriveRoomStudents(roomOrderedBoards), [roomOrderedBoards])

  /**
   * The selected person's sheets. NOT gated on which surface you are looking
   * at: picking a name from the roster is what draws their bay outline in the
   * 3D room, and it used to resolve to null unless the 2D archive happened to
   * be open — so the only selection the room could ever see was one made on a
   * screen covering the room.
   */
  const selectedStudentBoardIds = useMemo(() => {
    if (!selectedStudentId) return null
    const student = roomStudents.find((s) => s.id === selectedStudentId)
    return student ? new Set(student.boardIds) : null
  }, [selectedStudentId, roomStudents])

  /**
   * Opening a sheet from one person's contact sheet scopes the lightbox arrows
   * to that person. Reported as a bug the other way round: stepping through a
   * student's sheets used to walk the whole room and land you on a classmate's
   * work. Filtering an already-sorted array keeps its order, so there is no
   * second sort here and no way for the two to disagree.
   *
   * Still 2D-ONLY, which is what show2D is doing here now that the selection
   * itself is not gated: in the 3D room a selection is a highlight over a room
   * you are still browsing whole, so a board opened from a wall should walk the
   * whole room. The editor draws the same line (see lightboxScopedToStudent).
   */
  const lightboxBoards = useMemo(
    () =>
      show2D && selectedStudentBoardIds
        ? roomOrderedBoards.filter((b) => selectedStudentBoardIds.has(b.id))
        : roomOrderedBoards,
    [roomOrderedBoards, show2D, selectedStudentBoardIds]
  )

  useEffect(() => {
    let cancelled = false
    fetch('/api/pinspaces', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setPinnedBoardIds(
          new Set((data.pins ?? []).map((p: { boardId: string }) => p.boardId))
        )
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  /**
   * Keep this sheet, or stop keeping it.
   *
   * Optimistic on the local set so the button flips under the press, then
   * reconciled from the response — a pin is one row and the failure mode worth
   * covering is the write being refused, not a slow success.
   */
  const togglePin = async (boardId: string) => {
    const wasPinned = pinnedBoardIds?.has(boardId) ?? false
    setPinnedBoardIds((prev) => {
      const next = new Set(prev ?? [])
      if (wasPinned) next.delete(boardId)
      else next.add(boardId)
      return next
    })
    try {
      const res = wasPinned
        ? await fetch(`/api/pinspaces?boardId=${encodeURIComponent(boardId)}`, { method: 'DELETE' })
        : await fetch('/api/pinspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ boardId }),
          })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(typeof detail?.error === 'string' ? detail.error : 'Could not save that pin')
      }
    } catch (err) {
      // Put it back the way it was; the server is the source of truth.
      setPinnedBoardIds((prev) => {
        const next = new Set(prev ?? [])
        if (wasPinned) next.add(boardId)
        else next.delete(boardId)
        return next
      })
      // SAY SO. Reverting silently is what made the first version of this look
      // like a button that flashed and did nothing — the pin was being refused
      // for a real reason and the UI threw the reason away.
      toast.error(err instanceof Error ? err.message : 'Could not save that pin')
    }
  }

  /** Captured so the pin callbacks below don't re-narrow `selectedBoard`. */
  const selectedBoardId = selectedBoard?.id ?? null

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (!selectedBoard) return

    const currentIndex = lightboxBoards.findIndex(b => b.id === selectedBoard.id)
    // Not in the list at all — reachable now that the arrows can be scoped to
    // one person: open a sheet from the room, then pick a student in 2D and the
    // open board may not be theirs. Without this, -1 makes 'next' compute 0 and
    // jump to the top of someone else's sheets.
    if (currentIndex === -1) return
    let newIndex: number

    if (direction === 'prev') {
      newIndex = currentIndex - 1
    } else {
      newIndex = currentIndex + 1
    }

    if (newIndex >= 0 && newIndex < lightboxBoards.length) {
      setSelectedBoard(lightboxBoards[newIndex])
    }
  }

  /**
   * Set a sheet's slot in the room's running order. Lifted out of the lightbox's
   * inline prop so the 2D grid's drag-to-reorder writes through exactly the same
   * path — one definition of what a reorder is on this page.
   */
  const handleReorderBoard = async (boardId: string, targetPosition: number) => {
    // studioId IS the room id on this route — a legacy /studio/{ws} URL
    // is redirected to the canonical room URL in fetchBoards, and the
    // boards fetch above already keys off it the same way.
    try {
      const res = await fetch('/api/boards/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: studioId, boardId, targetPosition }),
        credentials: 'include',
      })
      if (!res.ok) return false
      // Existing refetch path: sortOrder lands and lightboxBoards recomputes.
      await fetchBoards()
      return true
    } catch {
      return false
    }
  }

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#3B6EF6' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
          <p className="text-white/90 font-medium">Loading space...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: ROOM_SKY_COLOR }}>
        <div className="text-center max-w-md p-8 bg-white/95 rounded-xl shadow-lg">
          <div className="text-6xl mb-4">😕</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-[#3B6EF6] text-white rounded-lg hover:bg-[#2F5CD6] transition-colors font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-screen overflow-hidden" style={{ background: ROOM_SKY_COLOR }}>
      <DemoBanner />

      {/* Flat, neutral field behind the board grid — matches the room's own
          ROOM_SKY_COLOR (see components/3d/WallSystem.tsx) instead of the
          previous pulsing indigo blur orbs, which read as a different, older
          design language than the rest of the app. */}

      {/*
        Top left. Laid out like the network's own header (app/explore/page.tsx):
        wordmark, a hairline rule, then the title with its subtitle under it.
        The two pages are the same product looking at the same hierarchy one
        level apart, and they read as one place when the chrome matches.

        WHAT the title is changed too. It was the room name alone in a pill,
        which told you which room but never which SECTION — and a room called
        "Mid Review" exists in every section in the school. Section over room,
        the way the network lists them.
      */}
      <div className="fixed top-4 left-4 z-40 flex flex-col items-start gap-2.5">
        {/* NO panel behind this. The chrome on this page was built for a dark
            room and never revisited when the room turned near-white — white
            text on a translucent white pane over ROOM_SKY (#EDF1FB) is very
            nearly invisible, which is what you were seeing. The name of the
            thing you are looking at does not need a container to read as a
            heading; it is the only content in that corner. Ink, not white, for
            the same reason the buttons below are dark-on-white. */}
        <div className="flex items-center gap-4 px-1 py-0.5">
          <button
            onClick={() => router.push('/')}
            className="shrink-0 text-lg font-extrabold tracking-[-0.045em] text-[#16181D] transition-opacity hover:opacity-70"
          >
            pinspace
            {/* The blue terminal period, as on the landing page, the studio
                header and the network. This was the last surface still
                spelling the wordmark without it. */}
            <span
              aria-hidden="true"
              className="ml-[0.06em] inline-block h-[0.2em] w-[0.2em] rounded-full bg-[#3B6EF6] align-baseline"
            />
          </button>

          {(workspaceName || roomName) && (
            <>
              <span aria-hidden="true" className="h-8 w-px shrink-0 bg-[#16181D]/15" />
              <div className="min-w-0">
                <p
                  className="truncate text-[15px] font-bold leading-tight text-[#16181D]"
                  title={workspaceName ?? undefined}
                >
                  {workspaceName ?? 'Space'}
                </p>
                {roomName && (
                  <p className="truncate text-xs text-[#5A5E6B]" title={roomName}>
                    {roomName}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => {
            // An explicit return path wins over everything below.
            //
            // /explore keeps its drill position in the query, and a space is
            // opened with that URL attached, so this lands you back on the
            // section you came from rather than at the top of the map. Only a
            // same-origin /explore path is honoured — `returnTo` arrives from
            // the address bar, and pushing an arbitrary attacker-supplied value
            // is an open redirect. A leading `//` is rejected with the rest:
            // `//evil.com` is a protocol-relative URL, not a path.
            const rawReturnTo = searchParams.get('returnTo')
            const returnToExplore =
              rawReturnTo && /^\/explore(\?|$)/.test(rawReturnTo) ? rawReturnTo : null

            // Routed on the ROOM, not on the viewer.
            //
            // This used to read the viewer's account mode: a personal-mode
            // account leaving a WIT section landed on /network, which is a FLAT
            // field of that viewer's own personal workspaces — no departments,
            // no drill-down, and not containing the room they just left. Two
            // people could press the same button on the same room and end up in
            // two different networks, and one of them in the wrong one.
            //
            // Where a room sends you back to is a property of the room. A
            // personal workspace belongs to the personal network; everything
            // else — sections, shared spaces — belongs to the org network, and
            // /explore opens that at the top of the drill-down (Department).
            // Unknown (a guest, or the type fetch not yet resolved) takes
            // /explore too: /network requires sign-in and holds only your own
            // spaces, so it is never the right guess for someone else's room.
            const base = rawReturnTo === 'gallery'
              ? '/gallery'
              : returnToExplore
                ? returnToExplore
                : workspaceType === 'personal' ? '/network' : '/explore'
            if (isDemo) {
              const originalParams = typeof window !== 'undefined' ? window.location.search : ''
              if (originalParams.includes('color=') || originalParams.includes('department=')) {
                const urlParams = new URLSearchParams(originalParams)
                urlParams.set('demo', 'true')
                router.push(`${base}?${urlParams.toString()}`)
                return
              }
              router.push(`${base}?demo=true`)
              return
            }
            router.push(base)
          }}
          className="px-4 py-2.5 bg-white hover:bg-[#F4F6FB] text-[#16181D] rounded-xl shadow-lg border border-[#16181D]/[0.10] transition-colors duration-200 font-medium text-sm flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {searchParams.get('returnTo') === 'gallery' ? 'Gallery' : 'Network'}
        </button>
        {/* The room-name pill that used to sit beside this is gone — the room
            is the lockup's subtitle now, and naming it twice in one corner was
            the same string in two boxes. */}
      </div>

      {/*
        Top right: where you are looking, then who is in the room.

        Axon and Fit are gone. They were the only two controls here that moved
        the camera without changing what you were looking AT, and a visitor who
        has just been handed a link does not arrive wanting to re-frame the
        room — dragging already orbits and scrolling already zooms.

        "View Mode • N boards" went with them. It was a status readout dressed
        as a button: it told you where you already were, and the board count is
        the one number a visitor cannot act on.
      */}
      <div className="fixed top-4 right-4 z-40 flex items-start gap-2.5">
        {/* Exit focus OUTLIVES the preset pair it used to sit inside. Focusing
            a wall holds the camera square-on to it, and Escape or a floor click
            are the only other ways out — neither discoverable. Rendered only
            while that state exists, and only in 3D. */}
        {!show2D && focusedWall !== null && (
          <button
            type="button"
            onClick={() => setFocusedWall(null)}
            title="Release the camera and show every wall again (Esc)"
            className="rounded-xl bg-[#3B6EF6] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90"
          >
            Exit focus
          </button>
        )}

        {/* The roster, behind a disclosure rather than always on screen. A
            visitor's first question about a crit space is whose work is in it;
            a permanent list of names is a sidebar this page does not have room
            for. Counts come from the boards already loaded — no extra fetch.

            The same component the editor mounts, so a name click means the same
            thing on both surfaces: highlight that person's boards in the room.
            The rows here used to be plain <div>s — the list answered "who is
            here" and then refused the obvious follow-up. */}
        <StudentsMenu
          students={roomStudents}
          selectedStudentId={selectedStudentId}
          onChange={setSelectedStudentId}
        />
      </div>

      {/* The 2D archive. Sits at z-30: over the canvas, under the fixed chrome
          at z-40, so the toggle that got you here stays reachable. Inset from
          the top by the height of that chrome rather than running under it —
          the grid scrolls, and content sliding beneath a pill you can't see
          past reads as clipped. */}
      {show2D && (
        <div className="fixed inset-0 z-30" style={{ background: ROOM.background }}>
          <div className="absolute left-0 right-0 bottom-0" style={{ top: 68 }}>
            <TwoDView
              // Slideshow order, matching the editor: this grid shows the same
              // sequence the lightbox arrows walk.
              boards={roomOrderedBoards}
              students={roomStudents}
              selectedStudentId={selectedStudentId}
              onSelectStudent={(student) => setSelectedStudentId(student.id)}
              onClearSelection={() => setSelectedStudentId(null)}
              onBoardClick={(board) => setSelectedBoard(board)}
              // Room-wide order, so a drag inside one person's sheets resolves
              // against the running order it actually writes.
              globalOrderIds={roomOrderIds}
              canReorder={canReorderBoards}
              onReorder={handleReorderBoard}
              // Renaming stays in the editor. This route is the read-only
              // presentation surface — it already withholds callouts and traces
              // for the same reason.
              canRenameStudent={false}
            />
          </div>
        </div>
      )}

      {/*
        Bottom centre: how you get around, and what you can do once you are
        there — one column, the control above the hints that describe it.

        The toggle moved here from the top-right corner. It is not chrome ABOUT
        the space the way the section name and the roster are; it is the same
        kind of thing as the gestures listed under it — a way of getting at the
        work — and it belongs with them.

        ONE container, stacked, rather than two fixed elements at hand-tuned
        offsets. The hints disappear in 2D (every line of them is about a camera
        that does not exist there) and the toggle then drops to the bottom on
        its own, with no second magic number to keep in step.
      */}
      <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => setShow2D((v) => !v)}
          aria-pressed={show2D}
          title={show2D ? 'Back to the 3D space' : "Browse everyone's sheets as a flat archive"}
          className="flex items-center gap-2 rounded-xl border border-[#16181D]/[0.10] bg-white px-4 py-2.5 text-sm font-medium text-[#16181D] shadow-lg transition-colors duration-200 hover:bg-[#F4F6FB]"
        >
          {show2D ? <Box className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
          {show2D ? 'Space' : '2D'}
        </button>

        {/* Quiet. It was an opaque white pill with a heavy drop shadow — which
            is how you dress a control, and this is a caption. At the bottom of
            the room it was the second-loudest thing on the page after the
            wordmark, for text you read once and then stop seeing. Now it is a
            hairline outline over the ruled ground with the grid showing
            through: present when you look for it, gone when you are not.

            No shadow at all, rather than a lighter one. A shadow says an
            element sits ABOVE the surface and can be acted on; nothing here
            can be. The gesture names keep a little weight because that is what
            makes the line scannable, but in the same grey family as the rest
            rather than near-black. */}
        {!show2D && (
          <div className="rounded-xl border border-[#16181D]/[0.10] bg-white/45 px-5 py-2.5 backdrop-blur-[2px]">
            <p className="text-[13px] text-[#8A8FA0]">
              {/* The speech-balloon emoji that led this line is gone. It was the
                  only emoji in the room's chrome, and it decorated the one hint
                  that needed it least — "Click boards" is already the plainest
                  instruction of the three. */}
              <span className="font-semibold text-[#5A5E6B]">Click boards</span> to view comments
              <span className="mx-2.5 text-[#16181D]/20">•</span>
              <span className="font-semibold text-[#5A5E6B]">Double-click a wall</span> to focus it
              <span className="mx-2.5 text-[#16181D]/20">•</span>
              <span className="font-semibold text-[#5A5E6B]">Drag</span> to rotate camera
            </p>
          </div>
        )}
      </div>

      {/*
        Full-screen model viewer. NO title bar.

        It had a dark strip across the top reading "3D Model" beside a Close
        button. The label named the obvious — you got here by clicking a model,
        and the model is the only thing on screen — and the strip cost a band of
        near-black across the top of an otherwise pale, quiet surface, which is
        the first thing your eye landed on instead of the object.

        Close survives as a floating control, because it has to: this overlay
        covers the room and Escape is not discoverable. It sits over the canvas
        rather than in a bar of its own.
      */}
      {modelViewerUrl && (
        <div className="fixed inset-0 z-50">
          <ModelViewer modelUrl={modelViewerUrl} />
          <button
            type="button"
            onClick={() => setModelViewerUrl(null)}
            aria-label="Close the model viewer"
            className="absolute right-4 top-4 rounded-xl border border-[#16181D]/[0.10] bg-white px-4 py-2.5 text-sm font-medium text-[#16181D] shadow-lg transition-colors hover:bg-[#F4F6FB]"
          >
            Close
          </button>
        </div>
      )}

      {/* 3D Canvas */}
      <Canvas
        dpr={[1, 2]}
        className="w-full h-full"
        gl={{
          shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
          alpha: true,
          premultipliedAlpha: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any}
        style={{ background: ROOM_SKY_COLOR }}
      >
        {/* Must match ROOM_SKY_COLOR/getRoomFogParams — see the comment on
            those exports in components/3d/WallSystem.tsx. scene.background
            (this) wins over the Canvas `style` above once WebGL paints; both
            still have to agree with each other and with the fog color below,
            or the ground plane's fade-out shows as a ring instead of a
            horizon. */}
        <color attach="background" args={[ROOM_SKY_COLOR]} />
        {wallConfig && (() => {
          const { fogNear, fogFar } = getRoomFogParams(wallConfig)
          return <fog attach="fog" args={[ROOM_SKY_COLOR, fogNear, fogFar]} />
        })()}

        {/* One shared rig for every room surface — see RoomLighting. */}
        <RoomLighting />
        
        {/* Wall System with Boards */}
        {wallConfig && (
          <WallSystem
            boards={boards}
            wallConfig={wallConfig}
            // No wall EDIT in view mode — double-click focuses the wall instead.
            onWallDoubleClick={(wallIndex, _dims, _pos, _rot, side) =>
              // Nonce bumps so re-focusing the wall you're already on re-frames
              // it rather than being a dead gesture after you've orbited away.
              setFocusedWall((prev) => ({ wallIndex, side, nonce: (prev?.nonce ?? 0) + 1 }))
            }
            onFloorClick={focusedWall !== null ? () => setFocusedWall(null) : undefined}
            dimmedExceptWall={focusedWall?.wallIndex ?? null}
            editingWall={null}
            // Pick someone in the roster and their sheets get a bay outline on
            // every wall face they're on — the same treatment the editor draws.
            highlightedBoardIds={selectedStudentBoardIds ?? undefined}
            onBoardClick={handleBoardClick}
            wallColor={wallColor}
            // Callout badges never show in read-only view mode; they live in the editor and the 2D lightbox pins.
            suppressCallouts={true}
          />
        )}

        {/* Floor tables with 3D models – click to open full 3D viewer */}
        {tables.map((table) => (
          <TableWithModel
            key={table.id}
            table={table}
            onTableClick={(url) => setModelViewerUrl(url)}
          />
        ))}
        
        {/* Camera Controls - scaled by wall size; crisp stop on mouse release (no lingering) */}
        <StudioViewCameraControls wallConfig={wallConfig} orbitControlsRef={orbitControlsRef} />
        {/* Drives preset flights and head-on wall focus. Also supplies the
            crisp stop-on-release behaviour that used to live in a local
            CrispOrbitRestore here — running both would have meant two useFrame
            hooks writing camera position and target in the same frame. */}
        <CameraController
          orbitControlsRef={orbitControlsRef}
          editingWall={null}
          wallPosition={null}
          wallRotation={0}
          wallConfig={wallConfig}
          focusedWall={focusedWall}
        />
      </Canvas>

      {/* Lightbox Modal */}
      <LightboxModal
        board={selectedBoard}
        allBoards={lightboxBoards}
        autoEnterPresentCompare={autoEnterPresentCompare}
        compareBoards={compareBoardIds
          .map((id) => boards.find((board) => board.id === id))
          .filter((board): board is Board => Boolean(board))}
        onClose={() => {
          setSelectedBoard(null)
          setAutoEnterPresentCompare(false)
          setCompareBoardIds([])
        }}
        onNavigate={handleNavigate}
        isEditMode={false}
        // Read-only presentation surface: hide ALL callout + trace UI in the lightbox.
        // Only the view page opts in; editor (via StudioRoom) and guest crit leave it default false.
        hideCallouts={true}
        currentUserRole={currentUserRole}
        // Read-only surface: a board's name is set where the work is arranged,
        // not where it is shown. Same reasoning as canRenameStudent={false} on
        // the 2D grid above — this route presents the room, it does not edit it.
        canRenameBoard={false}
        // Pinspaces. Offered only once the pin list has resolved, which is also
        // what withholds it from a signed-out visitor: they get a 401, the set
        // stays null, and no button appears that could not work.
        isPinned={selectedBoardId ? pinnedBoardIds?.has(selectedBoardId) ?? false : false}
        onTogglePin={
          pinnedBoardIds && selectedBoardId
            ? () => void togglePin(selectedBoardId)
            : undefined
        }
        // Withheld while the arrows are scoped to one person. The reorder input
        // takes a position in the ROOM's running order but validates against
        // allBoards.length, so against a 3-sheet subset "2" would read as
        // second-of-three and land as second-of-eighteen. Sheet order is a
        // room-level property; set it from the room-wide grid.
        canReorder={canReorderBoards && !selectedStudentBoardIds}
        onReorder={handleReorderBoard}
        onTitleSaved={(boardId, title) => {
          // Rename persisted server-side already. Mirror into local boards + the
          // open snapshot so the header stays correct on reopen/navigation
          // without a refetch. (Author-name/size stay edit-mode-only, untouched.)
          setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, title } : b)))
          setSelectedBoard((prev) => (prev && prev.id === boardId ? { ...prev, title } : prev))
        }}
      />
    </div>
  )
}

export default function StudioViewPage() {
  return (
    <Suspense fallback={null}>
      <StudioViewPageInner />
    </Suspense>
  )
}

