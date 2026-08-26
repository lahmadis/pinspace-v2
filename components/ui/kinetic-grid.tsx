'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The landing page's grid ruling, made cursor-reactive: it pinches toward the
 * pointer and rings outward from a click.
 *
 * Canvas rather than the CSS `linear-gradient` background this replaces, and
 * rather than SVG: the effect needs every grid vertex to move independently
 * each frame, which a background image cannot do at all and which ~800 SVG
 * nodes would do badly.
 *
 * Light by design — this is the same near-white ruling on the same paper wash
 * the page already had. The reference implementation is white-on-black; only
 * the behaviour is borrowed.
 */

/** Matches the 55px cell of the CSS grid this replaces. */
const CELL = 55

/** The ruling at rest, and its slightly firmer value inside the warp. */
const LINE_REST = 'rgba(0, 0, 0, 0.11)'
const LINE_NEAR = 'rgba(0, 0, 0, 0.3)'

/**
 * Pointer warp. Vertices inside RADIUS are pulled toward the cursor, hardest at
 * the centre and easing to nothing at the rim.
 *
 * Tuned UP from a first pass that was invisible in practice. The reference this
 * copies is white-on-near-black, where a 15px pull on a 55px cell reads clearly;
 * the same numbers over this page's paper wash, on lines at ~10% black, did not
 * register as an effect at all. Peak displacement is now a little over half a
 * cell, which is the point at which the grid visibly bends rather than shimmers.
 */
const WARP_RADIUS = 240
const WARP_STRENGTH = 46
/**
 * Never let a vertex travel more than this fraction of its distance to the
 * cursor. Without the clamp, vertices closer than WARP_STRENGTH overshoot
 * through the centre and the grid knots.
 */
const WARP_MAX_TRAVEL = 0.82

/**
 * The warp centre chases the real pointer instead of being pinned to it, and
 * its strength fades in and out rather than switching. Tying a visual directly
 * to raw pointer position reads as mechanical; a little lag gives it weight.
 * Per-frame lerp factors, normalised to 60fps below so the feel holds on a
 * 120Hz display.
 */
const POINTER_EASE = 0.16
const STRENGTH_EASE = 0.2

/** Click ripple: an expanding ring that shoves vertices radially outward. */
const RIPPLE_SPEED = 620 // px per second
const RIPPLE_WIDTH = 110 // how thick the displaced band is
const RIPPLE_STRENGTH = 40
const RIPPLE_LIFETIME = 1100 // ms
/** Oldest ripples are dropped past this, so a mashed pointer can't pile up. */
const MAX_RIPPLES = 6

/** Below this the warp is invisible and the render loop can stop. */
const SETTLE_EPSILON = 0.004

type Ripple = { x: number; y: number; born: number }

interface KineticGridProps {
  /**
   * Optional content rendered above the grid. Omit it and this is purely a
   * background layer — which is how the landing page uses it, since the grid
   * has to sit under the page's own ambient glows rather than wrap them.
   */
  children?: ReactNode
  className?: string
}

export default function KineticGrid({ children, className = '' }: KineticGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Viewport dimensions in CSS px, refreshed on resize.
    let width = 0
    let height = 0
    /** Column/row counts, plus one of margin so warped edges never pop in. */
    let cols = 0
    let rows = 0
    /** Displaced vertex coordinates, flat [x0, y0, x1, y1, …] to avoid churn. */
    let points = new Float32Array(0)

    // Where the pointer actually is, and where the warp currently believes it
    // is. They converge; the gap is what gives the warp its lag.
    let targetX = -9999
    let targetY = -9999
    let warpX = -9999
    let warpY = -9999
    let targetStrength = 0
    let strength = 0

    let ripples: Ripple[] = []
    let scrollOffset = 0
    let rafId = 0
    let running = false
    let dirty = true

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
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

    /**
     * Recompute every vertex for this frame: lay out the rest grid, then apply
     * the pointer warp and each live ripple. One pass, cached into `points`, so
     * the two stroke passes below are pure reads.
     */
    const layout = (now: number) => {
      // The grid scrolls with the page even though the canvas is viewport-fixed
      // — without this it would read as a decal stuck to the screen.
      const originY = -CELL + (-scrollOffset % CELL)
      const originX = -CELL

      const warpActive = strength > SETTLE_EPSILON
      let i = 0
      for (let r = 0; r < rows; r++) {
        const baseY = originY + r * CELL
        for (let c = 0; c < cols; c++) {
          let x = originX + c * CELL
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

          for (let k = 0; k < ripples.length; k++) {
            const ripple = ripples[k]
            const age = now - ripple.born
            const decay = 1 - age / RIPPLE_LIFETIME
            if (decay <= 0) continue
            const dx = x - ripple.x
            const dy = y - ripple.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 0.001) continue
            const band = Math.abs(dist - (age / 1000) * RIPPLE_SPEED)
            if (band > RIPPLE_WIDTH) continue
            const push = RIPPLE_STRENGTH * (1 - band / RIPPLE_WIDTH) * decay * decay
            x += (dx / dist) * push
            y += (dy / dist) * push
          }

          points[i++] = x
          points[i++] = y
        }
      }
    }

    /**
     * Two strokes, not one per segment. The whole grid goes down at the resting
     * value in a single path; the segments inside the warp are then restroked a
     * little firmer, so the cursor has presence without the lines changing hue.
     * Per-segment alpha would mean ~1500 separate stroke calls a frame.
     */
    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      ctx.lineWidth = 1

      const idx = (c: number, r: number) => (r * cols + c) * 2

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
      ctx.strokeStyle = LINE_REST
      ctx.stroke()

      if (strength <= SETTLE_EPSILON) return

      // Restrike only what's under the cursor. Bounds come from the rest grid,
      // widened by one cell so a vertex warped inward is still included.
      const originY = -CELL + (-scrollOffset % CELL)
      const reach = WARP_RADIUS + CELL
      const c0 = Math.max(0, Math.floor((warpX + CELL - reach) / CELL))
      const c1 = Math.min(cols - 1, Math.ceil((warpX + CELL + reach) / CELL))
      const r0 = Math.max(0, Math.floor((warpY - originY - reach) / CELL))
      const r1 = Math.min(rows - 1, Math.ceil((warpY - originY + reach) / CELL))

      ctx.beginPath()
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const p = idx(c, r)
          if (c === c0) ctx.moveTo(points[p], points[p + 1])
          else ctx.lineTo(points[p], points[p + 1])
        }
      }
      for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) {
          const p = idx(c, r)
          if (r === r0) ctx.moveTo(points[p], points[p + 1])
          else ctx.lineTo(points[p], points[p + 1])
        }
      }
      ctx.strokeStyle = LINE_NEAR
      ctx.stroke()
    }

    let lastFrame = 0
    const frame = (now: number) => {
      // Lerp factors are authored per 60fps frame; scale them by the real delta
      // so the warp settles at the same rate on a 120Hz display. Clamped so a
      // backgrounded tab returning after seconds doesn't jump.
      const delta = lastFrame ? Math.min((now - lastFrame) / 16.667, 3) : 1
      lastFrame = now

      warpX += (targetX - warpX) * Math.min(1, POINTER_EASE * delta)
      warpY += (targetY - warpY) * Math.min(1, POINTER_EASE * delta)
      strength += (targetStrength - strength) * Math.min(1, STRENGTH_EASE * delta)

      if (ripples.length > 0) {
        ripples = ripples.filter((r) => now - r.born < RIPPLE_LIFETIME)
      }

      layout(now)
      draw()

      const settled =
        ripples.length === 0 &&
        Math.abs(targetStrength - strength) < SETTLE_EPSILON &&
        (strength < SETTLE_EPSILON || Math.hypot(targetX - warpX, targetY - warpY) < 0.5)

      if (settled && !dirty) {
        running = false
        lastFrame = 0
        return
      }
      dirty = false
      rafId = requestAnimationFrame(frame)
    }

    const start = () => {
      if (running) return
      running = true
      lastFrame = 0
      rafId = requestAnimationFrame(frame)
    }

    const onPointerMove = (e: PointerEvent) => {
      // First sighting: drop the warp centre straight onto the pointer instead
      // of easing it in from off-screen, which would drag a visible dent across
      // the page.
      if (targetStrength === 0) {
        warpX = e.clientX
        warpY = e.clientY
      }
      targetX = e.clientX
      targetY = e.clientY
      targetStrength = 1
      start()
    }

    const onPointerLeave = () => {
      targetStrength = 0
      start()
    }

    /**
     * Pointer left the window. The leave event on document is unreliable for
     * this; a `pointerout` whose relatedTarget is null means the pointer went
     * somewhere that isn't the document at all, which is exactly the case.
     */
    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) onPointerLeave()
    }

    const onPointerDown = (e: PointerEvent) => {
      ripples.push({ x: e.clientX, y: e.clientY, born: performance.now() })
      if (ripples.length > MAX_RIPPLES) ripples = ripples.slice(-MAX_RIPPLES)
      targetX = e.clientX
      targetY = e.clientY
      targetStrength = 1
      start()
    }

    const onScroll = () => {
      scrollOffset = window.scrollY
      dirty = true
      start()
    }

    const onResize = () => {
      resize()
      start()
    }

    scrollOffset = window.scrollY
    resize()

    if (reduceMotion) {
      // A full-viewport background that warps under the cursor is exactly the
      // motion this setting exists to refuse. The ruling still draws — and
      // still follows the scroll, which is the page's own movement rather than
      // motion this component invented — but nothing reacts to the pointer.
      const redraw = () => {
        layout(performance.now())
        draw()
      }
      const onStaticScroll = () => {
        scrollOffset = window.scrollY
        redraw()
      }
      const onStaticResize = () => {
        resize()
        redraw()
      }
      redraw()
      window.addEventListener('scroll', onStaticScroll, { passive: true })
      window.addEventListener('resize', onStaticResize)
      return () => {
        window.removeEventListener('scroll', onStaticScroll)
        window.removeEventListener('resize', onStaticResize)
      }
    }

    // Listeners live on the window, never the canvas: the canvas is
    // pointer-events-none so it can't swallow a click on the nav or the FAQ,
    // which means it also can't hear one. Window still hears everything.
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('pointerout', onPointerOut, { passive: true })
    window.addEventListener('blur', onPointerLeave)

    start()

    return () => {
      cancelAnimationFrame(rafId)
      running = false
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointerout', onPointerOut)
      window.removeEventListener('blur', onPointerLeave)
    }
  }, [])

  const canvas = (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-0 h-full w-full pointer-events-none"
    />
  )

  if (!children) return canvas

  return (
    <div className={`relative ${className}`}>
      {canvas}
      <div className="relative z-10">{children}</div>
    </div>
  )
}
