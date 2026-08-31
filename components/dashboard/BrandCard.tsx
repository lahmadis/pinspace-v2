'use client'

import { withAlpha, type OrgBrand } from '@/lib/constants/orgBranding'

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
      className="flex min-h-[152px] flex-col justify-end rounded-2xl border px-6 py-5"
      style={{
        // Every stop derives from the brand, so a second branded org gets its
        // own colours rather than Wentworth's golds with its name on them.
        background: `linear-gradient(150deg, ${brand.accentSoft} 0%, ${withAlpha(brand.accent, 0.55)} 100%)`,
        borderColor: withAlpha(brand.accentInk, 0.16),
      }}
    >
      {/* The seal sits above the name rather than beside it: at this width a
          side-by-side lockup leaves the name two words per line. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={brand.mark}
        alt=""
        aria-hidden="true"
        className="mb-2 h-8 w-8 shrink-0"
      />
      <p className="text-[36px] font-extrabold leading-[1.02] tracking-[-0.04em] text-[#16181D]">
        {title}
      </p>
      {subtitle && (
        <p className="text-[21px] font-bold leading-tight tracking-[-0.025em] text-[#16181D]">
          {subtitle}
        </p>
      )}
    </div>
  )
}
