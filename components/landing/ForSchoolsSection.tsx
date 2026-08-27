'use client'

import {
  CARD,
  CONTACT_EMAIL,
  CONTACT_MAILTO,
  HAIRLINE,
  Eyebrow,
  PillLink,
  Reveal,
  SectionHeading,
} from './landingKit'

const PILOT_STATS = [
  { label: 'Sections in pilot', value: '2' },
  { label: 'Students', value: '36' },
  { label: 'IT setup required', value: 'None' },
  { label: 'Cost during pilot', value: 'Free' },
] as const

const PILLARS = [
  {
    n: '01',
    title: 'Cross-disciplinary collaboration',
    body: 'Students gain access to the work of their peers in other design disciplines, encouraging collaboration and inter-disciplinary learning.',
  },
  {
    n: '02',
    title: 'Continuity',
    body: 'Sections change hands every semester. The archive does not. Faculty inherit five years of answers to the same brief.',
  },
  {
    n: '03',
    title: 'Visibility',
    body: 'Coordinators see which sections are pinning, which students have gone quiet, and where crits are actually landing.',
  },
] as const

const STEPS = [
  {
    n: '01',
    title: 'Pick one studio',
    body: 'One studio, one semester.',
  },
  {
    n: '02',
    title: 'Set up the space',
    body: 'A coordinator builds the space in about 2 minutes.',
  },
  {
    n: '03',
    title: 'Students join',
    body: 'An email list or a class code allows students access to the pinspace studio.',
  },
] as const

const PROMISES = [
  {
    title: 'Students own their work.',
    body: 'Every student can export their full archive at any time and keeps access after they graduate.',
  },
  {
    title: 'The school gains an archive.',
    body: 'Departments export the full section archive on request, in a standard format, with no exit fee.',
  },
  {
    title: 'Desks stay private.',
    body: 'Personal desk crit notes, voice memos and redlines are visible only to the student who made them.',
  },
  {
    title: 'No training on student work.',
    body: "Work is never used to train models and never leaves the school's account without permission.",
  },
] as const

/**
 * The department-facing pitch, carried over from the platform deck.
 *
 * The copy is the deck's; the surfaces are not. The deck styled this as flat
 * bordered rectangles in a system font, which reads as a slide rather than as
 * the product — so everything here is rebuilt on the app's own vocabulary:
 * Onest (inherited from the page), big soft radii, the paper-white cards the
 * rest of pinspace uses, and the single blue accent.
 */
export default function ForSchoolsSection() {
  return (
    <section id="for-schools" className="relative z-10 scroll-mt-8 px-6 sm:px-10 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto">
        {/* Lead */}
        <Reveal className="max-w-3xl">
          <Eyebrow>For departments</Eyebrow>
          <SectionHeading className="mt-5">All design studios, all in one place.</SectionHeading>
          <p className="mt-5 text-[17px] leading-relaxed text-[#5A5E6B]">
            pinspace is a design-oriented platform for students to archive, collaborate, and learn. While
            students upload their work, departments gain access to an organized portfolio of student work,
            all in one place.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <PillLink href={`${CONTACT_MAILTO}?subject=Walkthrough%20request`}>Book a 20-minute walkthrough</PillLink>
            <PillLink href={`${CONTACT_MAILTO}?subject=One-pager%20request`} variant="outline">
              Ask for the one-pager
            </PillLink>
          </div>
        </Reveal>

        {/* Pilot card */}
        <Reveal delay={0.06} className="mt-14">
          <div className={`${CARD} p-7 sm:p-9`}>
            <Eyebrow>Pilot, fall 2026</Eyebrow>
            <p className="mt-4 text-[22px] font-bold tracking-[-0.02em] text-[#16181D]">
              School of Architecture and Design
            </p>
            <p className="text-[15px] text-[#5A5E6B]">Wentworth Institute of Technology</p>

            <dl className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {PILOT_STATS.map((s) => (
                <div key={s.label} className={`rounded-[20px] bg-[#F5F7FC] ${HAIRLINE} px-5 py-4`}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8A8FA0]">
                    {s.label}
                  </dt>
                  <dd className="mt-1.5 text-[26px] font-extrabold tracking-[-0.03em] text-[#16181D]">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>

        {/* Three pillars */}
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.n} delay={0.06 * i}>
              <div className={`${CARD} h-full p-7`}>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#3B6EF6] text-[13px] font-bold text-white">
                  {p.n}
                </span>
                <h3 className="mt-5 text-[18px] font-bold tracking-[-0.02em] text-[#16181D]">{p.title}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-[#5A5E6B]">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* How a pilot runs */}
        <Reveal className="mt-24">
          <Eyebrow>How a pilot runs</Eyebrow>
        </Reveal>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={0.06 * i}>
              <div className={`${CARD} h-full p-7`}>
                <span className="text-[13px] font-bold tabular-nums text-[#3B6EF6]">{s.n}</span>
                <h3 className="mt-3 text-[18px] font-bold tracking-[-0.02em] text-[#16181D]">{s.title}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-[#5A5E6B]">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Ownership and privacy */}
        <Reveal className="mt-24">
          <Eyebrow>Ownership and privacy</Eyebrow>
        </Reveal>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {PROMISES.map((p, i) => (
            <Reveal key={p.title} delay={0.05 * i}>
              <div className={`${CARD} h-full p-7`}>
                <h3 className="text-[17px] font-bold tracking-[-0.02em] text-[#16181D]">{p.title}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-[#5A5E6B]">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Pricing */}
        <div className="mt-24 grid gap-6 lg:grid-cols-2">
          <Reveal>
            <div className={`${CARD} h-full p-8 flex flex-col`}>
              <Eyebrow>Pilot</Eyebrow>
              <p className="mt-6 text-[44px] font-extrabold leading-none tracking-[-0.04em] text-[#16181D]">
                Free
              </p>
              <p className="mt-2 text-[15px] text-[#5A5E6B]">One section, one semester</p>
              <p className="mt-5 text-[15px] leading-relaxed text-[#5A5E6B]">
                Full platform, faculty setup support and a review at the end of term. Fall 2026 places are
                open now.
              </p>
              <div className="mt-auto pt-8">
                <PillLink href={`${CONTACT_MAILTO}?subject=Pilot%20place%20request`}>Request a pilot place</PillLink>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <div className={`${CARD} h-full p-8 flex flex-col`}>
              <Eyebrow>Department</Eyebrow>
              <p className="mt-6 text-[30px] font-extrabold leading-tight tracking-[-0.035em] text-[#16181D]">
                Per student, per year
              </p>
              <p className="mt-2 text-[15px] text-[#5A5E6B]">Quoted by program size</p>
              <p className="mt-5 text-[15px] leading-relaxed text-[#5A5E6B]">
                All sections, archive retention across cohorts, accreditation exports, single sign-on and
                an admin dashboard.
              </p>
              <div className="mt-auto pt-8">
                <PillLink href={`${CONTACT_MAILTO}?subject=Department%20quote`} variant="outline">
                  Get a quote
                </PillLink>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Closing CTA — the one dark surface on the page, so it reads as the
            end of the pitch rather than as one more card. */}
        <Reveal delay={0.05} className="mt-24">
          <div className="rounded-[32px] bg-[#16181D] px-8 py-12 sm:px-14 sm:py-16 text-center">
            <h2 className="text-[clamp(1.8rem,3.6vw,2.7rem)] font-extrabold leading-[1.06] tracking-[-0.035em] text-white">
              Talk to us about fall 2026.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-white/65">
              Twenty minutes with a studio coordinator is usually enough to know whether it fits your
              program. We will bring a room built from your own brief.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href={`${CONTACT_MAILTO}?subject=Walkthrough%20request`}
                className="inline-flex items-center justify-center rounded-full bg-white px-7 py-3.5 text-[15px] font-semibold text-[#16181D] transition-[transform,background-color,color] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[#3B6EF6] hover:text-white active:scale-[0.97]"
              >
                Book a walkthrough
              </a>
              <a
                href={CONTACT_MAILTO}
                className="text-[13px] font-semibold uppercase tracking-[0.12em] text-white/55 transition-colors hover:text-white"
              >
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
