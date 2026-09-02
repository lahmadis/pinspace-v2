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
 * Personal has no seal, so it gets the word as its whole content — but it is
 * a FIELD, not paper. It was white-on-white with a hairline border, which read
 * as the card failing to load next to a solid gold one.
 *
 * The reason it stayed plain was that inventing an accent would put a school's
 * colours on a person's own studios. That still holds, and pinspace blue is the
 * answer to it rather than an exception: it is the one accent on this screen
 * that belongs to no institution. The org arm wears the school's colour, the
 * personal arm wears the product's.
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
      <div
        // Flat, and the same shape as the branded arm below it, so switching
        // tabs swaps the colour rather than the card. #3B6EF6 written out
        // rather than tokenised because that is how every other dashboard
        // surface spells it (ChromeNav's tabs, the pin shelf's border).
        className="flex min-h-[152px] flex-col justify-center rounded-2xl bg-[#3B6EF6] px-6 py-5"
      >
        {/* White, not ink. #16181D on this blue clears the 3:1 large-text bar
            and nothing more; white is the legible half of the pair and the one
            that reads as a field rather than as a tinted card. */}
        <p className="text-[36px] font-extrabold leading-[1.05] tracking-[-0.035em] text-white">
          {title}
        </p>
        {subtitle && (
          <p className="mt-1 text-[19px] font-semibold text-white/85">{subtitle}</p>
        )}
      </div>
    )
  }

  return (
    <div
      className="flex min-h-[152px] items-center gap-3 rounded-2xl px-6 py-5"
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
          the mark off the card. "School of Architecture & Design" is roughly
          320px at 21px bold and the space beside the disc is about 216, so it
          WILL wrap — text-balance is what splits it across two even lines
          ("School of" / "Architecture & Design") instead of breaking wherever
          it runs out and stranding a word. The disc gave up 12px of its own
          width and the gap another 4 to keep that to two lines rather than
          three; if the string grows again, the subtitle's size is the next
          thing to give, not the disc. */}
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
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.mark} alt="" className="h-[54px] w-[54px]" />
      </span>
    </div>
  )
}
