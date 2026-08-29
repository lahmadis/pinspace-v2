'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

/**
 * The bubbles behind the dashboard's network band.
 *
 * A DIAGRAM, not a preview. This used to mount the real <BubbleNetwork> with
 * the real studios fetched from /api/explore/studios — a live, faithful,
 * labelled graph shrunk into a 190px strip. Faithful was the problem: at that
 * size the labels were unreadable, so the band showed real data that could not
 * be read and implied the crop was meaningful when which twelve studios landed
 * in frame was arbitrary. It also spent a network request and a full force
 * simulation on decoration.
 *
 * So: plain grey circles, no text, no data, no fetch. It says "a network lives
 * behind this" and leaves the reading of it to the page the band opens.
 *
 * The one thing it does do is respond. Bubbles shove away from the cursor and
 * bounce back, which is what makes a static-looking band feel like something
 * rather than a printed pattern — and it is honest about being decoration in a
 * way a shrunken real graph was not.
 */

/** Faint enough that the band's title stays the loudest thing on it. */
const PREVIEW_OPACITY = 0.55

/**
 * The layout, as fractions of the band so it holds its composition at any
 * width, plus a radius in px.
 *
 * Hand-placed rather than random: a random scatter clumps and leaves holes at
 * this count, and re-rolls on every mount so the dashboard never looks the
 * same twice. These are also only STARTING points — the simulation spreads
 * them from here, and the cursor pushes them anywhere.
 */
const LAYOUT: ReadonlyArray<{ fx: number; fy: number; r: number }> = [
  { fx: 0.06, fy: 0.30, r: 26 },
  { fx: 0.14, fy: 0.72, r: 16 },
  { fx: 0.23, fy: 0.22, r: 13 },
  { fx: 0.29, fy: 0.58, r: 30 },
  { fx: 0.38, fy: 0.86, r: 12 },
  { fx: 0.42, fy: 0.30, r: 20 },
  { fx: 0.50, fy: 0.64, r: 15 },
  { fx: 0.56, fy: 0.18, r: 24 },
  { fx: 0.63, fy: 0.78, r: 19 },
  { fx: 0.69, fy: 0.40, r: 32 },
  { fx: 0.77, fy: 0.72, r: 14 },
  { fx: 0.82, fy: 0.24, r: 18 },
  { fx: 0.88, fy: 0.60, r: 22 },
  { fx: 0.94, fy: 0.34, r: 12 },
  { fx: 0.97, fy: 0.82, r: 17 },
]

/**
 * Which bubbles are joined by a line.
 *
 * A FIXED edge list, not "join anything closer than N". A distance rule looks
 * right in a still frame and falls apart in motion: shove a bubble with the
 * cursor and edges blink in and out as pairs cross the threshold, which reads
 * as a rendering fault rather than as a network. Fixed pairs stretch and settle
 * instead, and the graph keeps the same shape it was drawn with.
 *
 * A meandering chain with two cross-links, so it reads as a network rather than
 * as a single strand or a full mesh.
 */
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 2], [2, 1], [1, 3], [3, 5], [5, 4], [4, 6], [6, 7],
  [7, 8], [8, 9], [9, 11], [11, 10], [10, 12], [12, 13], [13, 14],
  [3, 6], [9, 12],
]

/** How close the cursor gets before a bubble starts moving, in px. */
const REPEL_RADIUS = 130

/** Shove strength at the cursor's exact position, falling to 0 at the radius. */
const REPEL_STRENGTH = 7

type Bubble = d3.SimulationNodeDatum & {
  r: number
  homeX: number
  homeY: number
}

interface NetworkBandPreviewProps {
  /** The band's height, so the simulation lays out in the box that exists. */
  height: number
  /**
   * Which way to tint the circles.
   *
   * 'dark' for a pale band (grey on light), 'light' for the near-black one
   * (white on dark). A single grey that "works on both" works on neither: it
   * is the same lightness as one of the two grounds.
   */
  tone?: 'dark' | 'light'
}

export default function NetworkBandPreview({ height, tone = 'dark' }: NetworkBandPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const circleRefs = useRef<(SVGCircleElement | null)[]>([])
  const lineRefs = useRef<(SVGLineElement | null)[]>([])
  /** Cursor in local coords, or null when it is not over the band. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const [width, setWidth] = useState(0)
  const [shown, setShown] = useState(false)

  // Width has to be measured — the band is full-bleed and its height is the
  // only dimension the caller knows.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => setWidth(host.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (width === 0) return

    // Movement is the whole of what this adds, so under reduced motion the
    // circles simply sit at their layout positions. Nothing is lost but the
    // response to the cursor.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const nodes: Bubble[] = LAYOUT.map((b) => ({
      r: b.r,
      homeX: b.fx * width,
      homeY: b.fy * height,
      x: b.fx * width,
      y: b.fy * height,
    }))

    const paint = () => {
      nodes.forEach((n, i) => {
        const el = circleRefs.current[i]
        if (!el) return
        el.setAttribute('cx', String(n.x ?? 0))
        el.setAttribute('cy', String(n.y ?? 0))
      })
      // Edges follow the bubbles they join, so a shoved bubble drags its
      // connections with it instead of leaving them behind.
      EDGES.forEach(([a, b], i) => {
        const el = lineRefs.current[i]
        if (!el) return
        el.setAttribute('x1', String(nodes[a]?.x ?? 0))
        el.setAttribute('y1', String(nodes[a]?.y ?? 0))
        el.setAttribute('x2', String(nodes[b]?.x ?? 0))
        el.setAttribute('y2', String(nodes[b]?.y ?? 0))
      })
    }

    paint()
    if (reduced) return

    /**
     * Push every bubble within REPEL_RADIUS directly away from the cursor.
     *
     * Written as velocity rather than position so the collide and homing
     * forces still get their say in the same tick — the bubble is shoved, then
     * settles back and knocks its neighbours on the way. Setting x/y outright
     * would teleport it and kill the bounce that is the point.
     */
    const repel = () => {
      const p = pointerRef.current
      if (!p) return
      for (const n of nodes) {
        const dx = (n.x ?? 0) - p.x
        const dy = (n.y ?? 0) - p.y
        const distSq = dx * dx + dy * dy
        if (distSq > REPEL_RADIUS * REPEL_RADIUS || distSq < 0.01) continue
        const dist = Math.sqrt(distSq)
        const push = (1 - dist / REPEL_RADIUS) * REPEL_STRENGTH
        n.vx = (n.vx ?? 0) + (dx / dist) * push
        n.vy = (n.vy ?? 0) + (dy / dist) * push
      }
    }

    const sim = d3
      .forceSimulation(nodes)
      .force('collide', d3.forceCollide<Bubble>((d) => d.r + 5).strength(0.85))
      // Weak homing: strong enough to reassemble the composition after a shove,
      // weak enough that the shove is visible for a moment first.
      .force('x', d3.forceX<Bubble>((d) => d.homeX).strength(0.035))
      .force('y', d3.forceY<Bubble>((d) => d.homeY).strength(0.05))
      .force('repel', repel)
      // Low velocity decay is the bounce. The d3 default (0.4) is a damper and
      // would have them glide back into place like oil.
      .velocityDecay(0.2)
      .on('tick', paint)

    // Settles and STOPS on its own, so an untouched dashboard runs no loop.
    // Hovering is what revives it, below.
    sim.alpha(0.35).restart()

    const host = hostRef.current
    const onMove = (event: PointerEvent) => {
      const rect = host?.getBoundingClientRect()
      if (!rect) return
      pointerRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      // alphaTarget, not alpha: it holds the simulation awake while the cursor
      // is over the band instead of giving it one decaying kick per event.
      sim.alphaTarget(0.3).restart()
    }
    const onLeave = () => {
      pointerRef.current = null
      // Releasing the target lets alpha decay to zero and the loop end.
      sim.alphaTarget(0)
    }

    host?.addEventListener('pointermove', onMove)
    host?.addEventListener('pointerleave', onLeave)

    return () => {
      host?.removeEventListener('pointermove', onMove)
      host?.removeEventListener('pointerleave', onLeave)
      sim.stop()
    }
  }, [width, height])

  // Second tick, deliberately: the fade has to start from 0 in a frame the
  // browser actually painted, or it mounts already-opaque and there is no
  // transition to see.
  useEffect(() => {
    if (width === 0) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true))
    })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [width])

  const fill = tone === 'light' ? '#FFFFFF' : '#8A8FA0'

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      // pointer-events stay ON so the bubbles can feel the cursor. Clicks are
      // unaffected: this sits inside the band's <Link>, so anything landing
      // here still bubbles up and opens the network.
      className="absolute inset-0 overflow-hidden transition-opacity duration-[1200ms] ease-out motion-reduce:transition-none"
      style={{ opacity: shown ? PREVIEW_OPACITY : 0 }}
    >
      <svg width="100%" height="100%" className="block">
        {/* Lines first, so each bubble sits ON TOP of the ends that meet it
            rather than the other way round. They run to circle CENTRES, not to
            edges — no edge-shortening maths — and the bubbles are drawn at
            fillOpacity 0.5, so the last stub of each line reads faintly through
            the circle instead of being hidden by it. That is the look: lines
            passing behind translucent bubbles, not butting against them. */}
        {EDGES.map(([a, b], i) => (
          <line
            key={`e${i}`}
            ref={(el) => { lineRefs.current[i] = el }}
            x1={(LAYOUT[a]?.fx ?? 0) * (width || 0)}
            y1={(LAYOUT[a]?.fy ?? 0) * height}
            x2={(LAYOUT[b]?.fx ?? 0) * (width || 0)}
            y2={(LAYOUT[b]?.fy ?? 0) * height}
            stroke={fill}
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        ))}
        {LAYOUT.map((b, i) => (
          <circle
            key={i}
            ref={(el) => { circleRefs.current[i] = el }}
            r={b.r}
            cx={b.fx * (width || 0)}
            cy={b.fy * height}
            fill={fill}
            fillOpacity={0.5}
          />
        ))}
      </svg>
    </div>
  )
}
