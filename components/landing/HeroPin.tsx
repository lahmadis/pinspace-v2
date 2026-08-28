/**
 * The hero wordmark's terminal period, and the pin that becomes it.
 *
 * A pin falls from above the page, its point strikes the baseline at the end of
 * "pinspace", and it is pushed in — the needle retracting as the head sinks
 * into place as the period. The product is called pinspace; this is the name
 * being performed. It is the only place in the app with a delight budget.
 *
 * NO MEASUREMENT, NO STATE, NO CLIENT DIRECTIVE. Every position here is a
 * fraction of the period's own 0.2em box, and the period's box is a fraction of
 * the <h1>'s font-size — so the whole thing scales with the wordmark from the
 * 3.5rem floor to the 13rem ceiling without a single computed pixel. An earlier
 * version measured glyph positions in an effect because the pin had to travel
 * to the "i" and back; dropping straight down removes the only thing that
 * needed JS.
 *
 * The three spans are one circle's worth of layout doing three jobs:
 *   - the OUTER span is the period's box in the flow. It carries the size and
 *     spacing, so the wordmark's centring is identical whether or not any of
 *     this animates.
 *   - `.hero-period-mark` is the real dot, hidden while the pin does its work
 *     and restored under reduced motion.
 *   - `.hero-pin` is the pin, positioned so its HEAD exactly covers that box.
 *     The animation in globals.css does the rest.
 */
export default function HeroPin() {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block align-baseline w-[0.2em] h-[0.2em] ml-[0.06em]"
    >
      {/* Terminal period as a true circle rather than the font's own '.', so it
          stays perfectly round and on-brand blue at any size. */}
      <span className="hero-period-mark absolute inset-0 rounded-full bg-[#3B6EF6]" />

      {/* Head over the period, needle hanging below the baseline. h-[0.56em] is
          the head (0.2em) plus 1.8 needle-lengths of it — the same 10:28 ratio
          as the viewBox, so the circle below lands exactly on the box above. */}
      <span className="hero-pin absolute left-0 top-0 w-[0.2em] h-[0.56em]">
        <svg viewBox="0 0 10 28" width="100%" height="100%" fill="none" className="block">
          {/* Needle first, so the head paints over the seam where they meet. */}
          <path className="hero-pin-needle" d="M3.9 8.4 L6.1 8.4 L5 28 Z" fill="#3B6EF6" />
          <circle cx="5" cy="5" r="5" fill="#3B6EF6" />
        </svg>
      </span>
    </span>
  )
}
