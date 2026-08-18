'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shortestStep, wrapBay } from '@/lib/room/roomShell'

/**
 * Which way the room is turned.
 *
 * The counter is UNWRAPPED on purpose. Bay 0 reached by turning right from the
 * last bay is `bayCount`, not `0`, so the CSS transition sweeps one step forward
 * instead of unwinding the whole ring. Every jump routes through
 * `shortestStep`, so the room always takes the short way round.
 */
export interface RoomNavigation {
  /** Unwrapped counter; multiply by sliceDeg for the shell's rotateY. */
  facing: number
  /** Real bay index, 0..bayCount-1. */
  bayIndex: number
  /** Turn one bay left (-1) or right (+1). */
  step: (direction: -1 | 1) => void
  /** Turn to a specific bay by the shortest route. */
  goToBay: (index: number) => void
  /** True while the sweep is still running. */
  turning: boolean
  /** False under prefers-reduced-motion. */
  animate: boolean
}

/** Sweep duration; must stay in step with the transition in RoomStage. */
const SWEEP_MS = 760

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}

export function useRoomNavigation(bayCount: number, enabled: boolean = true): RoomNavigation {
  const [facing, setFacing] = useState(0)
  const [turning, setTurning] = useState(false)
  const [animate, setAnimate] = useState(true)
  const facingRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  facingRef.current = facing

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setAnimate(!mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const markTurning = useCallback(() => {
    if (!animate) return
    setTurning(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setTurning(false), SWEEP_MS)
  }, [animate])

  const step = useCallback((direction: -1 | 1) => {
    if (bayCount <= 1) return
    setFacing((f) => f + direction)
    markTurning()
  }, [bayCount, markTurning])

  const goToBay = useCallback((index: number) => {
    if (bayCount <= 0 || index < 0) return
    const current = wrapBay(facingRef.current, bayCount)
    const delta = shortestStep(current, wrapBay(index, bayCount), bayCount)
    if (delta === 0) return
    setFacing((f) => f + delta)
    markTurning()
  }, [bayCount, markTurning])

  // The room stays reachable from the keyboard whenever nothing else owns it:
  // arrows turn, digits jump straight to a bay, Home returns to the first wall.
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); return }
      if (e.key === 'Home') { e.preventDefault(); goToBay(0); return }
      if (e.key >= '1' && e.key <= '9') {
        const target = Number(e.key) - 1
        if (target < bayCount) { e.preventDefault(); goToBay(target) }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, step, goToBay, bayCount])

  const bayIndex = useMemo(() => wrapBay(facing, bayCount), [facing, bayCount])

  return { facing, bayIndex, step, goToBay, turning, animate }
}
