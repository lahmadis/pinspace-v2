'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import LightboxModal from '@/components/LightboxModal'
import type { Board } from '@/types'

/**
 * How many pins the shelf itself shows.
 *
 * The shelf is ONE ROW, always. It used to wrap, so a person with thirteen pins
 * got three rows of them and the archive panel above was pushed off the top of
 * the dashboard — the shelf stopped being a shelf and became the page. Past
 * five, the row ends and "See all" opens the rest.
 */
const SHELF_LIMIT = 5

/** Empty outlines drawn beside the plus while the shelf is filling up. */
const SLOT_TARGET = 3

interface Pin {
  boardId: string
  title: string
  thumbnailUrl: string | null
  fullImageUrl: string | null
  roomId: string | null
  workspaceId: string | null
  author: string | null
}

/**
 * Pinspaces — the sheets you kept.
 *
 * A favourites shelf, in the sense Pinterest means it. The network is
 * organised by department, semester and year, which is the right way to FIND
 * something and a bad way to return to it: a week later the only route back to
 * the drawing you liked is remembering whose it was. Pinning keeps it here.
 *
 * A pinned tile opens the SAME lightbox the 3D room and the 2D grid open — not
 * a dashboard-local preview — so a kept sheet is looked at the way every other
 * sheet in the product is looked at, at full size with its zoom and its pan.
 * The one thing that differs is a button back to the space it lives in, because
 * this is the only surface where a board appears with no room around it.
 *
 * The empty slots are drawn rather than hidden. A shelf with nothing on it and
 * no shelf visible is indistinguishable from a feature that does not exist, and
 * the outlines are what make the first pin read as filling something in.
 */
export default function PinspacesRow({ archiveHref }: { archiveHref: string }) {
  const [pins, setPins] = useState<Pin[]>([])
  const [openPin, setOpenPin] = useState<Pin | null>(null)
  /** The full grid, when the row is not enough. */
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pinspaces', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setPins(Array.isArray(data?.pins) ? data.pins : [])
    } catch {
      // A shelf that fails to load stays an empty shelf. There is nothing
      // actionable to say about it, and the way to the archive still works.
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const unpin = useCallback(async (boardId: string) => {
    // Optimistic: the tile is the only feedback, and waiting a round trip to
    // remove something you just pressed remove on reads as a dead button.
    setPins((prev) => prev.filter((p) => p.boardId !== boardId))
    setOpenPin((prev) => (prev?.boardId === boardId ? null : prev))
    try {
      await fetch(`/api/pinspaces?boardId=${encodeURIComponent(boardId)}`, { method: 'DELETE' })
    } catch {
      void load()
    }
  }, [load])

  /**
   * A pin, as the lightbox wants it.
   *
   * The endpoint returns only what a tile needs; Board is a much wider type.
   * Cast at this one boundary rather than widening the response — every other
   * field the lightbox reads is optional, and inventing values for them would
   * put fake sizes and fake owners on a real sheet.
   */
  const asBoard = (pin: Pin): Board => ({
    id: pin.boardId,
    studioId: pin.workspaceId ?? '',
    workspaceId: pin.workspaceId ?? undefined,
    roomId: pin.roomId ?? undefined,
    studentName: pin.author ?? '',
    title: pin.title,
    thumbnailUrl: pin.thumbnailUrl ?? '',
    fullImageUrl: pin.fullImageUrl ?? '',
    uploadedAt: new Date(),
  })

  const shelf = pins.slice(0, SHELF_LIMIT)
  const overflow = pins.length - shelf.length
  const emptySlots = Math.max(0, SLOT_TARGET - shelf.length)

  /** One pin tile — the same card on the shelf and in the See-all grid. */
  const tile = (pin: Pin) => (
    <div
      key={pin.boardId}
      className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-[#16181D]/[0.10] bg-white"
    >
      <button
        type="button"
        onClick={() => setOpenPin(pin)}
        title={`Open ${pin.title}`}
        className="block h-full w-full"
      >
        {pin.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pin.thumbnailUrl} alt={pin.title} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-[#F0F3F9] px-2 text-[11px] text-[#8A8FA0]">
            {pin.title}
          </span>
        )}
      </button>

      {/* Hover-revealed, but never opacity-0 alone: on a touch screen hover
          never fires, and unpinning would be unreachable. */}
      <button
        type="button"
        onClick={() => void unpin(pin.boardId)}
        title={`Unpin ${pin.title}`}
        aria-label={`Unpin ${pin.title}`}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-[#8A8FA0] opacity-60 transition-all hover:text-[#C2452D] group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )

  return (
    <section aria-labelledby="pinspaces-heading">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2
          id="pinspaces-heading"
          className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A8FA0]"
        >
          Pinspaces
        </h2>
        {/* Only when there is something it would reveal. A permanent "See all"
            over a shelf showing all of them is a control whose whole job is to
            tell you nothing is hidden. */}
        {overflow > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="shrink-0 text-[12px] font-semibold text-[#3B6EF6] hover:underline"
          >
            See all {pins.length}
          </button>
        )}
      </div>

      {/* Seven columns: the plus takes two, five pins take one each. Fixed at
          seven rather than filling, so the row is the same shape whether you
          have one pin or fifty, and the tiles hold a portrait aspect instead of
          stretching into billboards on a wide monitor. */}
      <div className="grid grid-cols-3 gap-3.5 sm:grid-cols-7">
        {/* ONLY WHILE THE SHELF IS EMPTY. It is an onboarding tile, not a
            control: it is a plain link to the network, which the panel directly
            above it already is, and once there are pins it was spending two of
            seven columns restating that link beside the thing it produced.
            After the first pin the way to add another is the same way you added
            the first — the network panel above, or the pin control on any
            board's lightbox. */}
        {pins.length === 0 && (
          <Link
            href={archiveHref}
            className="group col-span-2 flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#3B6EF6]/50 bg-white transition-colors hover:border-[#3B6EF6] hover:bg-[#3B6EF6]/[0.04]"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5A81C] text-[#16181D] transition-transform duration-200 group-hover:scale-105"
            >
              <Plus className="h-4 w-4" strokeWidth={3} />
            </span>
            {/* THE NETWORK, not the archive. archiveHref resolves to /explore
                on the org tab and /network on the personal one — both of them
                the network. "Archive" named a different page (/archive) that
                this link has never pointed at. */}
            <span className="text-[13px] font-bold text-[#16181D]">Pin from the Network</span>
          </Link>
        )}

        {shelf.map(tile)}

        {/* aria-hidden: the shape of the shelf, not empty things to announce. */}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className="aspect-[3/4] rounded-2xl border border-[#16181D]/[0.10] bg-white/50"
          />
        ))}
      </div>

      <p className="mt-2 text-[12px] text-[#3B6EF6]">
        {pins.length === 0
          ? 'Pin work from the network and it will show up here.'
          : 'Open a pin to look at it, or to jump to the space it lives in.'}
      </p>

      {/* Every pin, as a grid — the shape the 2D archive uses for a person's
          sheets, because this is the same kind of looking. An overlay rather
          than a route: it is a longer view of what is already on this page, and
          coming back should not be a navigation. */}
      {showAll && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-[#F4F6FA]/95 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="All pinspaces"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4">
            <div>
              <h2 className="text-[19px] font-extrabold tracking-[-0.02em] text-[#16181D]">
                Pinspaces
              </h2>
              <p className="text-[12px] text-[#8A8FA0]">
                {pins.length} pin{pins.length === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAll(false)}
              aria-label="Close"
              className="rounded-full p-2 text-[#8A8FA0] transition-colors hover:bg-[#16181D]/[0.06] hover:text-[#16181D]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-8">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {pins.map(tile)}
            </div>
          </div>
        </div>
      )}

      {/* Suspense: LightboxModal calls useSearchParams, which Next requires a
          boundary above — and that requirement fails only at Vercel BUILD,
          never at tsc, so it is invisible locally. Every other host wraps it. */}
      {openPin && (
        <Suspense fallback={null}>
          <LightboxModal
            board={asBoard(openPin)}
            allBoards={pins.map(asBoard)}
            onClose={() => setOpenPin(null)}
            // The arrows walk YOUR shelf. Nothing else is in scope here — a
            // pinned sheet has no room around it to step through.
            onNavigate={(direction) => {
              const i = pins.findIndex((p) => p.boardId === openPin.boardId)
              if (i < 0) return
              const next = direction === 'next' ? i + 1 : i - 1
              const target = pins[(next + pins.length) % pins.length]
              if (target) setOpenPin(target)
            }}
            // Already yours, so the lightbox's pin control is the way back out.
            isPinned
            onTogglePin={() => void unpin(openPin.boardId)}
            // The whole point of a pinned sheet: the way to where it lives.
            openSpaceHref={openPin.roomId ? `/studio/${openPin.roomId}/view` : undefined}
          />
        </Suspense>
      )}
    </section>
  )
}
