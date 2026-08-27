'use client'

import { ChevronDown } from 'lucide-react'

/**
 * The "there is more below" cue at the foot of the hero.
 *
 * Positioned inside the hero rather than fixed to the viewport, which means it
 * needs no scroll listener to know when it has stopped being true: it leaves
 * the screen at the same moment the section it points at arrives. A fixed cue
 * would have to be told to fade, and would otherwise sit over the FAQ still
 * insisting there is more.
 *
 * `html` already carries `scroll-behavior: smooth` (globals.css), so the anchor
 * glides down the same way the nav's own section tabs do.
 *
 * The motion is in globals.css under `.scroll-cue` / `.scroll-cue-arrow` —
 * CSS rather than the framer-motion the rest of the hero uses, for the reasons
 * written there.
 */
export default function ScrollCue() {
  return (
    // Full-width flex rather than `left-1/2 -translate-x-1/2`, because that
    // centring trick spends the element's transform and the entrance animation
    // needs it. Takes no pointer events itself so this band doesn't sit over
    // the hero swallowing clicks across the full width.
    //
    // Hidden on short viewports: the hero centres its content and this is
    // absolutely positioned, so on a landscape phone the two would overlap.
    <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center [@media(max-height:640px)]:hidden">
      <a
        href="#for-schools"
        aria-label="Scroll to what is below"
        // Same dim/accent pair as the footer links. Written as literals
        // because Tailwind scans source text and cannot read LANDING at build
        // time — these are LANDING.dim and LANDING.accent.
        //
        // p-3 with a 26px glyph puts the tap target near 50px while the arrow
        // stays small enough not to compete with the wordmark above it.
        className="scroll-cue pointer-events-auto rounded-full p-3 text-[#8A8FA0] transition-colors hover:text-[#3B6EF6] focus-visible:text-[#3B6EF6]"
      >
        <ChevronDown
          size={26}
          strokeWidth={1.75}
          aria-hidden="true"
          className="scroll-cue-arrow block"
        />
      </a>
    </div>
  )
}
