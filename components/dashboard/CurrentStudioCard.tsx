'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { instructorLastName } from '@/lib/sections'
import { metaLine, withInstitution, type DashboardWorkspace } from './dashboardScope'

/** How many roster rows are listed before the rest collapse into a count. */
const ROSTER_VISIBLE = 8

interface RosterStudent {
  id: string
  name: string
  initials: string
  boardCount: number
}

interface RosterResponse {
  students: RosterStudent[]
  total: number
  pinned: number
}

/**
 * The section you are actually in, and who has work up in it.
 *
 * The dashboard used to be a grid of every studio you belong to, which answered
 * "what do I have" — a question you can answer from the sidebar list at a
 * glance. This card answers the one you came for: the crit is this week, in
 * THIS section, and six of eighteen people have pinned anything.
 *
 * "Current" is the most recently touched live section, not a thing you pick.
 * Making it selectable would mean a second selected-state on a sidebar row that
 * is already a link to the studio itself, and the overwhelmingly common case is
 * one live section per term anyway.
 */
export default function CurrentStudioCard({
  workspace,
  institutionSlug,
}: {
  workspace: DashboardWorkspace
  institutionSlug: string | null
}) {
  const [roster, setRoster] = useState<RosterResponse | null>(null)
  const [rosterFailed, setRosterFailed] = useState(false)

  const workspaceId = workspace.id
  useEffect(() => {
    // Reset per workspace, or switching scopes shows the previous section's
    // roster under the new section's name until the fetch lands.
    setRoster(null)
    setRosterFailed(false)
    const controller = new AbortController()
    fetch(`/api/workspaces/${workspaceId}/roster`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('roster'))))
      .then((data: RosterResponse) => setRoster(data))
      .catch((err: Error) => {
        if (err.name === 'AbortError') return
        // The card is still worth showing without it — the roster is the
        // richest part of it, not the whole of it.
        setRosterFailed(true)
      })
    return () => controller.abort()
  }, [workspaceId])

  const href = withInstitution(`/workspace/${workspace.id}`, institutionSlug)

  /**
   * The studio this section is of, WITH the instructor's surname — "Studio 04 -
   * Tavares".
   *
   * The studio alone was ambiguous in exactly the case this card exists for: a
   * department runs eight sections of Studio 04, and a heading reading "Studio
   * 04" names the course, not the room you are standing in. The surname is what
   * tells them apart, which is why a section's own generated name is built from
   * the same two parts (lib/sections).
   *
   * The name is BUILT here rather than read off workspace.name, so the heading
   * leads with the studio; the stored name leads with "Section 03". Same two
   * facts, ordered for a card whose job is "which class is this".
   *
   * The fallback path is untouched and must stay that way: sections created
   * before the new-section dialog have no network_metadata.studio, and their
   * workspace.name ALREADY ends in the surname — appending it there would
   * render "Section 03 - Lahmadi - Lahmadi".
   */
  const studioName = workspace.network_metadata?.studio
  const surname = workspace.instructor ? instructorLastName(workspace.instructor) : ''
  const studioLabel = studioName
    ? surname
      ? `${studioName} - ${surname}`
      : studioName
    : workspace.name || 'Untitled'

  // The instructor is out of the meta line: it is in the heading now, and
  // naming them twice, three lines apart, is what the heading change fixed.
  const meta = metaLine([
    (workspace.room_count ?? 0) > 0
      ? `${workspace.room_count} room${workspace.room_count === 1 ? '' : 's'}`
      : null,
    `${workspace.board_count ?? 0} board${(workspace.board_count ?? 0) === 1 ? '' : 's'}`,
  ])

  const visible = roster?.students.slice(0, ROSTER_VISIBLE) ?? []
  const overflow = Math.max(0, (roster?.total ?? 0) - visible.length)

  /*
   * flex-1: the card fills the column, which stretches to the row — so its
   * bottom edge lands on the bottom of the pin shelf across the page rather
   * than floating halfway up beside it.
   */
  return (
    <div className="flex flex-1 flex-col rounded-2xl border border-[#16181D]/[0.08] bg-white p-4">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A8FA0]">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#2FA96B]" />
        {/* "Current studio" on the class tab too, where a workspace is a
            SECTION everywhere else in the product.

            The heading below now names the section in full — "Studio 04 -
            Tavares" — so this eyebrow is the one place still calling it a
            studio, and the button at the bottom says Section. Left as-is
            deliberately: it labels the CARD, and "Current studio" is what a
            person calls the class they are teaching this term. */}
        Current studio
      </p>

      <Link href={href} className="mt-1.5 block">
        <h2 className="truncate text-[28px] font-extrabold tracking-[-0.03em] text-[#16181D] transition-colors hover:text-[#3B6EF6]">
          {studioLabel}
        </h2>
      </Link>
      {meta && <p className="mt-0.5 truncate text-[12px] text-[#8A8FA0]">{meta}</p>}

      {/* The roster. Absent entirely on a section with nobody in it — an empty
          scroller under a "ROSTER · 0" heading is a control describing its own
          emptiness, and a personal studio has no roster to speak of at all. */}
      {roster && roster.total > 0 && (
        <>
          <div className="mt-3.5 flex items-baseline justify-between gap-2 border-b border-[#16181D]/[0.08] pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A8FA0]">
              Roster · {roster.total}
            </span>
            <span className="shrink-0 text-[11px] text-[#8A8FA0]">
              {roster.pinned} of {roster.total} pinned
            </span>
          </div>

          {/* Takes the height the card has spare, and scrolls past it. The
              card's own height is now set by the row, so "as much as is left"
              is a real number here — it was not when the card sized itself to
              its contents, which is why this used to be a fixed 248px. */}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((student) => {
              const hasWork = student.boardCount > 0
              return (
                <li
                  key={student.id}
                  className="flex items-center gap-2.5 border-b border-[#16181D]/[0.05] py-2 last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    // Filled for people with work up, faint for people without:
                    // the tally in the header is the number, and this is the
                    // same fact said down the list so you can find the names.
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ${
                      hasWork ? 'bg-[#16181D] text-white' : 'bg-[#16181D]/[0.06] text-[#A8ADBA]'
                    }`}
                  >
                    {student.initials}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${
                      hasWork ? 'text-[#16181D]' : 'text-[#8A8FA0]'
                    }`}
                  >
                    {student.name}
                  </span>
                  <span
                    className={`shrink-0 text-[11px] ${
                      hasWork ? 'font-semibold text-[#5A5E6B]' : 'text-[#A8ADBA]'
                    }`}
                  >
                    {hasWork
                      ? `${student.boardCount} board${student.boardCount === 1 ? '' : 's'}`
                      : 'not yet'}
                  </span>
                </li>
              )
            })}
          </ul>

          {overflow > 0 && (
            <div className="flex items-center justify-between gap-2 pt-2 text-[11px]">
              <span className="text-[#8A8FA0]">
                {overflow} more student{overflow === 1 ? '' : 's'}
              </span>
              {/* The section page is the roster in full — this card is a
                  summary of it, so "See roster" goes there rather than growing
                  a second list of the same people. */}
              <Link href={href} className="shrink-0 font-semibold text-[#3B6EF6] hover:underline">
                See roster
              </Link>
            </div>
          )}
        </>
      )}

      {rosterFailed && (
        <p className="mt-3 text-[11px] text-[#8A8FA0]">Couldn&rsquo;t load the roster.</p>
      )}

      {/* mt-auto on the WRAPPER, not the button: auto margin wins over any
          top margin, so putting it on the link itself would drop the gap above
          it whenever the card had no spare height to push into. */}
      <div className="mt-auto pt-3.5">
      <Link
        href={href}
        className="flex items-center justify-center gap-2 rounded-full bg-[#16181D] px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[#3B6EF6]"
      >
        Enter Your Section
        <ArrowRight className="h-4 w-4" />
      </Link>
      </div>
    </div>
  )
}
