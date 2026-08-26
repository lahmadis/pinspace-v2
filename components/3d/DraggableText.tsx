'use client'

/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect -- Frozen R3F drag semantics synchronize local geometry and the renderer cursor imperatively. */

import { useRef, useState, useEffect } from 'react'
import { useThree, ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { Text } from '@react-three/drei'
import type { WallTextItem } from '@/lib/wallLayout'
import { ROOM_FONT_3D } from '@/lib/room/palette'
import { consumeDoubleClick } from '@/lib/room/consumeDoubleClick'
import { useDisposableGeometry } from './useDisposableGeometry'
import { ENGINE_PALETTE } from './enginePalette'

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
}: DraggableTextProps) {
  const { camera, gl, raycaster } = useThree()

  const SCALE = 12 // 1 ft = 12 inches; scene unit = 1 inch
  const scaledWallWidth = wallDimensions.width * SCALE
  const scaledWallHeight = wallDimensions.height * SCALE
  const isBackSide = side === 'back'
  const renderXSign = isBackSide ? -1 : 1

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

  // Approximate bounds for the invisible grab target + selection outline.
  // Sized from fontSize + text length (not position) so it doesn't churn while
  // dragging. A generous width keeps the whole label grabbable.
  const hitWidth = Math.max(item.fontSize * 2, item.text.length * item.fontSize * 0.62)
  const hitHeight = item.fontSize * 1.6
  const outlineGeom = useDisposableGeometry(
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
          onDoubleClick={consumeDoubleClick}
          onPointerOver={(e) => {
            e.stopPropagation()
            gl.domElement.style.cursor = 'grab'
          }}
          onPointerOut={(e) => {
            e.stopPropagation()
            if (!isDragging) gl.domElement.style.cursor = 'default'
          }}
        >
          <planeGeometry args={[hitWidth, hitHeight]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>

        <Text
          position={[0, 0, 0.05]}
          raycast={() => null}
          font={ROOM_FONT_3D}
          fontSize={item.fontSize}
          color={ENGINE_PALETTE.darkText}
          anchorX="center"
          anchorY="middle"
          maxWidth={scaledWallWidth}
        >
          {item.text || ' '}
        </Text>

        {isSelected && (
          <lineSegments position={[0, 0, 0.06]} raycast={() => null}>
            <edgesGeometry args={[outlineGeom]} />
            <lineBasicMaterial color={ENGINE_PALETTE.selection} />
          </lineSegments>
        )}
      </group>
    </group>
  )
}
