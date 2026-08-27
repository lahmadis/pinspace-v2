'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * The pinspace intro: a pin drops, stamps out the wordmark letter by letter,
 * settles into place as the period, and the tagline fades in under it.
 *
 * Three seconds, once per visitor, then never again.
 *
 *
 * ONE CLOCK, NOT TWO
 *
 * Everything is driven from a single requestAnimationFrame loop writing styles
 * through refs — no CSS keyframes, and no React state changes while it runs.
 *
 * That is deliberate rather than incidental. The pin has to arrive at each
 * letter at the exact moment that letter appears, and the letters are not
 * evenly spaced: "pinspace" in a proportional face puts the 'i' about half the
 * width of the 'p'. So the pin's waypoints have to be MEASURED, and CSS
 * keyframes cannot interpolate through a set of values only known at runtime.
 * Splitting the work — rAF for the pin, CSS animation-delay for the letters —
 * would mean two clocks started a frame apart, and the stamp would drift out of
 * sync with the thing it is supposed to be stamping.
 *
 *
 * IT WAITS FOR THE FONT
 *
 * Measurement happens after `document.fonts.ready`. The wordmark is set in
 * Onest, which arrives over the network; measuring before it lands would take
 * the fallback face's letter widths and the pin would stamp next to letters
 * rather than on them. The fallback path below still runs if the Font Loading
 * API is missing or rejects, because a slightly-off intro beats no wordmark.
 */

const WORD = 'pinspace'
const TAGLINE = 'where design work lives.'

/**
 * localStorage, not sessionStorage: "the first time you enter pinspace" means
 * once per person, not once per tab. Every access is wrapped — Safari private
 * mode throws on reads, and an intro animation is never worth an exception.
 */
const SEEN_KEY = 'pinspace-intro-seen'

/** The four beats, in ms. They sum to 3000. */
const DROP_MS = 500
const STAMP_MS = 1200
const SETTLE_MS = 400
const TAGLINE_MS = 900

const STAMP_AT = DROP_MS
const SETTLE_AT = STAMP_AT + STAMP_MS
const TAGLINE_AT = SETTLE_AT + SETTLE_MS
const TOTAL_MS = TAGLINE_AT + TAGLINE_MS

/** How far above its landing point the pin starts, in multiples of its size. */
const DROP_HEIGHT = 14
/** The pin is this many times the period's size while it works. */
const PIN_SCALE = 2.6
/** How far it floats above the word between stamps, in multiples of pin size. */
const HOVER_GAP = 0.75
/** How far it dips to press a letter, in multiples of pin size. */
const PRESS_DEPTH = 1.15
/** Where in each letter's slice of time the pin actually touches down. */
const CONTACT_AT = 0.42
/** How long a struck letter takes to settle from its stamped-in state. */
const LETTER_POP = 0.55

const ACCENT = '#3B6EF6'
const INK = '#16181D'
const MUTED = '#5A5E6B'

/** Real bounce, not an overshoot curve — it lands, rebounds, lands smaller. */
function easeOutBounce(t: number): number {
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) {
    t -= 1.5 / d
    return n * t * t + 0.75
  }
  if (t < 2.5 / d) {
    t -= 2.25 / d
    return n * t * t + 0.9375
  }
  t -= 2.625 / d
  return n * t * t + 0.984375
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * useLayoutEffect warns when React renders on the server. The decision below
 * has to happen before paint — that is the whole point of it — so this swaps to
 * useEffect on the server, where it never runs anyway.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

type Phase = 'undecided' | 'playing' | 'done'

interface LandingAnimationProps {
  /** Fires once the sequence finishes, and immediately when it is skipped. */
  onComplete?: () => void
  className?: string
}

export default function LandingAnimation({ onComplete, className = '' }: LandingAnimationProps) {
  /**
   * Starts undecided so the server and the first client render agree — reading
   * localStorage during render would hydrate differently from the HTML. The
   * layout effect below resolves it before the browser paints, so nothing
   * flashes either way.
   */
  const [phase, setPhase] = useState<Phase>('undecided')

  const stageRef = useRef<HTMLDivElement>(null)
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([])
  const dotSlotRef = useRef<HTMLSpanElement>(null)
  const pinRef = useRef<HTMLSpanElement>(null)
  const taglineRef = useRef<HTMLParagraphElement>(null)
  const onCompleteRef = useRef(onComplete)
  // Synced in an effect, not assigned during render: the sequence closes over
  // this ref, and mutating it mid-render is exactly the write React's
  // concurrent renderer is allowed to throw away and re-run.
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useIsomorphicLayoutEffect(() => {
    let seen = false
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === '1'
    } catch {
      // Storage unavailable. Treat as unseen: playing once too often is a much
      // smaller failure than an intro that never plays for anyone.
    }

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (seen || reduced) {
      setPhase('done')
      return
    }

    // Marked on START, not on completion: someone who lands, sees it begin and
    // navigates away has entered pinspace, and should not be shown it again.
    try {
      window.localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* see above */
    }
    setPhase('playing')
  }, [])

  useEffect(() => {
    if (phase !== 'playing') return

    let raf = 0
    let cancelled = false

    const finish = () => {
      if (cancelled) return
      setPhase('done')
      onCompleteRef.current?.()
    }

    const run = () => {
      if (cancelled) return
      const stage = stageRef.current
      const pin = pinRef.current
      const dotSlot = dotSlotRef.current
      const tagline = taglineRef.current
      const letters = letterRefs.current.slice(0, WORD.length)

      if (!stage || !pin || !dotSlot || !tagline || letters.some((el) => !el)) {
        finish()
        return
      }

      // --- measure once, in stage-local coordinates -----------------------
      const stageBox = stage.getBoundingClientRect()
      const dotBox = dotSlot.getBoundingClientRect()

      const pinSize = Math.max(4, dotBox.width)
      const dotX = dotBox.left - stageBox.left + dotBox.width / 2
      const dotY = dotBox.top - stageBox.top + dotBox.height / 2

      const marks = letters.map((el) => {
        const r = (el as HTMLSpanElement).getBoundingClientRect()
        return {
          x: r.left - stageBox.left + r.width / 2,
          top: r.top - stageBox.top,
        }
      })

      const wordTop = Math.min(...marks.map((m) => m.top))
      const hoverY = wordTop - pinSize * PIN_SCALE * HOVER_GAP
      const pressY = hoverY + pinSize * PIN_SCALE * PRESS_DEPTH
      const dropFrom = hoverY - pinSize * PIN_SCALE * DROP_HEIGHT

      const place = (x: number, y: number, scale: number, glow = 1) => {
        pin.style.transform =
          `translate3d(${x - pinSize / 2}px, ${y - pinSize / 2}px, 0) scale(${scale})`
        // Fades with the settle. A period does not glow, and the real dot that
        // replaces this element has no shadow — without this the swap pops.
        pin.style.boxShadow = `0 ${6 * glow}px ${18 * glow}px rgba(59,110,246,${0.45 * glow})`
      }

      const setLetter = (i: number, shown: number) => {
        const el = letters[i] as HTMLSpanElement
        el.style.opacity = String(shown)
        // Struck letters land slightly oversized and settle — a stamp presses
        // in, it does not fade up.
        el.style.transform = `scale(${1 + 0.34 * (1 - shown)})`
      }

      // --- first frame, before anything is visible ------------------------
      marks.forEach((_, i) => setLetter(i, 0))
      tagline.style.opacity = '0'
      place(marks[0].x, dropFrom, PIN_SCALE)
      pin.style.opacity = '1'

      let startedAt = 0

      const frame = (now: number) => {
        if (cancelled) return
        if (!startedAt) startedAt = now
        const t = now - startedAt

        // 1 — drop and bounce onto the first letter.
        if (t < STAMP_AT) {
          const p = clamp01(t / DROP_MS)
          const y = dropFrom + (hoverY - dropFrom) * easeOutBounce(p)
          place(marks[0].x, y, PIN_SCALE)
        }

        // 2 — stamp left to right. One equal slice of time per letter; the pin
        //     travels between marks and dips to press at CONTACT_AT.
        else if (t < SETTLE_AT) {
          const p = clamp01((t - STAMP_AT) / STAMP_MS) * WORD.length
          const i = Math.min(WORD.length - 1, Math.floor(p))
          const local = p - i

          const from = marks[i].x
          const to = i + 1 < marks.length ? marks[i + 1].x : dotX
          const x = from + (to - from) * easeOutCubic(local)

          // A single down-and-up per letter, peaking at contact.
          const dip = Math.sin(Math.PI * clamp01(local / (CONTACT_AT * 2)))
          place(x, hoverY + (pressY - hoverY) * dip, PIN_SCALE)

          for (let k = 0; k < WORD.length; k++) {
            const struckAt = k + CONTACT_AT
            setLetter(k, clamp01((p - struckAt) / LETTER_POP))
          }
        }

        // 3 — settle into the period: slide to the dot slot, drop to the
        //     baseline, and shrink to exactly the period's size.
        else if (t < TAGLINE_AT) {
          const p = easeOutCubic(clamp01((t - SETTLE_AT) / SETTLE_MS))
          const lastX = marks[marks.length - 1].x
          marks.forEach((_, i) => setLetter(i, 1))
          place(
            lastX + (dotX - lastX) * p,
            hoverY + (dotY - hoverY) * p,
            PIN_SCALE + (1 - PIN_SCALE) * p,
            1 - p,
          )
        }

        // 4 — tagline in, then hold.
        else {
          marks.forEach((_, i) => setLetter(i, 1))
          place(dotX, dotY, 1, 0)
          const p = easeOutCubic(clamp01((t - TAGLINE_AT) / (TAGLINE_MS * 0.5)))
          tagline.style.opacity = String(p)
          tagline.style.transform = `translateY(${(1 - p) * 8}px)`
        }

        if (t >= TOTAL_MS) {
          finish()
          return
        }
        raf = requestAnimationFrame(frame)
      }

      raf = requestAnimationFrame(frame)
    }

    // Measure only once the wordmark's real face is in.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts?.ready) {
      // .then(run, run), not .then(run).catch(run): the latter re-invokes run
      // if run ITSELF throws, starting a second loop that orphans the first
      // rAF handle so cleanup can only cancel one of them.
      fonts.ready.then(run, run)
    } else {
      run()
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [phase])

  const playing = phase === 'playing'
  const settled = phase === 'done'

  return (
    <div
      ref={stageRef}
      className={`relative text-center ${className}`}
      // Undecided lasts less than a frame — the layout effect resolves it
      // before paint — but hiding it means that if anything ever delays that
      // resolution, the page shows nothing rather than a wordmark that then
      // jumps back to the start of the animation.
      style={{ visibility: phase === 'undecided' ? 'hidden' : 'visible' }}
    >
      <h1
        // The heading stays IN the accessibility tree — it is the page's only
        // one. It carries the finished words as its label so the sequence reads
        // as "pinspace" rather than as eight separately-announced letters; the
        // decorative spans inside are hidden individually below.
        aria-label={WORD}
        className="relative inline-block font-extrabold leading-[0.9] tracking-[-0.045em] text-[clamp(3.5rem,11vw,13rem)]"
        style={{ color: INK }}
      >
        {WORD.split('').map((ch, i) => (
          <span
            key={i}
            aria-hidden="true"
            ref={(el) => {
              letterRefs.current[i] = el
            }}
            className="inline-block will-change-transform"
            // Letters always occupy their final layout, visible or not: the pin
            // is aimed at measured positions, so nothing here may reflow once
            // the sequence has started.
            style={playing ? { opacity: 0 } : undefined}
          >
            {ch}
          </span>
        ))}

        {/* The period's slot. It reserves the space and gives the pin its
            target; the real dot only renders once the pin has finished being
            it, so the two are never on screen together. */}
        <span
          aria-hidden="true"
          ref={dotSlotRef}
          className="inline-block align-baseline rounded-full w-[0.2em] h-[0.2em] ml-[0.06em]"
          style={{ background: settled ? ACCENT : 'transparent' }}
        />

        {playing && (
          <span
            ref={pinRef}
            className="absolute left-0 top-0 rounded-full will-change-transform"
            style={{
              width: '0.2em',
              height: '0.2em',
              background: ACCENT,
              boxShadow: `0 6px 18px rgba(59,110,246,0.45)`,
              opacity: 0,
            }}
          />
        )}
      </h1>

      <p
        ref={taglineRef}
        aria-hidden="true"
        className="mt-5 mx-auto max-w-xl leading-relaxed text-[clamp(1.05rem,1.9vw,1.6rem)]"
        style={{ color: MUTED, ...(playing ? { opacity: 0 } : undefined) }}
      >
        {TAGLINE}
      </p>
    </div>
  )
}
