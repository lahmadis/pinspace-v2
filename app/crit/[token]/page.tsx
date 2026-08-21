'use client'

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- Realtime presenter-follow state is synchronized by effects; this public-shell pass preserves that established contract. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { Board, FloorTable } from '@/types'
import WallSystem from '@/components/3d/WallSystem'
import TableWithModel from '@/components/3d/TableWithModel'
import ModelViewer from '@/components/3d/ModelViewer'
import { SceneErrorBoundary } from '@/components/3d/SceneErrorBoundary'
import { ENGINE_PALETTE } from '@/components/3d/enginePalette'
import LightboxModal from '@/components/LightboxModal'
import { DEFAULT_WALL_CONFIG } from '@/lib/wallLayout'
import { orderBoardsForLightbox } from '@/lib/boardOrder'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import PresenceBar, { type PresentUser, friendlyName, colorFor } from '@/components/3d/PresenceBar'
import { LaserPointer } from '@/components/3d/LaserPointer'
import type { FollowPose, LaserState, LbViewport, LbCursorState, CritDirtySignal, TraceStreamEntry } from '@/components/3d/CameraController'
import { Presentation } from 'lucide-react'
import { Button, Card, Input } from '@/components/ui'
import {
  PublicModelDialog,
  PublicStatusScreen,
  PublicStudioEmpty,
  PublicStudioHeader,
  PublicStudioInstructions,
  PublicStudioNavigator,
} from '@/components/public/PublicStudioShell'

const PINSPACE_FOREST_SCENE_COLOR = ENGINE_PALETTE.forestScene
const MEDIA_KEY_LIGHT_COLOR = ENGINE_PALETTE.paper
const MEDIA_GROUND_LIGHT_COLOR = ENGINE_PALETTE.groundLight
const LIVE_CURSOR_COLOR = ENGINE_PALETTE.cursor
const TRACE_STREAM_FALLBACK_COLOR = ENGINE_PALETTE.guide

interface WallDimensions {
  height: number
  width: number
}

interface WallConfig {
  walls: WallDimensions[]
  layoutType: 'zigzag' | 'square' | 'linear' | 'lshape'
}

interface GuestInfo {
  tokenId: string
  label: string
  canComment: boolean
  canTrace: boolean
}

type LoadState = 'loading' | 'name' | 'ok' | 'not-found' | 'error'

function getControls(ref: React.RefObject<unknown>): OrbitControlsType | null {
  const r = ref?.current
  if (!r) return null
  if (typeof (r as { get?: () => OrbitControlsType }).get === 'function') {
    return (r as { get: () => OrbitControlsType }).get()
  }
  return r as OrbitControlsType
}

function CrispOrbitRestore({
  orbitControlsRef,
  isFollowing = false,
  followPoseRef,
}: {
  orbitControlsRef: React.RefObject<unknown>
  /** Phase B.4: guest auto-follows the presenter's camera. */
  isFollowing?: boolean
  /** Phase B.4: latest "cam" pose (read in the frame loop, never via state). */
  followPoseRef?: React.MutableRefObject<FollowPose | null>
}) {
  const { camera } = useThree()
  const restoreOnNextFrame = useRef(false)
  const positionOnEnd = useRef(new THREE.Vector3())
  const targetOnEnd = useRef(new THREE.Vector3())
  const endListenerAdded = useRef(false)
  // Phase B.4: reusable scratch vectors for the follow lerp (no per-frame alloc).
  const followPosVec = useRef(new THREE.Vector3())
  const followTargetVec = useRef(new THREE.Vector3())

  useFrame((_state, delta) => {
    const controls = getControls(orbitControlsRef)
    if (!controls) return

    if (!endListenerAdded.current) {
      endListenerAdded.current = true
      controls.addEventListener('end', () => {
        positionOnEnd.current.copy(camera.position)
        targetOnEnd.current.copy(controls.target)
        restoreOnNextFrame.current = true
      })
    }

    ;(controls as { enableDamping?: boolean; dampingFactor?: number }).enableDamping = false
    ;(controls as { enableDamping?: boolean; dampingFactor?: number }).dampingFactor = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(controls as any).mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(controls as any).screenSpacePanning = true

    // Phase B.4: follow the presenter's broadcast camera (same ref+lerp pattern as
    // the member CameraController). Lerp toward the latest pose so ~10Hz packets
    // render continuously. While following, OrbitControls input is disabled so the
    // guest can't fight the followed camera; Escape / "Stop following" flips
    // isFollowing and re-enables input next frame — no stuck-disabled state.
    const pose = followPoseRef?.current
    if (isFollowing && pose) {
      const alpha = 1 - Math.exp(-delta * 10)
      followPosVec.current.set(pose.p[0], pose.p[1], pose.p[2])
      followTargetVec.current.set(pose.t[0], pose.t[1], pose.t[2])
      camera.position.lerp(followPosVec.current, alpha)
      controls.target.lerp(followTargetVec.current, alpha)
      camera.lookAt(controls.target)
      camera.up.set(0, 1, 0)
    }
    controls.enabled = !isFollowing

    controls.update()

    if (restoreOnNextFrame.current) {
      camera.position.copy(positionOnEnd.current)
      controls.target.copy(targetOnEnd.current)
      restoreOnNextFrame.current = false
    }
  })

  return null
}

function CritViewCameraControls({
  wallConfig,
  isFollowing = false,
  followPoseRef,
}: {
  wallConfig: WallConfig | null
  isFollowing?: boolean
  followPoseRef?: React.MutableRefObject<FollowPose | null>
}) {
  const orbitControlsRef = useRef<OrbitControlsType | null>(null)
  const maxWallWidth = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.width)) : 8
  const maxWallHeight = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.height)) : 8

  const maxWallWidthInches = maxWallWidth * 12
  const maxWallHeightInches = maxWallHeight * 12
  const baseWidthInches = 8 * 12

  const wallCount = wallConfig?.walls?.length ?? 1
  const layoutType = wallConfig?.layoutType ?? 'zigzag'
  const layoutFactor =
    layoutType === 'zigzag' || layoutType === 'square' || layoutType === 'lshape'
      ? Math.max(1, wallCount / 2)
      : 1

  const distanceScale = ((maxWallWidthInches * layoutFactor) / baseWidthInches) || 1

  const minDistance = 80 * distanceScale
  const maxDistance = 1200 * distanceScale
  const targetHeight = Math.max(60, Math.min(maxWallHeightInches * 0.65, maxWallHeightInches)) || 60

  const baseDistance = 110 * distanceScale
  const elevationAngle = 35 * (Math.PI / 180)
  const azimuthAngle = 45 * (Math.PI / 180)

  const horizontalDistance = baseDistance * Math.cos(elevationAngle)
  const cameraHeight = targetHeight + baseDistance * Math.sin(elevationAngle)
  const cameraX = horizontalDistance * Math.sin(azimuthAngle)
  const cameraZ = horizontalDistance * Math.cos(azimuthAngle)

  return (
    <>
      <CrispOrbitRestore
        orbitControlsRef={orbitControlsRef}
        isFollowing={isFollowing}
        followPoseRef={followPoseRef}
      />
      <OrbitControls
        ref={orbitControlsRef}
        enableDamping={false}
        dampingFactor={0}
        minDistance={minDistance}
        maxDistance={maxDistance}
        maxPolarAngle={Math.PI / 2}
        minPolarAngle={0.45}
        enablePan={true}
        enableRotate={true}
        enableZoom={true}
        target={[0, targetHeight, 0]}
      />
      <PerspectiveCamera
        makeDefault
        position={[cameraX, cameraHeight, cameraZ]}
        fov={50}
      />
    </>
  )
}

export default function CritPage() {
  const params = useParams()
  const token = params.token as string

  const [boards, setBoards] = useState<Board[]>([])
  const [wallConfig, setWallConfig] = useState<WallConfig | null>(null)
  const [roomName, setRoomName] = useState<string | null>(null)
  // Room wall color (migration 031) so guest-critic viewers see the room's look.
  const [wallColor, setWallColor] = useState<'grey' | 'white'>('grey')
  const [guest, setGuest] = useState<GuestInfo | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [guestName, setGuestName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null)
  const [compareBoardIds, setCompareBoardIds] = useState<string[]>([])
  const [autoEnterPresentCompare, setAutoEnterPresentCompare] = useState(false)
  const [modelViewerUrl, setModelViewerUrl] = useState<string | null>(null)

  const shiftPressedRef = useRef(false)
  const compareBoardIdsRef = useRef<string[]>([])
  const boardsRef = useRef<Board[]>([])

  // ---- Phase B.4: live-crit spectator (read-only) ----
  // The room id (added to state so the realtime effects can key on it; the load
  // effect previously kept it as a local var only).
  const [roomId, setRoomId] = useState<string | null>(null)
  // Other people in the room (members + guests), from studio-presence.
  const [presentUsers, setPresentUsers] = useState<PresentUser[]>([])
  // Auto-follow the presenter's camera/lightbox; break away with Escape / button.
  const [isFollowing, setIsFollowing] = useState(false)
  // Board the presenter has open in the lightbox (null = closed), from "lb".
  const [followLightboxBoardId, setFollowLightboxBoardId] = useState<string | null>(null)
  // Phase B.5: debounced peer trace/callout-edit signal → LightboxModal refetch.
  const [critDirty, setCritDirty] = useState<CritDirtySignal | null>(null)
  // Phase B.5.1: peers' in-progress trace strokes (ephemeral), keyed
  // `${boardId}|${authorKey}`. Written by trace-pt/trace-end handlers (no
  // setState); LightboxModal renders them live and clears on refetch.
  const traceStreamRef = useRef<Map<string, TraceStreamEntry>>(new Map())
  // Realtime channels + the per-message refs consumed in frame loops (NEVER
  // setState per message — same discipline as the member page).
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const liveChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const followPoseRef = useRef<FollowPose | null>(null)
  const laserRef = useRef<LaserState | null>(null)
  const lbViewportRef = useRef<LbViewport | null>(null)
  const lbCursorRef = useRef<LbCursorState | null>(null)
  // Phase B.5.2: guest board live-sync. Guests get no postgres_changes (no auth
  // session; RLS filters the events), so members ping "boards-dirty" on the
  // studio-live channel and we debounce a refetch via the guest-token boards path
  // — same serializer as the initial load. Sequence-guarded so an out-of-order
  // resolution can't leave a stale (pre-commit) board snapshot.
  const boardsRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boardsFetchSeqRef = useRef(0)

  // This guest's own presence id, so PresenceBar excludes self.
  const currentUserId = guest?.tokenId ? `guest:${guest.tokenId}` : null

  // Active presenter, derived from presence — guests can NEVER be presenter
  // (ignored by key prefix even if a malformed payload claims isPresenting).
  const presenter = useMemo(() => {
    let best: PresentUser | null = null
    for (const u of presentUsers) {
      if (!u.userId || u.userId.startsWith('guest:') || !u.isPresenting) continue
      if (!best || (u.joinedAt ?? Infinity) < (best.joinedAt ?? Infinity)) best = u
    }
    return best ? { userId: best.userId, fullName: best.fullName } : null
  }, [presentUsers])
  const laserColor = presenter ? colorFor(presenter.userId) : LIVE_CURSOR_COLOR

  const nameStorageKey = `crit-guest-name-${token}`

  const tables: FloorTable[] = (() => {
    const raw = (wallConfig as { tables?: FloorTable[] })?.tables
    const list = Array.isArray(raw) ? raw : []
    return list.map((t) => ({
      ...t,
      modelUrl: t.modelUrl?.startsWith('blob:') ? undefined : t.modelUrl,
    }))
  })()

  useEffect(() => {
    compareBoardIdsRef.current = compareBoardIds
  }, [compareBoardIds])

  useEffect(() => {
    boardsRef.current = boards
  }, [boards])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { shiftPressedRef.current = e.shiftKey }
    const onKeyUp = (e: KeyboardEvent) => {
      shiftPressedRef.current = e.shiftKey
      if (e.key !== 'Shift') return
      const selectedIds = compareBoardIdsRef.current
      if (selectedIds.length <= 1) return
      const selectedBoards = selectedIds
        .map((id) => boardsRef.current.find((b) => b.id === id))
        .filter((b): b is Board => Boolean(b))
      if (selectedBoards.length <= 1) return
      setAutoEnterPresentCompare(true)
      setSelectedBoard(selectedBoards[0])
    }
    const onBlur = () => { shiftPressedRef.current = false }
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
    if (!token) return
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`/api/crit/${token}/boards`, { cache: 'no-store' })
        if (cancelled) return
        if (res.status === 404) { setLoadState('not-found'); return }
        if (!res.ok) { setLoadState('error'); return }

        const data = await res.json()
        setBoards(data.boards || [])
        const workspaceId: string | null = data.room?.workspaceId ?? null
        const roomId: string | null = data.room?.id ?? null
        setRoomId(roomId)
        setRoomName(data.room?.name ?? null)
        setWallColor(data.room?.wallColor === 'white' ? 'white' : 'grey')
        const g: GuestInfo | null = data.guest ?? null
        setGuest(g)

        let resolvedConfig: WallConfig | null = null
        if (workspaceId) {
          try {
            const configUrl = roomId
              ? `/api/studios/${workspaceId}/wall-config?roomId=${encodeURIComponent(roomId)}`
              : `/api/studios/${workspaceId}/wall-config`
            const configRes = await fetch(configUrl, { cache: 'no-store' })
            if (!cancelled && configRes.ok) {
              const configData = await configRes.json()
              if (configData?.config) resolvedConfig = configData.config
            }
          } catch {
            // wall-config is workspace-scoped and may be unavailable to a guest;
            // fall back to a default layout below so the room still renders.
          }
        }
        if (!cancelled) setWallConfig(resolvedConfig ?? DEFAULT_WALL_CONFIG)

        // Name gate: reuse a previously entered name (sessionStorage), else ask.
        const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(nameStorageKey) : null
        if (stored && stored.trim()) {
          setGuestName(stored.trim())
          if (!cancelled) setLoadState('ok')
        } else {
          setNameInput(g?.label ?? '')
          if (!cancelled) setLoadState('name')
        }
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }

    load()
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    document.title = roomName ? `${roomName} – Guest critique` : 'Guest critique – pinspace'
  }, [roomName])

  // Phase B.4: presence. Track this guest on the SAME studio-presence channel
  // members use, keyed guest:<tokenId>, isPresenting:false (guests can't present).
  // Anon client works — presence is a public channel (no auth/RLS). Only once the
  // room is loaded and a name is entered. removeChannel on cleanup.
  useEffect(() => {
    if (!isSupabaseConfigured || !roomId || loadState !== 'ok') return
    const tokenId = guest?.tokenId
    if (!tokenId || !guestName) return
    let cancelled = false
    const myId = `guest:${tokenId}`
    const channel = supabase.channel(`studio-presence:${roomId}`, {
      config: { presence: { key: myId } },
    })
    presenceChannelRef.current = channel
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<
          string,
          Array<{ userId?: string; fullName?: string; currentWallIndex?: number | null; isPresenting?: boolean; joinedAt?: number }>
        >
        const flat: PresentUser[] = Object.values(state)
          .flat()
          .map((m) => ({
            userId: m.userId ?? '',
            fullName: m.fullName ?? 'Someone',
            wallIndex: m.currentWallIndex ?? null,
            isPresenting: m.isPresenting ?? false,
            joinedAt: m.joinedAt,
          }))
        if (!cancelled) setPresentUsers(flat)
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId: myId,
            fullName: `${guestName} (guest)`,
            joinedAt: Date.now(),
            isGuest: true,
            isPresenting: false,
          })
        }
      })
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      presenceChannelRef.current = null
      setPresentUsers([])
    }
  }, [roomId, guest?.tokenId, guestName, loadState])

  // Phase B.4: live channel (broadcast only) — receive the presenter's camera
  // ("cam"), cursor ("laser"), and lightbox follow ("lb"/"lbv"). RECEIVE ONLY:
  // this page never sends on studio-live (guests are read-only spectators). Each
  // high-frequency stream writes a ref (never setState); "lb" is a discrete
  // open/close event so setState is correct there. Refs nulled on cleanup.
  useEffect(() => {
    if (!isSupabaseConfigured || !roomId) return
    const channel = supabase.channel(`studio-live:${roomId}`, {
      config: { broadcast: { self: false } },
    })
    liveChannelRef.current = channel
    const traceStreams = traceStreamRef.current
    let laserSeq = 0
    let lbCursorSeq = 0
    // Phase B.5: crit-dirty debounce state (per-channel-lifetime closure).
    let critDirtySeq = 0
    let critDirtyPending: { boardId: string; trace: boolean; callout: boolean } | null = null
    let critDirtyTimer: ReturnType<typeof setTimeout> | null = null
    channel
      .on('broadcast', { event: 'cam' }, (msg: { payload?: FollowPose }) => {
        const p = msg.payload
        if (p && Array.isArray(p.p) && Array.isArray(p.t)) followPoseRef.current = p
      })
      .on('broadcast', { event: 'laser' }, (msg: { payload?: { p?: [number, number, number]; off?: boolean } }) => {
        const p = msg.payload
        if (!p || p.off || !Array.isArray(p.p)) { laserRef.current = null; return }
        laserSeq += 1
        laserRef.current = { p: p.p, seq: laserSeq }
      })
      .on('broadcast', { event: 'lb' }, (msg: { payload?: { boardId?: string; off?: boolean } }) => {
        const p = msg.payload
        setFollowLightboxBoardId(p && !p.off && p.boardId ? p.boardId : null)
      })
      .on('broadcast', { event: 'lbv' }, (msg: { payload?: { z?: number; cx?: number; cy?: number } }) => {
        const p = msg.payload
        if (!p || typeof p.z !== 'number' || typeof p.cx !== 'number' || typeof p.cy !== 'number') return
        lbViewportRef.current = { z: p.z, cx: p.cx, cy: p.cy }
      })
      // Phase B.3.2: presenter pointer over the lightbox image (~15Hz). Ref-only.
      .on('broadcast', { event: 'lbc' }, (msg: { payload?: { cx?: number; cy?: number; off?: boolean } }) => {
        const p = msg.payload
        if (!p || p.off || typeof p.cx !== 'number' || typeof p.cy !== 'number') {
          lbCursorRef.current = null
          return
        }
        lbCursorSeq += 1
        lbCursorRef.current = { cx: p.cx, cy: p.cy, seq: lbCursorSeq }
      })
      // Phase B.5: a peer (member or guest) saved a trace/callout — debounce and
      // hand to LightboxModal to refetch via the guest-token path. Guests both
      // send (from LightboxModal saves) and receive crit-dirty; this does not
      // touch the cam/laser/lb broadcast rule.
      .on('broadcast', { event: 'crit-dirty' }, (msg: { payload?: { boardId?: string; kind?: 'trace' | 'callout' } }) => {
        const p = msg.payload
        if (!p?.boardId || (p.kind !== 'trace' && p.kind !== 'callout')) return
        if (!critDirtyPending || critDirtyPending.boardId !== p.boardId) {
          critDirtyPending = { boardId: p.boardId, trace: false, callout: false }
        }
        if (p.kind === 'trace') critDirtyPending.trace = true
        else critDirtyPending.callout = true
        if (critDirtyTimer) clearTimeout(critDirtyTimer)
        critDirtyTimer = setTimeout(() => {
          critDirtyTimer = null
          const pend = critDirtyPending
          critDirtyPending = null
          if (pend) { critDirtySeq += 1; setCritDirty({ ...pend, seq: critDirtySeq }) }
        }, 500)
      })
      // Phase B.5.1: live trace streaming (ephemeral). Append delta points to the
      // author's in-progress stroke; trace-end finalizes it. Ref writes only — no
      // setState; LightboxModal renders from the ref each frame and clears on save.
      .on('broadcast', { event: 'trace-pt' }, (msg: { payload?: { boardId?: string; authorKey?: string; color?: string; pts?: [number, number][] } }) => {
        const p = msg.payload
        if (!p?.boardId || !p.authorKey || !Array.isArray(p.pts)) return
        const map = traceStreams
        const key = `${p.boardId}|${p.authorKey}`
        let e = map.get(key)
        if (!e) {
          e = { boardId: p.boardId, authorKey: p.authorKey, color: typeof p.color === 'string' ? p.color : TRACE_STREAM_FALLBACK_COLOR, completed: [], live: null }
          map.set(key, e)
        }
        if (typeof p.color === 'string') e.color = p.color
        if (!e.live) e.live = []
        for (const pt of p.pts) {
          if (Array.isArray(pt) && pt.length === 2 && typeof pt[0] === 'number' && typeof pt[1] === 'number') e.live.push([pt[0], pt[1]])
        }
      })
      .on('broadcast', { event: 'trace-end' }, (msg: { payload?: { boardId?: string; authorKey?: string } }) => {
        const p = msg.payload
        if (!p?.boardId || !p.authorKey) return
        const e = traceStreams.get(`${p.boardId}|${p.authorKey}`)
        if (e && e.live) { e.completed.push(e.live); e.live = null }
      })
      // Phase B.5.2: a member changed the room's boards (upload/move/resize/delete).
      // Debounce a refetch via the guest-token boards path — guests get no
      // postgres_changes. Ref/timer only here; the setState happens in the
      // sequence-guarded fetch resolution, not per message.
      .on('broadcast', { event: 'boards-dirty' }, () => {
        if (boardsRefetchTimerRef.current) clearTimeout(boardsRefetchTimerRef.current)
        boardsRefetchTimerRef.current = setTimeout(() => {
          boardsRefetchTimerRef.current = null
          const seq = ++boardsFetchSeqRef.current
          void (async () => {
            try {
              const res = await fetch(`/api/crit/${token}/boards`, { cache: 'no-store' })
              if (!res.ok) return
              const data = await res.json()
              if (seq !== boardsFetchSeqRef.current) return // superseded by a newer refetch
              setBoards(data.boards || [])
            } catch {
              // Best-effort live sync; the initial load + manual refresh remain.
            }
          })()
        }, 400)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (liveChannelRef.current === channel) liveChannelRef.current = null
      followPoseRef.current = null
      laserRef.current = null
      lbViewportRef.current = null
      lbCursorRef.current = null
      traceStreams.clear()
      if (critDirtyTimer) clearTimeout(critDirtyTimer)
      if (boardsRefetchTimerRef.current) {
        clearTimeout(boardsRefetchTimerRef.current)
        boardsRefetchTimerRef.current = null
      }
    }
  }, [roomId])

  // Phase B.4: auto-follow whenever a presenter exists; reset when they stop.
  // Keyed on the presenter id so a new presenter re-arms, while a manual break-away
  // (which only flips isFollowing) stays detached for the current presenter.
  const followTargetId = presenter ? presenter.userId : null
  useEffect(() => {
    setIsFollowing(followTargetId !== null)
  }, [followTargetId])

  // Break-away: Escape detaches the following guest so they can orbit freely.
  useEffect(() => {
    if (!isFollowing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFollowing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFollowing])

  // Phase B.4: lightbox follow — while following, mirror the presenter's open
  // board into the guest lightbox (open via the boards the guest token already
  // fetched — never the member API). Close when the presenter closes.
  useEffect(() => {
    if (!isFollowing) return
    const id = followLightboxBoardId
    if (!id) { setSelectedBoard(null); return }
    setSelectedBoard((prev) => {
      if (prev?.id === id) return prev
      const next = boards.find((b) => b.id === id)
      return next ?? prev
    })
  }, [isFollowing, followLightboxBoardId, boards])

  const handleEnterName = () => {
    const name = nameInput.trim()
    if (!name) return
    try { window.sessionStorage.setItem(nameStorageKey, name) } catch { /* ignore */ }
    setGuestName(name)
    setLoadState('ok')
  }

  const handleBoardClick = (board: Board) => {
    // Phase B.4: while following, the lightbox is presenter-driven — block manual
    // open so it can't fight the follow stream. Break away (Escape) to interact.
    if (isFollowing) return
    if (shiftPressedRef.current) {
      setCompareBoardIds((prev) =>
        prev.includes(board.id)
          ? prev.filter((id) => id !== board.id)
          : [...prev, board.id]
      )
      return
    }
    setAutoEnterPresentCompare(false)
    setCompareBoardIds((prev) => (prev.length > 1 && prev.includes(board.id) ? prev : []))
    setSelectedBoard(board)
  }

  // Lightbox-only slideshow order (boards.sort_order). A SEPARATE sorted copy —
  // `boards` itself stays in server order for the 3D scene. The arrows here and
  // the counter inside the modal must read THIS array or they'd disagree.
  const lightboxBoards = useMemo(() => orderBoardsForLightbox(boards), [boards])

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (!selectedBoard) return
    const currentIndex = lightboxBoards.findIndex((b) => b.id === selectedBoard.id)
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1
    if (newIndex >= 0 && newIndex < lightboxBoards.length) setSelectedBoard(lightboxBoards[newIndex])
  }

  if (loadState === 'loading') {
    return (
      <PublicStatusScreen status="loading" title="Loading guest critique" description="Checking the link and preparing the room." />
    )
  }

  if (loadState === 'not-found') {
    return (
      <PublicStatusScreen status="error" title="Link unavailable" description="This link is invalid, expired, or no longer available." />
    )
  }

  if (loadState === 'error') {
    return (
      <PublicStatusScreen
        status="error"
        title="Studio could not be loaded"
        description="The critique studio is temporarily unavailable."
        action={<Button type="button" onClick={() => window.location.reload()}>Try again</Button>}
      />
    )
  }

  if (loadState === 'name') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <Card className="w-full max-w-sm p-6 sm:p-8">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">Guest critique</p>
          <h1 className="mt-2 text-2xl font-black text-text-primary">Enter the review room</h1>
          <p className="mt-2 text-sm text-text-secondary">
            {roomName ? <>You’re reviewing <strong>{roomName}</strong>. </> : null}
            Your name is attached to feedback and traces you post.
          </p>
          <form onSubmit={(event) => { event.preventDefault(); handleEnterName() }} className="mt-6 space-y-4">
            <div>
              <label htmlFor="guest-critic-name" className="mb-1.5 block text-sm font-semibold text-text-primary">Your name</label>
              <Input
                id="guest-critic-name"
                type="text"
                value={nameInput}
                maxLength={80}
                autoComplete="name"
                onChange={(event) => setNameInput(event.target.value)}
                autoFocus
                placeholder="e.g. Jane Smith"
              />
            </div>
            <Button type="submit" disabled={!nameInput.trim()} className="w-full">Enter studio</Button>
          </form>
        </Card>
      </main>
    )
  }

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-pinspace-forest">
      <PublicStudioHeader roomName={roomName} modeLabel={`Guest critic · ${guestName}`} boardCount={boards.length} />
      <PublicStudioNavigator
        boards={boards.map(({ id, title }) => ({ id, title }))}
        models={tables.flatMap((table) => table.modelUrl ? [{ id: table.id, url: table.modelUrl }] : [])}
        onOpenBoard={(id) => {
          const board = boards.find((candidate) => candidate.id === id)
          if (board) handleBoardClick(board)
        }}
        onOpenModel={setModelViewerUrl}
      />
      {boards.length === 0 && <PublicStudioEmpty title="No boards to critique yet" description="The room is open, but there is no work to review right now." />}

      {/* Phase B.4: who else is here (members + other guests; self excluded). */}
      <PresenceBar users={presentUsers} currentUserId={currentUserId} />
      {/* Phase B.4: presenter indicator + follow toggle. A guest is never the
          presenter, so any presenter is "someone else" — always show the banner. */}
      {presenter && (
        <div
          className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+7.5rem)] z-40 flex -translate-x-1/2 items-center gap-2 rounded-pinspace border border-border bg-background-light/95 p-2 text-text-primary shadow-[var(--shadow-raised)] backdrop-blur-md sm:top-[calc(env(safe-area-inset-top)+5rem)]"
          role="status"
        >
          <Presentation className="h-4 w-4 text-accent" aria-hidden="true" />
          <span className="text-xs font-semibold">{friendlyName(presenter.fullName)} is presenting</span>
          <Button
            type="button"
            onClick={() => setIsFollowing((v) => !v)}
            variant="ghost"
            size="sm"
            className="ml-1 min-h-11"
          >
            {isFollowing ? 'Stop following' : `Follow ${friendlyName(presenter.fullName)}`}
          </Button>
        </div>
      )}

      <PublicStudioInstructions>
        Select a board to review it{guest?.canComment ? ', add callouts' : ''}{guest?.canTrace ? ', or trace' : ''}. Use Browse studio content for keyboard access.
      </PublicStudioInstructions>

      <PublicModelDialog modelUrl={modelViewerUrl} onClose={() => setModelViewerUrl(null)}>
        {modelViewerUrl && <ModelViewer modelUrl={modelViewerUrl} />}
      </PublicModelDialog>

      <SceneErrorBoundary resetKey={token}>
      <Canvas
        aria-label="Guest critique 3D studio"
        shadows
        className="w-full h-full"
        gl={{
          shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
          alpha: true,
          premultipliedAlpha: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any}
        style={{ background: PINSPACE_FOREST_SCENE_COLOR }}
      >
        <color attach="background" args={[PINSPACE_FOREST_SCENE_COLOR]} />
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[15, 20, 10]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={500}
          shadow-camera-left={-200}
          shadow-camera-right={200}
          shadow-camera-top={200}
          shadow-camera-bottom={-200}
          shadow-bias={-0.0001}
        />
        <directionalLight position={[-10, 12, -8]} intensity={0.5} />
        <directionalLight position={[0, 25, 0]} intensity={0.4} />
        <directionalLight position={[-8, 10, -12]} intensity={0.3} color={MEDIA_KEY_LIGHT_COLOR} />
        <directionalLight position={[8, 10, 12]} intensity={0.3} color={MEDIA_KEY_LIGHT_COLOR} />
        <hemisphereLight args={[MEDIA_KEY_LIGHT_COLOR, MEDIA_GROUND_LIGHT_COLOR, 0.3]} />

        {wallConfig && (
          <WallSystem
            boards={boards}
            wallConfig={wallConfig}
            onWallDoubleClick={() => {}}
            editingWall={null}
            onBoardClick={handleBoardClick}
            wallColor={wallColor}
          />
        )}

        {tables.map((table) => (
          <TableWithModel
            key={table.id}
            table={table}
            onTableClick={(url) => setModelViewerUrl(url)}
          />
        ))}

        <CritViewCameraControls
          wallConfig={wallConfig}
          isFollowing={isFollowing}
          followPoseRef={followPoseRef}
        />
        {/* Phase B.4: presenter cursor dot (identical to the member view). */}
        <LaserPointer laserRef={laserRef} color={laserColor} />
      </Canvas>
      </SceneErrorBoundary>

      <LightboxModal
        board={selectedBoard}
        allBoards={lightboxBoards}
        autoEnterPresentCompare={autoEnterPresentCompare}
        compareBoards={compareBoardIds
          .map((id) => boards.find((b) => b.id === id))
          .filter((b): b is Board => Boolean(b))}
        onClose={() => {
          setSelectedBoard(null)
          setAutoEnterPresentCompare(false)
          setCompareBoardIds([])
        }}
        onNavigate={handleNavigate}
        isEditMode={false}
        currentUserRole={null}
        guestToken={token}
        guestName={guestName}
        guestTokenId={guest?.tokenId ?? null}
        guestCanComment={!!guest?.canComment}
        guestCanTrace={!!guest?.canTrace}
        // Phase B.4: lightbox follow. isPresenter is hardwired false — a guest
        // never broadcasts "lbv". While following with a board open, the viewport
        // is presenter-driven (local zoom/pan disabled); break-away restores it.
        liveChannelRef={liveChannelRef}
        isPresenter={false}
        viewportDriven={isFollowing && selectedBoard !== null}
        viewportTargetRef={lbViewportRef}
        lbCursorRef={lbCursorRef}
        cursorColor={laserColor}
        critDirty={critDirty}
        traceStreamRef={traceStreamRef}
      />
    </main>
  )
}
