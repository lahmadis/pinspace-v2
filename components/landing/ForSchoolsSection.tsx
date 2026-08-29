'use client'

import {
  CARD,
  CONTACT_MAILTO,
  Eyebrow,
  PillLink,
  Reveal,
  SectionHeading,
} from './landingKit'

const PILLARS = [
  {
    n: '01',
    title: 'Collaboration',
    body: 'Students gain access to the work of their peers in other design disciplines, encouraging collaboration and inter-disciplinary learning.',
  },
  {
    n: '02',
    title: 'Continuity',
    body: "Last year’s work does not get forgotten about. Students and faculty can reference projects from the same design brief.",
  },
  {
    n: '03',
    title: 'Visibility',
    body: 'Faculty can see what other sections in their studio are working on.',
  },
] as const

const STEPS = [
  {
    n: '01',
    title: 'Create a Section',
    body: 'Think of this like your studio section — your individual group of students.',
  },
  {
    n: '02',
    title: 'Add Spaces',
    body: 'Spaces typically coincide with in-person pin-ups, such as mid-reviews and final reviews.',
  },
  {
    n: '03',
    title: 'Publish and Archive',
    body: 'Publish to the network to add to the growing portfolio of student work.',
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
          <Eyebrow>For universities</Eyebrow>
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
          <Eyebrow>How it works</Eyebrow>
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

      </div>
    </section>
  )
}
