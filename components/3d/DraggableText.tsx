'use client'

/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect -- Frozen R3F drag semantics synchronize local geometry and the renderer cursor imperatively. */

import { useRef, useState, useEffect } from 'react'
import { useThree, ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { Text, Html } from '@react-three/drei'
import type { WallTextItem } from '@/lib/wallLayout'
import { ROOM_FONT_3D, ROOM } from '@/lib/room/palette'
import { consumeDoubleClick } from '@/lib/room/consumeDoubleClick'
import { useDisposableGeometry } from './useDisposableGeometry'

/**
 * The box border, in three states.
 *
 * A label with no border is invisible as an OBJECT — you can read the words but
 * nothing tells you there is a text box there to double-click, which is the
 * whole reason this exists. So the resting state draws one too: light enough to
 * disappear against the wall at a glance, present enough to find.
 *
 * Not the old ENGINE_PALETTE.selection yellow in any state — that read as a
 * warning on a white wall rather than as a text box.
 */
const BORDER_IDLE = '#C3CAD9'
const BORDER_HOVER = '#8A93A8'
const BORDER_ACTIVE = ROOM.accent

/** CSS px the in-place input is styled at before the 3D scale is applied. */
const EDIT_FONT_PX = 15

/**
 * CSS pixels per scene unit inside drei's `<Html transform>`.
 *
 * Not a guess — read off drei/web/Html.js, which builds the inner matrix as
 * `getObjectCSSMatrix(matrix, 1 / ((distanceFactor || 10) / 400))`. That factor
 * divides the object's basis vectors (never its translation), so with no
 * distanceFactor it is 400/10 = 40: an element P px wide at group scale S spans
 * P·S/40 scene units. Matching a font therefore needs the scale multiplied by
 * this, and leaving it out renders the input at 1/40 size — visible only as a
 * speck on the wall.
 */
const HTML_TRANSFORM_PX_PER_UNIT = 40

const STEP_BUTTON_STYLE: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: '1px solid rgba(22,24,29,0.18)',
  background: '#ffffff',
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
}

interface DraggableTextProps {
  item: WallTextItem
  wallPosition: THREE.Vector3
  wallRotation: number
  /** Same wall-local rotation used for pointer→(x,y) so front and back share coords (avoids inversion). */
  wallBaseRotationForCoords?: number
  wallDimensions: { width: number; height: number }
  side?: 'front' | 'back'
  isSelected: boolean
  onSelect: (id: string) => void
  onDragEnd: (id: string, x: number, y: number) => void
  /** Off for viewers who may open a wall but not write the wall-config blob. */
  canEdit?: boolean
  onTextChange?: (id: string, text: string) => void
  onFontSizeChange?: (id: string, fontSize: number) => void
  onRemove?: (id: string) => void
}

/**
 * Edit-mode draggable wall text label. Deliberately NOT a fork of
 * DraggableBoard — it only reuses the pointer→wall-local math pattern
 * (raycast onto the wall plane → wall-local inches → normalized x/y clamped to
 * [-0.5, 0.5]). Text lives in the wall-config blob, so there is no per-item DB
 * write here: the parent commits (x,y) on pointer-up and persists the whole
 * blob through the existing versioned wall-config POST.
 */
export function DraggableText({
  item,
  wallPosition,
  wallRotation,
  wallBaseRotationForCoords,
  wallDimensions,
  side = 'front',
  isSelected,
  onSelect,
  onDragEnd,
  canEdit = false,
  onTextChange,
  onFontSizeChange,
  onRemove,
}: DraggableTextProps) {
  const { camera, gl, raycaster } = useThree()

  const SCALE = 12 // 1 ft = 12 inches; scene unit = 1 inch
  const scaledWallWidth = wallDimensions.width * SCALE
  const scaledWallHeight = wallDimensions.height * SCALE
  const isBackSide = side === 'back'
  const renderXSign = isBackSide ? -1 : 1

  /**
   * Double-click opens the box for typing. Kept as its own state rather than
   * folded into `isSelected` because the two mean different things: selected is
   * "this is the label the controls act on", editing is "the keyboard goes
   * here". Selecting alone must not swallow keystrokes — the room still has to
   * respond to them — and it must not blank the 3D type either.
   */
  const [editing, setEditing] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [localPos, setLocalPos] = useState({ x: item.x, y: item.y })
  const posRef = useRef({ x: item.x, y: item.y })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const listenersRef = useRef<{ move: ((e: PointerEvent) => void) | null; up: ((e: PointerEvent) => void) | null }>({
    move: null,
    up: null,
  })

  // Adopt external position changes (load / another edit) unless we're mid-drag.
  useEffect(() => {
    if (isDragging) return
    posRef.current = { x: item.x, y: item.y }
    setLocalPos({ x: item.x, y: item.y })
  }, [item.x, item.y, isDragging])

  // Deselecting from anywhere else (another label, the wall, leaving edit mode)
  // has to close the input too, or a hidden field keeps the caret.
  useEffect(() => {
    if (!isSelected) setEditing(false)
  }, [isSelected])

  // Remove any lingering window listeners if we unmount mid-drag.
  useEffect(() => {
    return () => {
      if (listenersRef.current.move) window.removeEventListener('pointermove', listenersRef.current.move)
      if (listenersRef.current.up) window.removeEventListener('pointerup', listenersRef.current.up)
    }
  }, [])

  // Pointer → wall-local normalized (x,y). Same construction as
  // DraggableBoard.updatePosition: a wall plane from the coord-rotation normal,
  // a render-right basis carrying renderXSign, project the hit, subtract the
  // grab offset, divide by the scaled wall, clamp to [-0.5, 0.5].
  const pointerToNormalized = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const rotationForCoords = wallBaseRotationForCoords ?? wallRotation
    const wallNormal = new THREE.Vector3(-Math.sin(rotationForCoords), 0, -Math.cos(rotationForCoords)).normalize()
    const renderRightWorld = new THREE.Vector3(renderXSign, 0, 0)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), wallRotation)
      .normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(wallNormal, wallPosition)

    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)

    const hit = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return null
    const pointOnWall = hit.sub(wallPosition)
    const pointerRenderX = pointOnWall.dot(renderRightWorld)
    const pointerRenderY = pointOnWall.y
    const centerInchesX = pointerRenderX - dragOffset.current.x
    const centerInchesY = pointerRenderY - dragOffset.current.y
    return {
      x: THREE.MathUtils.clamp(centerInchesX / scaledWallWidth, -0.5, 0.5),
      y: THREE.MathUtils.clamp(centerInchesY / scaledWallHeight, -0.5, 0.5),
    }
  }

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onSelect(item.id)

    // Grab offset = pointer render-space minus current center, so the label
    // doesn't jump to the cursor on grab.
    const rotationForCoords = wallBaseRotationForCoords ?? wallRotation
    const wallNormal = new THREE.Vector3(-Math.sin(rotationForCoords), 0, -Math.cos(rotationForCoords)).normalize()
    const renderRightWorld = new THREE.Vector3(renderXSign, 0, 0)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), wallRotation)
      .normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(wallNormal, wallPosition)
    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
    const hit = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(plane, hit)) {
      const pointOnWall = hit.sub(wallPosition)
      dragOffset.current = {
        x: pointOnWall.dot(renderRightWorld) - posRef.current.x * scaledWallWidth,
        y: pointOnWall.y - posRef.current.y * scaledWallHeight,
      }
    } else {
      dragOffset.current = { x: 0, y: 0 }
    }

    setIsDragging(true)
    gl.domElement.style.cursor = 'grabbing'

    const handleMove = (ev: PointerEvent) => {
      const next = pointerToNormalized(ev.clientX, ev.clientY)
      if (next) {
        posRef.current = next
        setLocalPos(next)
      }
    }
    const handleUp = () => {
      gl.domElement.style.cursor = 'grab'
      const final = posRef.current
      onDragEnd(item.id, final.x, final.y)
      setIsDragging(false)
      listenersRef.current = { move: null, up: null }
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    listenersRef.current = { move: handleMove, up: handleUp }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  // Edit render mirrors DraggableBoard: inside a group at the wall
  // (position + wallRotation), an inner group offset in wall-local inches. Back
  // side flips only render X so it lines up with the mirrored edit camera.
  const textX = localPos.x * scaledWallWidth
  const textXRender = isBackSide ? -textX : textX
  const textY = localPos.y * scaledWallHeight
  const textZ = 3.3 // just in front of boards (3.2) so labels never z-fight

  // Approximate bounds for the invisible grab target. Sized from fontSize +
  // text length (not position) so it doesn't churn while dragging. A generous
  // width keeps the whole label grabbable.
  const hitWidth = Math.max(item.fontSize * 2, item.text.length * item.fontSize * 0.62)
  const hitHeight = item.fontSize * 1.6

  const showControls = isSelected && canEdit && !editing
  const stepFontSize = (delta: number) =>
    onFontSizeChange?.(item.id, THREE.MathUtils.clamp(Math.round(item.fontSize) + delta, 2, 96))

  const borderColor = editing || isSelected ? BORDER_ACTIVE : hovered ? BORDER_HOVER : BORDER_IDLE
  const borderGeom = useDisposableGeometry(
    () => new THREE.PlaneGeometry(hitWidth, hitHeight),
    [hitWidth, hitHeight],
  )

  return (
    <group position={wallPosition} rotation={[0, wallRotation, 0]}>
      <group position={[textXRender, textY, textZ]}>
        {/* Invisible drag/select target */}
        <mesh
          onPointerDown={handlePointerDown}
          // The wall plane behind this label opens edit mode on double click,
          // and R3F only stops the walk on objects carrying that named handler.
          // Swallow it so double-clicking a label can't jump edit mode.
          onDoubleClick={(e) => {
            consumeDoubleClick(e)
            if (!canEdit) return
            onSelect(item.id)
            setEditing(true)
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHovered(true)
            gl.domElement.style.cursor = canEdit ? 'text' : 'grab'
          }}
          onPointerOut={(e) => {
            e.stopPropagation()
            setHovered(false)
            if (!isDragging) gl.domElement.style.cursor = 'default'
          }}
        >
          <planeGeometry args={[hitWidth, hitHeight]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>

        {/* ROOM.ink, not ENGINE_PALETTE.darkText: WallSystem paints the
            same label with the former once you leave edit mode, and two
            near-blacks that don't match are the same class of bug as the
            all-caps flip that used to happen here. */}
        {/* The box itself. Drawn in EVERY state, not just when selected: a
            label with no border is invisible as an object, and you cannot
            double-click into something you can't see. It lightens to
            BORDER_IDLE at rest, firms up on hover, and goes accent while
            selected or editing. */}
        <lineSegments position={[0, 0, 0.06]} raycast={() => null}>
          <edgesGeometry args={[borderGeom]} />
          <lineBasicMaterial color={borderColor} />
        </lineSegments>

        {/* Hidden while typing — the input below stands in for it, so the words
            don't render twice on top of each other. */}
        {!editing && (
          <Text
            position={[0, 0, 0.05]}
            raycast={() => null}
            font={ROOM_FONT_3D}
            fontSize={item.fontSize}
            color={ROOM.ink}
            anchorX="center"
            anchorY="middle"
            maxWidth={scaledWallWidth}
          >
            {item.text || ' '}
          </Text>
        )}

        {/* Type IN the box. `transform` puts the input on the wall plane in
            scene space instead of pasting it flat over the canvas, so it sits
            exactly where the 3D type was and grows and shrinks with the room as
            you zoom. scale converts CSS px to scene inches: styled at
            EDIT_FONT_PX and scaled by fontSize/EDIT_FONT_PX × the px-per-unit
            factor, the input's em box measures item.fontSize inches — the same
            size troika was drawing. */}
        {editing && (
          <Html
            transform
            position={[0, 0, 0.09]}
            center
            scale={(item.fontSize / EDIT_FONT_PX) * HTML_TRANSFORM_PX_PER_UNIT}
            style={{ pointerEvents: 'auto' }}
            zIndexRange={[100, 0]}
          >
            <div onDoubleClick={consumeDoubleClick} onPointerDown={(e) => e.stopPropagation()}>
              <input
                value={item.text}
                autoFocus
                maxLength={200}
                placeholder="Text"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => onTextChange?.(item.id, e.target.value)}
                // stopPropagation so the room's own key handling (escape out of
                // edit mode, arrow-key nudges) doesn't fire on every keystroke.
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                }}
                onBlur={() => setEditing(false)}
                style={{
                  width: `${Math.max(6, item.text.length + 2)}ch`,
                  textAlign: 'center',
                  padding: 0,
                  margin: 0,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: ROOM.ink,
                  fontFamily: 'Onest, Inter, system-ui, sans-serif',
                  fontSize: EDIT_FONT_PX,
                  lineHeight: 1.15,
                }}
              />
            </div>
          </Html>
        )}

        {/* Size and Remove, anchored to the label. Not a text field any more —
            the text is typed in the box itself on double-click — and not the
            panel at the far left of the screen this replaced. Same <Html>
            overlay pattern as DraggableBoard's "Reset to true scale" chip,
            including the double-click guard on the wrapper: drei's inner div
            owns the hit area and runs in its own React root, so a synthetic
            stop here would not reach the native event that opens wall edit
            mode. */}
        {showControls && (
          <Html
            position={[0, hitHeight / 2 + 3, 0.1]}
            center
            distanceFactor={10}
            style={{ pointerEvents: 'auto' }}
          >
            <div
              onDoubleClick={consumeDoubleClick}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: 6,
                borderRadius: 10,
                background: '#ffffff',
                border: '1px solid rgba(22,24,29,0.12)',
                boxShadow: '0 8px 24px rgba(22,24,29,0.18)',
                fontFamily: 'Onest, Inter, system-ui, sans-serif',
                whiteSpace: 'nowrap',
              }}
            >
              <button
                type="button"
                onClick={() => stepFontSize(-2)}
                aria-label="Decrease font size"
                style={STEP_BUTTON_STYLE}
              >
                −
              </button>
              <span style={{ width: 30, textAlign: 'center', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(item.fontSize)}
              </span>
              <button
                type="button"
                onClick={() => stepFontSize(2)}
                aria-label="Increase font size"
                style={STEP_BUTTON_STYLE}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => { onSelect(item.id); setEditing(true) }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(22,24,29,0.18)',
                  background: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onRemove?.(item.id)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(194,69,45,0.3)',
                  background: 'rgba(194,69,45,0.08)',
                  color: '#C2452D',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          </Html>
        )}
      </group>
    </group>
  )
}
