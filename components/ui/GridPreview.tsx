'use client'

import { useEffect, useRef } from 'react'

/**
 * A small cursor-reactive grid, sized to its own box.
 *
 * The same effect as the landing page's KineticGrid, but that one is
 * `fixed inset-0`, measures `window.innerWidth/innerHeight` and listens on
 * `window` — none of which works for something living inside a card. This
 * measures its own element with a ResizeObserver and takes pointer position
 * from the element's rect, so any number of them can sit on a page at once.
 *
 * Deliberately NOT a generalisation of KineticGrid. That component is tuned for
 * a full viewport (55px cells, a 135px warp radius, a click ripple) and is
 * working; parameterising it for a 240x165 box would mean every constant in it
 * becoming a prop, on a surface where a regression is a broken landing page.
 */

/** Smaller than the landing page's 55px: a card box is ~240px wide, and a
 *  55px cell would give it four columns, which reads as a table, not a grid. */
const CELL = 22

const LINE = 'rgba(22, 24, 29, 0.10)'
const LINE_NEAR = '59, 110, 246'

/** Scaled down from the landing grid in proportion to the cell. */
const WARP_RADIUS = 62
const WARP_STRENGTH = 11
const HIGHLIGHT_RADIUS = 55
/** Never let a vertex cross the cursor — see KineticGrid's own note. */
const WARP_MAX_TRAVEL = 0.82

const POINTER_EASE = 0.18
const STRENGTH_EASE = 0.22
const SETTLE_EPSILON = 0.004

interface GridPreviewProps {
  className?: string
}

export default function GridPreview({ className = '' }: GridPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** Pointer target, written by the React handlers and read by the loop. */
  const pointerRef = useRef({ x: -9999, y: -9999, active: 0 })
  /** Set by the effect so the React handlers can wake the loop. */
  const startRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let cols = 0
    let rows = 0
    let points = new Float32Array(0)

    let warpX = -9999
    let warpY = -9999
    let strength = 0
    let rafId = 0
    let running = false
    let dirty = true

    const resize = () => {
      const rect = host.getBoundingClientRect()
      // A card can be laid out at zero size for a frame (inside a collapsed
      // grid cell, or before fonts settle); drawing then divides by nothing and
      // leaves a blank canvas that never repaints.
      if (rect.width < 1 || rect.height < 1) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      cols = Math.ceil(width / CELL) + 2
      rows = Math.ceil(height / CELL) + 2
      const needed = cols * rows * 2
      if (points.length !== needed) points = new Float32Array(needed)
      dirty = true
    }

    const layout = () => {
      const warpActive = strength > SETTLE_EPSILON
      let i = 0
      for (let r = 0; r < rows; r++) {
        const baseY = -CELL + r * CELL
        for (let c = 0; c < cols; c++) {
          let x = -CELL + c * CELL
          let y = baseY
          if (warpActive) {
            const dx = warpX - x
            const dy = warpY - y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < WARP_RADIUS && dist > 0.001) {
              const t = 1 - dist / WARP_RADIUS
              const pull = Math.min(WARP_STRENGTH * t * t * strength, dist * WARP_MAX_TRAVEL)
              x += (dx / dist) * pull
              y += (dy / dist) * pull
            }
          }
          points[i++] = x
          points[i++] = y
        }
      }
    }

    const idx = (c: number, r: number) => (r * cols + c) * 2

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      ctx.lineWidth = 1

      // Whole grid in one path at the resting value — per-segment alpha over
      // the entire box would be hundreds of stroke calls a frame, per card.
      ctx.beginPath()
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const p = idx(c, r)
          if (c === 0) ctx.moveTo(points[p], points[p + 1])
          else ctx.lineTo(points[p], points[p + 1])
        }
      }
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const p = idx(c, r)
          if (r === 0) ctx.moveTo(points[p], points[p + 1])
          else ctx.lineTo(points[p], points[p + 1])
        }
      }
      ctx.strokeStyle = LINE
      ctx.stroke()

      if (strength <= SETTLE_EPSILON) return

      // Only the block under the cursor is restroked, segment by segment, with
      // a radial alpha falloff — a flat value over a rectangular block paints a
      // visible square, since the effect is round.
      const reach = WARP_RADIUS + CELL
      const c0 = Math.max(0, Math.floor((warpX + CELL - reach) / CELL))
      const c1 = Math.min(cols - 1, Math.ceil((warpX + CELL + reach) / CELL))
      const r0 = Math.max(0, Math.floor((warpY + CELL - reach) / CELL))
      const r1 = Math.min(rows - 1, Math.ceil((warpY + CELL + reach) / CELL))

      const glow = (x: number, y: number) => {
        const d = Math.hypot(warpX - x, warpY - y)
        if (d >= HIGHLIGHT_RADIUS) return 0
        const t = 1 - d / HIGHLIGHT_RADIUS
        return t * t * strength
      }

      const segment = (pa: number, pb: number) => {
        const ax = points[pa]
        const ay = points[pa + 1]
        const bx = points[pb]
        const by = points[pb + 1]
        const a = glow((ax + bx) / 2, (ay + by) / 2)
        if (a <= 0.01) return
        ctx.strokeStyle = `rgba(${LINE_NEAR}, ${a * 0.5})`
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c < c1; c++) segment(idx(c, r), idx(c + 1, r))
      }
      for (let c = c0; c <= c1; c++) {
        for (let r = r0; r < r1; r++) segment(idx(c, r), idx(c, r + 1))
      }
    }

    let lastFrame = 0
    const frame = (now: number) => {
      const delta = lastFrame ? Math.min((now - lastFrame) / 16.667, 3) : 1
      lastFrame = now

      const p = pointerRef.current
      if (p.active && warpX < -9000) {
        // First sighting: land on the pointer instead of easing in from
        // off-canvas, which would drag a dent across the card.
        warpX = p.x
        warpY = p.y
      }
      warpX += (p.x - warpX) * Math.min(1, POINTER_EASE * delta)
      warpY += (p.y - warpY) * Math.min(1, POINTER_EASE * delta)
      strength += (p.active - strength) * Math.min(1, STRENGTH_EASE * delta)

      layout()
      draw()

      const settled =
        Math.abs(p.active - strength) < SETTLE_EPSILON &&
        (strength < SETTLE_EPSILON || Math.hypot(p.x - warpX, p.y - warpY) < 0.5)

      if (settled && !dirty) {
        running = false
        lastFrame = 0
        // Reset so the next hover snaps to the pointer rather than sweeping
        // in from wherever the last one ended.
        if (strength < SETTLE_EPSILON) { warpX = -9999; warpY = -9999 }
        return
      }
      dirty = false
      rafId = requestAnimationFrame(frame)
    }

    const start = () => {
      if (running || reduceMotion) return
      running = true
      lastFrame = 0
      rafId = requestAnimationFrame(frame)
    }
    startRef.current = start

    resize()
    // Draw once so the grid is present before anyone touches it. The loop only
    // runs on hover — a dashboard can hold a dozen of these, and a dozen idle
    // rAF loops is a dozen too many.
    layout()
    draw()

    const observer = new ResizeObserver(() => { resize(); layout(); draw() })
    observer.observe(host)

    return () => {
      cancelAnimationFrame(rafId)
      running = false
      observer.disconnect()
      startRef.current = null
    }
  }, [])

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    pointerRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: 1,
    }
    startRef.current?.()
  }

  const onLeave = () => {
    pointerRef.current.active = 0
    startRef.current?.()
  }

  return (
    // `relative` is not optional and must not be overridden by the caller's
    // className: the canvas below is absolutely placed against this box.
    <div
      ref={hostRef}
      className={`relative ${className}`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {/* ABSOLUTE, not a block with h-full. As a normal-flow child its height
          came from `h-full` of the host, while the host's height came from its
          content — each sizing off the other, which settles at an arbitrary
          height and leaves the rest of the box empty. Taking the canvas out of
          flow means the host is sized purely by whatever the caller gives it.

          pointer-events-none so the card's own link still takes the click; the
          host div above is what listens. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 block h-full w-full"
      />
    </div>
  )
}
