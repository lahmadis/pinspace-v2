'use client'

import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * Shared vocabulary for the landing page's long-form sections.
 *
 * The hero has always written its colours inline as hex — it predates the
 * `--color-*` token set and doesn't use it — so these keep the same literals
 * rather than introducing a second, half-applied system on one page.
 */
export const LANDING = {
  ink: '#16181D',
  muted: '#5A5E6B',
  dim: '#8A8FA0',
  accent: '#3B6EF6',
} as const

/** Hairline that reads on both the white cards and the page's paper wash. */
export const HAIRLINE = 'border border-[#16181D]/[0.08]'

/**
 * Where every "talk to us" on the landing page goes — the walkthrough, the
 * one-pager, the pilot request, the quote, the FAQ's ask-us link, and the
 * address printed in the closing CTA.
 *
 * One constant rather than a literal per call site: these are the same inbox,
 * and the last time it lived in three places the FAQ's copy drifted from the
 * two in the pitch. Change it here and every button follows.
 */
export const CONTACT_EMAIL = 'slahmadi04@gmail.com'

/** `mailto:` for CONTACT_EMAIL. Append `?subject=…` (URL-encoded) per button. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`

/**
 * The section card. Bubbly means a radius large enough to read as a rounded
 * form rather than a softened rectangle — 28px against the 14px the app UI
 * uses, because these are page-scale surfaces, not controls.
 */
export const CARD =
  `rounded-[28px] bg-white/75 backdrop-blur-sm ${HAIRLINE} shadow-[0_10px_30px_rgba(22,24,29,0.05)]`

/** Strong ease-out — the built-in curve is too weak to read as deliberate. */
const EASE_OUT = [0.23, 1, 0.32, 1] as const

/**
 * Scroll-triggered entrance.
 *
 * `once` because a section that re-animates every time it scrolls back into
 * view turns a rare, first-read animation into a frequent one.
 *
 * `initial` IS A CONSTANT, and must stay one. It used to branch on
 * useReducedMotion(), which hydrates wrong: framer-motion reads the preference
 * synchronously at first render (`useState(prefersReducedMotion.current)`), and
 * on the server there is no matchMedia, so it is always false there. A
 * reduced-motion visitor therefore got server HTML carrying
 * `transform: translateY(18px)` and a client first render with no transform at
 * all — a mismatch on every Reveal on the page.
 *
 * Reduced motion is expressed through `transition` instead, which is only read
 * when an animation runs and so never reaches the server-rendered markup: the
 * element still starts at the same place, it just arrives instantly.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: reduce ? 0 : 0.55, delay: reduce ? 0 : delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}

/** The small uppercase label above a section heading. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-white/70 ${HAIRLINE} px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5A5E6B]`}
    >
      {children}
    </span>
  )
}

/**
 * Section heading. Negative tracking and tight leading because both want to
 * scale with size — large type reads too loose at the body's letter-spacing.
 */
export function SectionHeading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`text-[clamp(1.9rem,4vw,3.1rem)] font-extrabold leading-[1.04] tracking-[-0.035em] text-[#16181D] ${className}`}
    >
      {children}
    </h2>
  )
}

/** Pill button. Press feedback is instant and lives on :active, not on click. */
export function PillLink({
  href,
  children,
  variant = 'solid',
}: {
  href: string
  children: ReactNode
  variant?: 'solid' | 'outline'
}) {
  const base =
    'inline-flex items-center justify-center rounded-full px-7 py-3.5 text-[15px] font-semibold transition-[transform,background-color,border-color,color] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]'
  const skin =
    variant === 'solid'
      ? 'bg-[#16181D] text-white hover:bg-[#3B6EF6]'
      : `bg-white/80 text-[#16181D] ${HAIRLINE} hover:border-[#3B6EF6] hover:text-[#3B6EF6]`
  return (
    <a href={href} className={`${base} ${skin}`}>
      {children}
    </a>
  )
}
