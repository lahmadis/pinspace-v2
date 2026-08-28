'use client'

import { useEffect, useState } from 'react'
import BubbleNetwork, { type BubbleNode } from '@/components/network/BubbleNetwork'

/**
 * A live bubble network, filling the dashboard band behind its own copy.
 *
 * The real component, with the real force simulation and the real hover
 * behaviour — not a drawing of one. The graph is simply cropped by the band, so
 * you see part of the network rather than all of it, and clicking anywhere opens
 * the whole thing.
 *
 * Four things make that work at this size:
 *
 * - `transparent` so it paints no ground and no ruling. Its own #E6ECFC is
 *   opaque, and full-bleed that would cover the band's gradient — the band would
 *   stop being the school's surface and become a small copy of the network page.
 * - `interactive={false}` attaches no d3 zoom, so wheel and drag never bind. A
 *   graph you can pan is a graph that eats the click meant to open it. Hovering
 *   a bubble still works: that is a different gesture, and it is the whole point
 *   of showing a live graph rather than a picture.
 * - Held at low opacity, because the band's job is still to say "The Network"
 *   and be clicked. At full strength the bubbles win against the title.
 * - The simulation runs `alphaDecay(0.1)` and stops itself, so this is a burst
 *   of work on mount, not a loop running while the dashboard is open.
 *
 * Fetches on mount rather than taking nodes from the dashboard: the dashboard
 * holds WORKSPACES (what you belong to), the network holds PUBLISHED STUDIOS
 * across the school. Different sets — previewing the former while linking to the
 * latter would misrepresent what a click gets you.
 */

/** Faint enough that the band's title stays the loudest thing on it. */
const PREVIEW_OPACITY = 0.4

interface NetworkBandPreviewProps {
  /** The band's height, so the simulation centres in the box that exists. */
  height: number
}

export default function NetworkBandPreview({ height }: NetworkBandPreviewProps) {
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let cancelled = false
    // The route derives the institution from the session, so there is nothing
    // to pass here and nothing to get wrong about scope.
    fetch('/api/explore/studios', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        // A handful is a preview; the whole school is a hairball at this size,
        // and every extra node is simulation work for a background.
        setNodes((data.studios ?? []).slice(0, 12))
      })
      .catch(() => {
        // Silent: this is a layer on a band that already works as a link. An
        // error state here would be louder than the thing it reports.
      })
    return () => { cancelled = true }
  }, [])

  // Second tick, deliberately: the fade has to start from 0 in a frame the
  // browser actually painted, or it mounts already-opaque and there is no
  // transition to see. It also lets the simulation take its first steps behind
  // a transparent layer, so the graph eases in already settling rather than
  // visibly springing apart.
  useEffect(() => {
    if (nodes.length === 0) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true))
    })
    // Both ids, not just the outer: once the outer frame has fired, cancelling
    // it is a no-op and the inner one is the only thing still pending.
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [nodes.length])

  if (nodes.length === 0) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-[1400ms] ease-out motion-reduce:transition-none"
      style={{ opacity: shown ? PREVIEW_OPACITY : 0 }}
    >
      {/* pointer-events restored on the graph itself so bubbles stay hoverable,
          while the wrapper lets clicks fall through to the band's link. */}
      <div className="pointer-events-auto h-full w-full">
        <BubbleNetwork
          nodes={nodes}
          minHeight={height}
          interactive={false}
          transparent
        />
      </div>
    </div>
  )
}
