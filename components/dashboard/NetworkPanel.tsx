'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import GridPreview from '@/components/ui/GridPreview'
import BubbleNetwork, { type BubbleNode } from '@/components/network/BubbleNetwork'
import NetworkBandPreview from './NetworkBandPreview'

/** Tall enough for the bubbles to have somewhere to be shoved to. */
const PANEL_HEIGHT = 313

/**
 * How many of the archive's studios the preview shows.
 *
 * The network has ~142. All of them at this size is a grey mass, and an
 * arbitrary slice of them is worse than a diagram — it looks like the whole
 * archive is twelve things. So the twelve BIGGEST, which is a crop that means
 * something: these are the studios with the most work in them, and the panel is
 * honest about being a top-of-the-pile view of a bigger place.
 */
const PREVIEW_COUNT = 12

/**
 * The archive, as a window rather than a button.
 *
 * This replaces the full-width "Enter Network" band. The band had to be a band
 * because it ran across the top of a grid of studio cards; with the studios in
 * the sidebar, the archive gets a panel with room to actually be a picture of
 * itself.
 *
 * The bubbles are the REAL ones — the same graph /explore draws, from the same
 * endpoint, so hovering one names a studio that exists and the preview is a
 * small view of the archive rather than an illustration suggesting one. That was
 * tried once before at 190px and pulled back out because the labels could not be
 * read at that height; this panel is nearly twice as tall and shows a twelfth as
 * many nodes, which is what makes it legible now.
 *
 * The decorative diagram is still here as the fallback. A dashboard whose
 * archive panel is blank because a fetch failed is worse than one showing a
 * drawing of a network, and the panel still opens the real thing either way.
 */
export default function NetworkPanel({
  href,
  label,
}: {
  href: string
  /** "Enter the archives" for an org, "Enter the network" otherwise. */
  label: string
}) {
  const [nodes, setNodes] = useState<BubbleNode[] | null>(null)
  /**
   * Whether the archive has answered yet.
   *
   * Separate from `nodes` so the panel can tell "still asking" from "asked and
   * got nothing". It used to conflate them, and the decorative diagram — meant
   * as the fallback for a FAILED fetch — was therefore what every load painted
   * first, for as long as the request took, with the real graph swapping in on
   * top of it. The panel visibly changed its mind every time the dashboard
   * opened. Nothing is drawn over the ruling until the answer is in.
   */
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    /**
     * No `org` parameter, deliberately.
     *
     * /explore forwards one, but it is a SUPERADMIN OVERRIDE that takes an
     * organization ID and replaces the institution filter wholesale. Passing a
     * slug there — which is what the dashboard has — sets the filter to a value
     * no row matches, so a superadmin got an empty archive and this panel fell
     * back to its decorative diagram. Left off, the endpoint scopes to the
     * caller's own organization, which is exactly what a dashboard wants.
     */
    fetch('/api/explore/studios', { cache: 'no-store', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('studios'))))
      .then((data: { studios?: BubbleNode[] }) => {
        const studios = data.studios ?? []
        // Biggest first — see PREVIEW_COUNT. sectionCount is what a studio
        // BUCKET carries; memberCount is what a real workspace carries, and the
        // top level of the archive is buckets.
        const ranked = [...studios].sort(
          (a, b) =>
            (b.sectionCount ?? b.memberCount ?? 0) - (a.sectionCount ?? a.memberCount ?? 0)
        )
        setNodes(ranked.slice(0, PREVIEW_COUNT))
        setResolved(true)
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return
        // Leaves `nodes` null, which IS the diagram fallback below — but only
        // now that the request has actually finished.
        setNodes(null)
        setResolved(true)
      })

    return () => controller.abort()
  }, [])

  const hasRealBubbles = nodes !== null && nodes.length > 0

  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-2xl border border-[#16181D]/[0.08] bg-[#F0F2F7] transition-shadow duration-200 hover:shadow-[0_16px_40px_rgba(22,24,29,0.10)]"
      style={{ height: PANEL_HEIGHT }}
    >
      {/* The ruling under everything. BubbleNetwork draws its own grid, which is
          why it is mounted `transparent` — two rulings at different pitches
          crossing each other reads as a moiré, not as paper. */}
      <GridPreview className="absolute inset-0 h-full w-full" />

      {hasRealBubbles ? (
        /**
         * Held back, and brought forward on hover.
         *
         * At full strength the real graph is a page's worth of labelled,
         * saturated bubbles inside a 360px box — it competes with the card
         * beside it and buries the one button on it. Faded, it reads as what it
         * is: a look through a window at the archive. Hovering is the moment
         * you actually want to read a name off it, so that is when it comes up
         * — which also means the graph's own tooltip is never faint.
         */
        <div className="absolute inset-0 opacity-50 transition-opacity duration-300 ease-out group-hover:opacity-95 motion-reduce:transition-none">
          {/* No onNodeClick: a bubble that swallowed the click would eat the
              gesture meant for the panel. Hover still names the studio, which
              is the whole point of showing the real graph. interactive={false}
              also drops the zoom buttons and the legend — chrome for a page,
              not for a preview. */}
          <BubbleNetwork
            nodes={nodes}
            interactive={false}
            transparent
            minHeight={PANEL_HEIGHT}
          />
        </div>
      ) : resolved ? (
        <div className="absolute inset-0">
          <NetworkBandPreview height={PANEL_HEIGHT} tone="accent" />
        </div>
      ) : null}

      {/* Top-left, over the drawing. Not centred: centring it would put the
          one opaque object in the panel exactly where the bubbles gather. */}
      <span className="pointer-events-none absolute left-5 top-5 z-10 inline-flex items-center gap-2 rounded-full bg-[#16181D] px-5 py-3 text-[14px] font-bold text-white shadow-[0_8px_24px_rgba(22,24,29,0.25)] transition-transform duration-200 group-hover:translate-x-0.5">
        {label}
        <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  )
}
