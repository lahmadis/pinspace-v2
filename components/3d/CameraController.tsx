import { useThree, useFrame } from '@react-three/fiber'
import React, { useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import type { WallConfig } from '@/lib/wallLayout'
import {
  EASE_SWOOSH_REDIRECT,
  EASE_SWOOSH_START,
  MAX_SWOOSH_STEP_SECONDS,
  ROOM_DEFAULT_FOV,
  SWOOSH_DURATION_SECONDS,
  getHeadOnPose,
  getPresetPose,
  getWallFocusPose,
  type RoomCameraPreset,
} from '@/lib/room/cameraViews'

/**
 * The room's resting camera FOV. Defined in lib/room/cameraViews.ts (where the
 * preset math also needs it, without importing this component) and re-exported
 * here so existing importers — StudioRoom's <PerspectiveCamera> `fov` prop —
 * keep working from the same path.
 */
export { ROOM_DEFAULT_FOV }

function getControls(ref: React.RefObject<unknown> | null | undefined): OrbitControlsType | null {
  const r = ref?.current
  if (!r) return null
  if (typeof (r as { get?: () => OrbitControlsType }).get === 'function') {
    return (r as { get: () => OrbitControlsType }).get()
  }
  return r as OrbitControlsType
}

/** Phase B.2: presenter camera pose, broadcast over the studio-live channel. */
export interface FollowPose {
  /** Camera world position [x, y, z]. */
  p: [number, number, number]
  /** OrbitControls target [x, y, z]. */
  t: [number, number, number]
}

/**
 * Phase B.3: latest laser-pointer world position for followers to render. `seq`
 * bumps per received packet so the renderer can detect staleness via frame
 * deltas (no Date.now in the frame loop). Null = laser off / never started.
 */
export interface LaserState {
  p: [number, number, number]
  seq: number
}

/**
 * Phase B.3.1: lightbox viewport for presenter→follower sync. z = zoom (scale
 * relative to the contain-fit base); cx,cy = image fraction (0..1) at the
 * container center. Resolution-independent, so followers with a different
 * window size reproduce the same framing.
 */
export interface LbViewport {
  z: number
  cx: number
  cy: number
}

/**
 * Phase B.3.2: presenter pointer over the lightbox image, for the follower 2D
 * cursor dot. cx,cy = image fraction (0..1) — same space as LbViewport — so the
 * follower maps it through their own viewport transform. seq bumps per packet so
 * the renderer detects staleness via frame deltas (no Date.now in the loop).
 */
export interface LbCursorState {
  cx: number
  cy: number
  seq: number
}

/**
 * Phase B.5: debounced "a peer changed traces/callouts on this board" signal.
 * Built on the page from incoming "crit-dirty" broadcasts (ref + debounce); the
 * lightbox refetches the matching kind(s) for boardId when seq changes. boardId
 * lets the lightbox ignore signals for a board it isn't showing.
 */
export interface CritDirtySignal {
  boardId: string
  trace: boolean
  callout: boolean
  seq: number
}

/**
 * Phase B.5.1: one peer's in-progress (ephemeral) trace strokes, streamed live
 * via "trace-pt"/"trace-end" before the debounced save lands. Keyed in the page
 * by `${boardId}|${authorKey}`; rendered on the trace canvas and cleared once the
 * author's persisted layer refetches (the saved version converges silently).
 * Points are image fractions (0..1), same space as stored traces.
 */
export interface TraceStreamEntry {
  boardId: string
  authorKey: string
  color: string
  /** Completed streamed strokes (each got a trace-end). */
  completed: [number, number][][]
  /** The stroke currently being drawn (null between strokes). */
  live: [number, number][] | null
}

/** A wall face the camera is framing head-on outside of edit mode. */
export interface FocusedWall {
  wallIndex: number
  side: 'front' | 'back'
  /**
   * Bumped by the caller each time focus is (re-)requested, so double-clicking
   * the wall you're already focused on re-frames it instead of doing nothing —
   * which is what you want after orbiting away from it. Consumers that only
   * dim (WallSystem) ignore this and read wallIndex.
   */
  nonce?: number
}

/**
 * A request to fly to a named preset. `key` is bumped by the caller to re-fire
 * the same preset (pressing "Axon" twice should re-centre both times), the same
 * pattern `transitionKey` uses for re-entering a wall.
 */
export interface PresetRequest {
  preset: RoomCameraPreset
  key: number
}

interface CameraControllerProps {
  orbitControlsRef?: React.RefObject<unknown> | null
  editingWall: number | null
  wallPosition: THREE.Vector3 | null
  wallRotation: number
  wallDimensions?: { width: number; height: number } | null // Wall dimensions in feet
  transitionKey?: number
  onTransitionComplete?: () => void
  /** Phase B.2: when true, the local user follows the presenter's camera. */
  isFollowing?: boolean
  /** Phase B.2: latest received presenter pose (read in the frame loop, never via state). */
  followPoseRef?: React.MutableRefObject<FollowPose | null>
  /**
   * Room geometry, needed to compute preset and wall-focus poses. Optional so
   * callers that only use edit-mode framing (which carries its own wall pose in
   * the props above) don't have to thread it through.
   */
  wallConfig?: WallConfig | null
  /**
   * Wall being framed head-on WITHOUT entering edit mode — the read-only focus
   * state. Holds the camera square-on the way edit mode does — OrbitControls is
   * switched off for the duration, because a head-on view you drift off at the
   * first mouse move isn't one. The difference from `editingWall` is only that
   * nothing here is editable. Ignored while `editingWall` is set, which
   * outranks it.
   */
  focusedWall?: FocusedWall | null
  /** Latest "fly to this preset" request; see PresetRequest. */
  presetRequest?: PresetRequest | null
}

export function CameraController({ 
  orbitControlsRef,
  editingWall, 
  wallPosition, 
  wallRotation,
  wallDimensions,
  transitionKey = 0,
  onTransitionComplete,
  isFollowing = false,
  followPoseRef,
  wallConfig = null,
  focusedWall = null,
  presetRequest = null,
}: CameraControllerProps) {
  const { camera } = useThree()

  /**
   * prefers-reduced-motion, read live rather than at mount so toggling the OS
   * setting takes effect without a reload. Seeded synchronously so a swoosh
   * fired on the very first frame — before effects run — already respects it.
   *
   * This component renders nothing, so reading matchMedia during render can't
   * cause a hydration mismatch.
   */
  // Lazily seeded: useRef's argument is not lazy, so probing matchMedia inline
  // would allocate a MediaQueryList on every render (twice per pass under
  // StrictMode) and discard all but the first. null = not yet probed.
  const prefersReducedMotion = useRef<boolean | null>(null)
  if (prefersReducedMotion.current === null) {
    prefersReducedMotion.current =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false
  }
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion.current = query.matches
    const onChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion.current = event.matches
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Store the camera position before entering edit mode (so we can return to it)
  const savedCameraPosition = useRef<THREE.Vector3 | null>(null)
  const savedCameraTarget = useRef<THREE.Vector3 | null>(null)

  // Fallback pose for exiting edit mode with nothing saved. Derived from the
  // room's own geometry via the shared preset math, so it matches where the
  // room actually loads; the hardcoded numbers that used to live here were a
  // fourth, drifted copy of the axonometric framing. The literal fallback only
  // applies when no wallConfig was threaded through (edit-only callers).
  //
  // Recomputed per render rather than held in a ref on purpose: wallConfig is
  // commonly null on the first render and populated once the room loads, and a
  // ref initialised on that first render would pin the fallback forever.
  const defaultPose = wallConfig
    ? getPresetPose('axon', wallConfig)
    : { position: new THREE.Vector3(70, 129, 70), target: new THREE.Vector3(0, 60, 0), fov: ROOM_DEFAULT_FOV }

  // Track previous editing wall to detect enter/exit.
  const prevEditingWall = useRef<number | null>(null)
  const lastHandledTransitionKey = useRef<number>(-1)
  // Preset requests and wall focus each fire once per change, not per render.
  const lastHandledPresetKey = useRef<number>(-1)
  const prevFocusedWallKey = useRef<string | null>(null)
  /**
   * True only once the focus effect has resolved a pose and aimed
   * `targetTarget` at it. The frame loop must gate the camera hold on THIS, not
   * on `focusedWall != null` — a focus request that can't resolve (wall deleted,
   * wallConfig not loaded yet) would otherwise disable orbit and pin the camera
   * on a stale target, which on a surface that never enters edit mode is the
   * zero vector: locked, staring at the world origin.
   */
  const focusPoseArmed = useRef(false)
  const pendingAnimation = useRef(false)
  const targetTarget = useRef(new THREE.Vector3())
  const shouldNotifyOnComplete = useRef(false)

  // Uniform swoosh animation state (same model for every wall).
  const isAnimating = useRef(false)
  const animationElapsedSeconds = useRef(0)
  const startPosition = useRef(new THREE.Vector3())
  const startTarget = useRef(new THREE.Vector3())
  const endPosition = useRef(new THREE.Vector3())
  const endTarget = useRef(new THREE.Vector3())
  const startFov = useRef(ROOM_DEFAULT_FOV)
  const endFov = useRef(ROOM_DEFAULT_FOV)
  /**
   * Which curve the in-flight move is using. Set per move rather than fixed,
   * because a move that interrupts another one needs a different curve than one
   * starting from rest — see beginSwoosh.
   */
  const swooshEasing = useRef(EASE_SWOOSH_START)
  // Scratch vector for the per-frame target lerp. The frame loop used to
  // allocate a fresh Vector3 here every frame, against this file's own
  // no-per-frame-alloc convention; the resulting GC pressure showed up as
  // exactly the kind of stutter the swoosh is supposed to avoid.
  const swooshTargetVec = useRef(new THREE.Vector3())

  // When user releases mouse, OrbitControls still applies one frame of leftover delta.
  const restoreOnNextFrame = useRef(false)
  const positionOnEnd = useRef(new THREE.Vector3())
  const targetOnEnd = useRef(new THREE.Vector3())

  // Phase B.2: reusable scratch vectors for the follow lerp (no per-frame alloc).
  const followPosVec = useRef(new THREE.Vector3())
  const followTargetVec = useRef(new THREE.Vector3())
  const editingWallRef = useRef(editingWall)

  useLayoutEffect(() => {
    editingWallRef.current = editingWall
  }, [editingWall])

  // Track the controls instance we registered the 'end' listener on so we
  // can remove it if the instance changes or the component unmounts.
  const listenerControlsRef = useRef<OrbitControlsType | null>(null)
  const endHandlerRef = useRef<(() => void) | null>(null)

  const beginSwoosh = (
    fromPosition: THREE.Vector3,
    fromTarget: THREE.Vector3,
    toPosition: THREE.Vector3,
    toTarget: THREE.Vector3,
    fromFov: number,
    toFov: number,
    notifyOnComplete: boolean
  ) => {
    // Redirect, never queue and never snap. Every caller passes the LIVE
    // camera.position as `fromPosition`, so a second request mid-flight simply
    // re-aims from wherever the camera actually is. What that alone doesn't fix
    // is speed: replaying the from-rest curve would brake a moving camera to a
    // stop and re-accelerate it. Switching to the redirect curve starts the new
    // move at full speed instead, so the seam is invisible.
    const interrupting = isAnimating.current
    swooshEasing.current = interrupting ? EASE_SWOOSH_REDIRECT : EASE_SWOOSH_START

    startPosition.current.copy(fromPosition)
    startTarget.current.copy(fromTarget)
    endPosition.current.copy(toPosition)
    endTarget.current.copy(toTarget)
    startFov.current = fromFov
    endFov.current = toFov
    // prefers-reduced-motion gets an instant cut, not a quicker swoosh. Seeding
    // elapsed at the full duration makes the next frame land on t = 1, which
    // applies the end pose exactly and fires onTransitionComplete through the
    // normal path — no duplicate arrival logic to drift out of sync.
    animationElapsedSeconds.current = prefersReducedMotion.current ? SWOOSH_DURATION_SECONDS : 0
    shouldNotifyOnComplete.current = notifyOnComplete
    isAnimating.current = true
  }

  useEffect(() => {
    const enteringEditMode = prevEditingWall.current === null && editingWall !== null
    const switchingWalls =
      prevEditingWall.current !== null &&
      editingWall !== null &&
      prevEditingWall.current !== editingWall
    const exitingEditMode = prevEditingWall.current !== null && editingWall === null
    const transitionRequested = transitionKey !== lastHandledTransitionKey.current

    // Save camera pose before entering edit mode.
    if (enteringEditMode) {
      savedCameraPosition.current = camera.position.clone()
      const controls = getControls(orbitControlsRef)
      if (controls) {
        savedCameraTarget.current = controls.target.clone()
      }
    }
    if (enteringEditMode || switchingWalls || (transitionRequested && editingWall !== null)) {
      pendingAnimation.current = true
    }

    if (editingWall !== null && wallPosition) {
      const shouldAnimateToWall =
        pendingAnimation.current ||
        enteringEditMode ||
        switchingWalls ||
        transitionRequested

      if (!shouldAnimateToWall) {
        prevEditingWall.current = editingWall
        lastHandledTransitionKey.current = transitionKey
        return
      }
      pendingAnimation.current = false

      // Same head-on framing the read-only focus state uses, so a wall sits in
      // frame identically whether you're editing it or just looking at it.
      // wallRotation already carries the back-face half-turn from WallSystem.
      const pose = getHeadOnPose(wallPosition, wallRotation, (wallDimensions?.width ?? 8) * 12)
      targetTarget.current.copy(pose.target)

      const controls = getControls(orbitControlsRef)
      const fromTarget = controls ? controls.target.clone() : targetTarget.current.clone()
      const fromFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : ROOM_DEFAULT_FOV
      beginSwoosh(
        camera.position.clone(),
        fromTarget,
        pose.position,
        pose.target,
        fromFov,
        pose.fov,
        true
      )
    } else if (exitingEditMode) {
      pendingAnimation.current = false
      const returnPosition = savedCameraPosition.current || defaultPose.position
      const returnTarget = savedCameraTarget.current || defaultPose.target
      const controls = getControls(orbitControlsRef)
      const fromTarget = controls ? controls.target.clone() : defaultPose.target.clone()
      const fromFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : ROOM_DEFAULT_FOV
      beginSwoosh(
        camera.position.clone(),
        fromTarget,
        returnPosition.clone(),
        returnTarget.clone(),
        fromFov,
        ROOM_DEFAULT_FOV,
        false
      )
    }

    prevEditingWall.current = editingWall
    lastHandledTransitionKey.current = transitionKey
  }, [editingWall, wallPosition, wallRotation, wallDimensions, camera, transitionKey, orbitControlsRef])

  /**
   * Fly to a named preset. Keyed rather than value-compared so pressing the same
   * preset twice re-centres both times. Edit mode outranks this — its own
   * framing is the whole point of being in edit mode — so a preset pressed while
   * editing is ignored rather than queued.
   */
  useEffect(() => {
    if (!presetRequest || !wallConfig) return
    if (presetRequest.key === lastHandledPresetKey.current) return
    lastHandledPresetKey.current = presetRequest.key
    if (editingWall !== null) return

    const pose = getPresetPose(presetRequest.preset, wallConfig)
    const controls = getControls(orbitControlsRef)
    const fromTarget = controls ? controls.target.clone() : pose.target.clone()
    const fromFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : ROOM_DEFAULT_FOV
    beginSwoosh(camera.position.clone(), fromTarget, pose.position, pose.target, fromFov, pose.fov, false)
    // wallConfig is read but deliberately not a dependency: it changes identity
    // on every wall drag, and re-firing the swoosh mid-drag would yank the
    // camera. The keyed request is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetRequest, editingWall, camera])

  /**
   * Fly head-on to a focused wall — the same framing edit mode uses, and, since
   * it's the same gesture, held the same way: the frame loop keeps the camera
   * pinned and OrbitControls off for as long as focus lasts. Read-only, so you
   * get the square-on view of the wall without the editing UI.
   *
   * Clearing focus deliberately does NOT fly the camera back. It leaves you
   * looking at the wall you asked for, with control handed back — flying you
   * somewhere else on exit would be a second unrequested camera move.
   */
  useEffect(() => {
    // editingWall is part of the key, not just a guard below, so that any future
    // path which sets it WITHOUT clearing focus still re-runs this effect and
    // disarms. Relying on the guard alone made correctness conventional — it
    // held only because the one enter-edit path happens to clear focus first —
    // and the bug that convention hid (camera pinned to a stale target with
    // orbit off, after exiting edit) is invisible until someone hits it.
    const key = focusedWall
      ? `${focusedWall.wallIndex}:${focusedWall.side}:${focusedWall.nonce ?? 0}:${editingWall ?? 'none'}`
      : null
    if (key === prevFocusedWallKey.current) return
    prevFocusedWallKey.current = key

    if (!focusedWall || !wallConfig || editingWall !== null) {
      focusPoseArmed.current = false
      return
    }

    const pose = getWallFocusPose(wallConfig, focusedWall.wallIndex, focusedWall.side)
    if (!pose) {
      // Wall deleted out from under a stale focus. Leave the camera alone
      // rather than holding it on a wall that isn't there.
      focusPoseArmed.current = false
      return
    }

    // The frame loop re-aims at this every frame while focus holds, so it has
    // to be the focused wall's centre and not whatever edit mode last set.
    targetTarget.current.copy(pose.target)

    const controls = getControls(orbitControlsRef)
    const fromTarget = controls ? controls.target.clone() : pose.target.clone()
    const fromFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : ROOM_DEFAULT_FOV
    beginSwoosh(camera.position.clone(), fromTarget, pose.position, pose.target, fromFov, pose.fov, false)
    focusPoseArmed.current = true
    // wallConfig intentionally omitted, same reason as the preset effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedWall, editingWall, camera])

  // Remove the 'end' listener when the component unmounts
  useEffect(() => {
    return () => {
      if (listenerControlsRef.current && endHandlerRef.current) {
        listenerControlsRef.current.removeEventListener('end', endHandlerRef.current)
      }
    }
  }, [])

  // Register/re-register the 'end' listener whenever the controls instance changes.
  // Runs inside useFrame so we pick up the controls as soon as they're available,
  // but we avoid the anti-pattern of addEventListener inside the hot frame path by
  // guarding on instance identity rather than a boolean flag.
  // eslint-disable-next-line react-hooks/immutability -- R3F owns this imperative camera; frame callbacks must mutate it in place.
  useFrame((_state, delta) => {
    const controls = getControls(orbitControlsRef)
    if (!controls) return

    // Captured before the swoosh block, which clears isAnimating on its final
    // frame. The restore below has to know whether a swoosh owned the camera at
    // any point during THIS frame, not whether one is still running by the time
    // we reach it — otherwise an 'end' event landing in the last inter-frame gap
    // gets applied on the very frame the swoosh lands, overwriting the arrival
    // pose with the stale drag-release pose and leaving the camera stuck there.
    const swooshOwnsCameraThisFrame = isAnimating.current

    if (listenerControlsRef.current !== controls) {
      // Remove from old instance if there was one
      if (listenerControlsRef.current && endHandlerRef.current) {
        listenerControlsRef.current.removeEventListener('end', endHandlerRef.current)
      }
      // Create a stable handler that reads from refs so it never goes stale
      endHandlerRef.current = () => {
        if (editingWallRef.current !== null) return
        positionOnEnd.current.copy(camera.position)
        targetOnEnd.current.copy(controls.target)
        restoreOnNextFrame.current = true
      }
      controls.addEventListener('end', endHandlerRef.current)
      listenerControlsRef.current = controls
    }

    if (isAnimating.current) {
      // Cap per-frame progression so transient stalls (e.g. save/exit work)
      // can't skip the entire swoosh in one frame.
      const steppedDelta = Math.min(delta, MAX_SWOOSH_STEP_SECONDS)
      animationElapsedSeconds.current = Math.min(
        animationElapsedSeconds.current + steppedDelta,
        SWOOSH_DURATION_SECONDS
      )
      const t = Math.min(animationElapsedSeconds.current / SWOOSH_DURATION_SECONDS, 1)
      const easeT = swooshEasing.current(t)

      camera.position.lerpVectors(startPosition.current, endPosition.current, easeT)
      const currentTarget = swooshTargetVec.current.lerpVectors(
        startTarget.current,
        endTarget.current,
        easeT
      )
      controls.target.copy(currentTarget)
      camera.lookAt(currentTarget)
      camera.up.set(0, 1, 0)

      if (camera instanceof THREE.PerspectiveCamera) {
        // eslint-disable-next-line react-hooks/immutability -- Three.js projection state is intentionally updated in the render loop.
        camera.fov = THREE.MathUtils.lerp(startFov.current, endFov.current, easeT)
        camera.updateProjectionMatrix()
      }

      if (t >= 1) {
        isAnimating.current = false
        camera.position.copy(endPosition.current)
        controls.target.copy(endTarget.current)
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = endFov.current
          camera.updateProjectionMatrix()
        }
        if (shouldNotifyOnComplete.current) {
          onTransitionComplete?.()
        }
      }
    }

    // Phase B.2: follow the presenter's broadcast camera. Editing and the swoosh
    // animation take priority (gated below), so following resumes after a swoosh
    // and never overrides edit framing. Lerp toward the latest pose so ~10Hz
    // packets render continuously instead of snapping.
    const followingNow = isFollowing && editingWall === null && !isAnimating.current
    const pose = followPoseRef?.current
    if (followingNow && pose) {
      const alpha = 1 - Math.exp(-delta * 10)
      followPosVec.current.set(pose.p[0], pose.p[1], pose.p[2])
      followTargetVec.current.set(pose.t[0], pose.t[1], pose.t[2])
      camera.position.lerp(followPosVec.current, alpha)
      controls.target.lerp(followTargetVec.current, alpha)
      camera.lookAt(controls.target)
      camera.up.set(0, 1, 0)
    }

    // Control arbitration: editing wins over following; the swoosh suspends both.
    // While following, OrbitControls input is disabled so the user can't fight the
    // followed camera (Escape / "Stop following" detaches upstream, which flips
    // isFollowing and re-enables input on the next frame — no stuck-disabled
    // state). The presenter cursor (B.3.1) is passive observation and does NOT
    // suppress the presenter's own controls.
    //
    // Wall focus holds the camera too. Flying square-on and then letting the
    // very next mouse move drift off-axis isn't "head-on", it's a brief glance
    // at head-on — and the point of the gesture is to READ the wall. Leaving
    // focus (Escape, a floor click, or Exit focus) hands control straight back.
    // Gated on the armed ref rather than the prop, and excluding follow mode:
    // a follower whose camera is being lerped to the presenter's pose must not
    // also have its aim overridden, or position follows while orientation
    // doesn't.
    const holdingFocus = focusPoseArmed.current && editingWall === null && !isFollowing
    controls.enabled =
      editingWall === null && !holdingFocus && !isAnimating.current && !isFollowing
    const c = controls as { enableDamping?: boolean }
    c.enableDamping = false
    controls.update()

    // Deliberately skipped on any frame a swoosh owned the camera. This restore
    // exists to undo OrbitControls' one frame of leftover momentum after the
    // user lets go; applied on top of a swoosh it would instead yank the camera
    // back to the drag-release pose, either as a visible hitch mid-move or — on
    // the arrival frame — as a permanent one, since nothing re-applies the end
    // pose afterwards and orbit stays disabled under focus. Dropping the
    // restore rather than deferring it is right: the swoosh is authoritative
    // about where the camera goes, and there is no leftover momentum left to
    // correct once it lands.
    if (restoreOnNextFrame.current) {
      if (!swooshOwnsCameraThisFrame) {
        camera.position.copy(positionOnEnd.current)
        controls.target.copy(targetOnEnd.current)
      }
      restoreOnNextFrame.current = false
    }

    if ((editingWall !== null || holdingFocus) && !isAnimating.current) {
      camera.lookAt(targetTarget.current)
      camera.up.set(0, 1, 0)
      camera.updateProjectionMatrix()
    }
  })

  return null
}
