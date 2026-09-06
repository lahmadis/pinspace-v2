import { useThree, useFrame } from '@react-three/fiber'
import React, { useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import type { WallConfig } from '@/lib/wallLayout'
import {
  ROOM_DEFAULT_FOV,
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

/**
 * How far wheel zoom may travel from the head-on framing while editing a wall,
 * as a multiple of that framing's own distance.
 *
 * The head-on pose sits at wallWidth * 1.35, so an 8ft wall frames from about
 * 130in out. The old 0.32 floor therefore stopped you 42in from the wall —
 * still further back than you would stand to read a drawing, which is exactly
 * what the close end of this range is for.
 */
const EDIT_ZOOM_MIN_FACTOR = 0.06
const EDIT_ZOOM_MAX_FACTOR = 2.2

/**
 * Absolute floor in inches, whichever the factor above works out to.
 *
 * The camera's near plane is 5in (StudioRoom) and the wall surface stands ~3in
 * proud of the centre the camera targets, so at 12in from target the sheet is
 * ~9in from the camera — clear of the near plane with margin. Without this a
 * narrow wall's small base distance would let the factor take you through it.
 */
const EDIT_ZOOM_MIN_INCHES = 12

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
  // `gl` is read for its WebXRManager — see xrPresenting in the frame loop.
  const { camera, gl } = useThree()
  const SWOOSH_DURATION_SECONDS = 0.95
  const MAX_SWOOSH_STEP_SECONDS = 1 / 45

  // Store the camera position before entering edit mode (so we can return to it)
  const savedCameraPosition = useRef<THREE.Vector3 | null>(null)
  const savedCameraTarget = useRef<THREE.Vector3 | null>(null)

  /**
   * The same thing for wall FOCUS, which is a separate journey with its own
   * entry and exit.
   *
   * Its own refs rather than the pair above: focus and edit can be entered from
   * one another, and sharing one slot would mean whichever was entered second
   * overwrote the pose the first still needs to return to.
   *
   * Focus had no restore at all until now. Edit mode saved and flew back, so
   * Escape in the editor returned you to where you double-clicked from; focus
   * simply released the camera and left it staring at the wall, which is what
   * made the read-only view page behave differently from the editor for what
   * looks like the same gesture.
   */
  const savedFocusPosition = useRef<THREE.Vector3 | null>(null)
  const savedFocusTarget = useRef<THREE.Vector3 | null>(null)

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
  /**
   * Distance the head-on pose put the camera at for the wall being edited.
   * Wheel zoom clamps against THIS rather than an absolute inch range: the
   * head-on distance is derived from the wall's width, so one fixed range would
   * be most of a 4ft wall's usable travel and almost none of a 40ft wall's.
   */
  const editBaseDistance = useRef(0)
  /**
   * How far back the wall-focus pose put the camera.
   *
   * The ceiling for zooming out while focus holds: a double-click frames the
   * whole wall, and pulling back past that is leaving the wall without saying
   * so. Set when the focus pose is computed, read by the wheel handler.
   */
  const focusBaseDistance = useRef(0)

  // Uniform swoosh animation state (same model for every wall).
  const isAnimating = useRef(false)
  const animationElapsedSeconds = useRef(0)
  const startPosition = useRef(new THREE.Vector3())
  const startTarget = useRef(new THREE.Vector3())
  const endPosition = useRef(new THREE.Vector3())
  const endTarget = useRef(new THREE.Vector3())
  // Overwritten by beginSwoosh before either is read; seeded from the room's
  // own lens so a stale literal cannot imply a focal length nothing uses.
  const startFov = useRef(ROOM_DEFAULT_FOV)
  const endFov = useRef(ROOM_DEFAULT_FOV)

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
    startPosition.current.copy(fromPosition)
    startTarget.current.copy(fromTarget)
    endPosition.current.copy(toPosition)
    endTarget.current.copy(toTarget)
    startFov.current = fromFov
    endFov.current = toFov
    animationElapsedSeconds.current = 0
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
      // Fallbacks match DEFAULT_WALL_CONFIG (10ft tall x 8ft wide), not each
      // other — a square default would misframe the wall it stands in for.
      const pose = getHeadOnPose(
        wallPosition,
        wallRotation,
        (wallDimensions?.width ?? 8) * 12,
        (wallDimensions?.height ?? 10) * 12,
      )
      targetTarget.current.copy(pose.target)
      editBaseDistance.current = pose.position.distanceTo(pose.target)

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
   * Clearing focus flies the camera BACK to wherever it was when focus began.
   * It used to just release the camera and leave you facing the wall, on the
   * reasoning that returning was a second unrequested move — but exiting edit
   * mode had always flown back, so the same gesture behaved differently in the
   * editor and on the read-only view page. Returning is the expectation the
   * rest of the app already set. See savedFocusPosition above.
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
    const prevKey = prevFocusedWallKey.current
    if (key === prevKey) return
    prevFocusedWallKey.current = key

    // Leaving focus. Fly back to wherever the camera was when focus began,
    // matching what exiting edit mode does.
    if (!focusedWall) {
      focusPoseArmed.current = false
      // Not while edit mode is running: that path saved its own pose on the
      // way in and will restore it on the way out, and two swooshes competing
      // for the same camera is worse than one.
      if (prevKey !== null && editingWall === null && savedFocusPosition.current) {
        const controls = getControls(orbitControlsRef)
        const fromTarget = controls ? controls.target.clone() : defaultPose.target.clone()
        const fromFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : ROOM_DEFAULT_FOV
        const returnTarget = savedFocusTarget.current ?? defaultPose.target
        targetTarget.current.copy(returnTarget)
        beginSwoosh(
          camera.position.clone(),
          fromTarget,
          savedFocusPosition.current.clone(),
          returnTarget.clone(),
          fromFov,
          ROOM_DEFAULT_FOV,
          false
        )
      }
      savedFocusPosition.current = null
      savedFocusTarget.current = null
      return
    }

    if (!wallConfig || editingWall !== null) {
      focusPoseArmed.current = false
      return
    }

    // Save only on the way IN. Moving focus straight from one wall to another
    // keeps the original pre-focus pose, so Escape returns you to where you
    // started rather than to the last wall you looked at.
    if (prevKey === null) {
      savedFocusPosition.current = camera.position.clone()
      const enterControls = getControls(orbitControlsRef)
      savedFocusTarget.current = enterControls ? enterControls.target.clone() : null
    }

    const pose = getWallFocusPose(wallConfig, focusedWall.wallIndex, focusedWall.side)
    if (pose) focusBaseDistance.current = pose.position.distanceTo(pose.target)
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

    /**
     * True while a WebXR session is presenting through this renderer — the
     * frames in which the HEADSET owns the camera and nothing here may touch
     * it. Every camera mutation below is gated on it, while the surrounding
     * bookkeeping (animation clock, completion callback, controls.target)
     * deliberately keeps running, so the desktop camera state machine stays
     * coherent and exiting the headset does not land mid-transition.
     *
     * Read off three.js's own WebXRManager rather than @react-three/xr's
     * `useXR` / `useXRStore`, and that is deliberate: both of those THROW
     * ("XR features can only be used inside the <XR> component") when no <XR>
     * provider is above them, and this component is mounted by FOUR canvases —
     * StudioRoom's (which is wrapped), the read-only view page, and the two
     * demo pages (which are not). Using the hooks here would crash three
     * surfaces that have nothing to do with VR, and tsc would not catch it.
     *
     * `gl.xr.isPresenting` is the same flag three.js itself arbitrates on, is
     * simply `false` whenever no session is running, and can be read every
     * frame without triggering a React render. Read per-frame rather than
     * captured at render, so the first frame after entry or exit is correct.
     */
    const xrPresenting = gl.xr.isPresenting

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
      const easeT = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2

      const currentTarget = new THREE.Vector3().lerpVectors(startTarget.current, endTarget.current, easeT)
      controls.target.copy(currentTarget)
      if (!xrPresenting) {
        camera.position.lerpVectors(startPosition.current, endPosition.current, easeT)
        camera.lookAt(currentTarget)
        camera.up.set(0, 1, 0)

        if (camera instanceof THREE.PerspectiveCamera) {
          // eslint-disable-next-line react-hooks/immutability -- Three.js projection state is intentionally updated in the render loop.
          camera.fov = THREE.MathUtils.lerp(startFov.current, endFov.current, easeT)
          camera.updateProjectionMatrix()
        }
      }

      if (t >= 1) {
        isAnimating.current = false
        controls.target.copy(endTarget.current)
        if (!xrPresenting) {
          camera.position.copy(endPosition.current)
          if (camera instanceof THREE.PerspectiveCamera) {
            camera.fov = endFov.current
            camera.updateProjectionMatrix()
          }
        }
        // Fires either way: the callback is UI bookkeeping (StudioRoom clears
        // its pending-transition state on it), and swallowing it in XR would
        // strand that state until the next transition.
        if (shouldNotifyOnComplete.current) {
          onTransitionComplete?.()
        }
      }
    }

    // Phase B.2: follow the presenter's broadcast camera. Editing and the swoosh
    // animation take priority (gated below), so following resumes after a swoosh
    // and never overrides edit framing. Lerp toward the latest pose so ~10Hz
    // packets render continuously instead of snapping.
    // ...and XR outranks all of it: a follower in a headset would have the
    // presenter's desktop pose lerped onto its head every frame.
    const followingNow = isFollowing && editingWall === null && !isAnimating.current && !xrPresenting
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
      !xrPresenting && editingWall === null && !holdingFocus && !isAnimating.current && !isFollowing
    const c = controls as { enableDamping?: boolean }
    c.enableDamping = false
    // `enabled = false` is NOT enough to keep OrbitControls off the camera —
    // it only detaches the input listeners, while update() still re-derives
    // camera.position and camera.quaternion from its spherical offset every
    // time it is called. Skipping the call is the part that actually leaves
    // the headset pose alone.
    if (!xrPresenting) controls.update()

    if (restoreOnNextFrame.current) {
      restoreOnNextFrame.current = false
      if (!xrPresenting) {
        camera.position.copy(positionOnEnd.current)
        controls.target.copy(targetOnEnd.current)
      }
    }

    if ((editingWall !== null || holdingFocus) && !isAnimating.current && !xrPresenting) {
      camera.lookAt(targetTarget.current)
      camera.up.set(0, 1, 0)
      camera.updateProjectionMatrix()
    }
  })

  /**
   * Wheel zoom while editing a wall.
   *
   * OrbitControls is switched off entirely in edit mode (StudioRoom passes
   * enabled={false}) and its target prop points at the room's centre, so
   * turning its zoom back on would dolly toward the middle of the room rather
   * than the wall in front of you. This dollies along the camera-to-wall axis
   * instead, which is the axis the head-on hold already maintains.
   *
   * Safe against that hold: the frame loop re-aims the camera every frame but
   * never re-pins its POSITION, so a distance change survives.
   *
   * Exponential in deltaY, not a fixed step per event: a mouse wheel sends a
   * few large deltas and a trackpad a stream of small ones, and a fixed step
   * per event makes the trackpad fly.
   */
  useEffect(() => {
    const inEdit = editingWall !== null
    const inFocus = !inEdit && Boolean(focusedWall)
    if (!inEdit && !inFocus) return
    const el = gl.domElement
    const axis = new THREE.Vector3()

    const onWheel = (e: WheelEvent) => {
      // Not while a headset is presenting. The canvas keeps receiving wheel
      // events from the desktop mirror window, and dollying the camera along
      // the wall axis under someone wearing it is the worst version of this.
      if (gl.xr.isPresenting) return
      // Not while the swoosh is flying: the animation writes camera.position
      // every frame and would eat the scroll, which reads as a dead wheel.
      if (isAnimating.current) return
      // The canvas fills the viewport in both modes; without this the page
      // scrolls behind it.
      e.preventDefault()
      axis.subVectors(camera.position, targetTarget.current)
      const dist = axis.length()
      if (dist < 1e-3) return
      axis.divideScalar(dist)

      /**
       * Focus zooms IN freely and OUT only as far as the framing it started
       * from.
       *
       * OrbitControls is switched off while focus holds (see holdingFocus), so
       * without this there was no zoom at all in a mode whose entire purpose is
       * reading a wall — you could fly square-on to a sheet of 8pt text and not
       * get closer to it. The out-stop is the double-click pose itself: focus
       * means "this wall", and a wheel that keeps going until the room reappears
       * has quietly ended the mode without touching Exit focus.
       */
      const base = inFocus
        ? focusBaseDistance.current || dist
        : editBaseDistance.current || dist
      const next = THREE.MathUtils.clamp(
        dist * Math.exp(e.deltaY * 0.0015),
        Math.max(base * EDIT_ZOOM_MIN_FACTOR, EDIT_ZOOM_MIN_INCHES),
        inFocus ? base : base * EDIT_ZOOM_MAX_FACTOR,
      )
      camera.position.copy(targetTarget.current).addScaledVector(axis, next)
    }

    // passive:false because the handler calls preventDefault.
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [editingWall, focusedWall, gl, camera])

  return null
}
