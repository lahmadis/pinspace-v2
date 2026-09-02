'use client'

import { type OrgBrand } from '@/lib/constants/orgBranding'

/**
 * Whose dashboard this is, as a card.
 *
 * The org's identity used to be a wordmark image in the page header, level with
 * a row of buttons — chrome above the content. Here it is the first card in the
 * column, which is what makes the dashboard read as the school's place rather
 * than as a tool the school happens to be logged into.
 *
 * Two arms, and the plain one is not a degraded version of the branded one.
 * Personal has no seal and no accent to wash with, and inventing one would put
 * a school's colours on a person's own studios; it gets the paper treatment the
 * rest of the dashboard is made of, with the word as the whole content.
 */
export default function BrandCard({
  brand,
  title,
  subtitle,
}: {
  /** Null on the personal tab, and for an org with no artwork. */
  brand: OrgBrand | null
  title: string
  subtitle?: string | null
}) {
  if (!brand) {
    return (
      <div className="flex min-h-[152px] flex-col justify-center rounded-2xl border border-[#16181D]/[0.08] bg-white px-6 py-5">
        <p className="text-[36px] font-extrabold leading-[1.05] tracking-[-0.035em] text-[#16181D]">
          {title}
        </p>
        {subtitle && (
          <p className="mt-1 text-[19px] font-semibold text-[#5A5E6B]">{subtitle}</p>
        )}
      </div>
    )
  }

  return (
    <div
      className="flex min-h-[152px] items-center gap-4 rounded-2xl px-6 py-5"
      style={{
        // FLAT, and the accent at full strength. It was a two-stop gradient
        // from accentSoft to a 55% accent, which put the name on near-white at
        // the top-left corner it actually occupied — the card read as a pale
        // wash rather than as the school's colour. One value, still taken from
        // the brand, so a second branded org gets its own field rather than
        // Wentworth's golds with its name on them.
        background: brand.accent,
      }}
    >
      {/* Name left, mark right, both centred on the same line — the lockup the
          school's own banner uses. The seal used to sit ABOVE the name because
          a side-by-side version was tried at 265px and left the name two words
          per line; the column is 340 now, which is what makes this fit.

          min-w-0 so the subtitle wraps inside this block rather than pushing
          the mark off the card: "Architecture & Design" is wider at 21px than
          the space left beside a 76px disc, and text-balance splits it across
          two even lines instead of stranding the ampersand. */}
      <div className="min-w-0 flex-1">
        <p className="text-[36px] font-extrabold leading-[1.02] tracking-[-0.04em] text-[#16181D]">
          {title}
        </p>
        {subtitle && (
          <p className="text-[21px] font-bold leading-tight tracking-[-0.025em] text-[#16181D] [text-wrap:balance]">
            {subtitle}
          </p>
        )}
      </div>

      {/* A white disc UNDER the mark, sized so the mark very nearly fills it.
          Wentworth's is a round seal on a transparent square — a gold leopard
          inside a black ring — so on the accent at full strength the leopard
          would sink into the field it sits on. The disc is what it reads
          against, and because the artwork is already a circle the two land as
          one object rather than as a logo in a badge.

          The 6px of white left around it is deliberate: with none, the ring
          type touches the gold and the seal looks cropped.

          Sized for an org whose mark is round. One that ships a square mark
          gets a white circle with its logo inscribed — still legible, which is
          why this is not gated on artwork shape. */}
      <span
        aria-hidden="true"
        className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full bg-white"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.mark} alt="" className="h-16 w-16" />
      </span>
    </div>
  )
}
