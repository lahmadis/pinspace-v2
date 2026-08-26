'use client'

import { useId, useState } from 'react'
import { CARD, CONTACT_MAILTO, Eyebrow, Reveal, SectionHeading } from './landingKit'

/**
 * Every answer here is drawn from a claim the For schools section already
 * makes — pilot terms, setup, ownership, privacy, accreditation, pricing.
 * The FAQ is the same commitments asked as questions, so the two can't drift.
 */
const FAQS = [
  {
    q: 'What does a pilot cost?',
    a: 'Nothing. One section for one semester, free — the full platform, faculty setup support and a review at the end of term. Places for fall 2026 are open now.',
  },
  {
    q: 'What does IT have to set up?',
    a: 'Nothing. Students join with a class code in the browser. There is nothing to install and nothing to license per machine, so a pilot never becomes an IT project.',
  },
  {
    q: 'How long does setup actually take?',
    a: 'A coordinator builds the crit room in about thirty minutes — walls, student zones and deadlines. There is no data migration; you start the semester with an empty room and fill it as work gets pinned.',
  },
  {
    q: 'Who owns the work?',
    a: 'Students do. Every student can export their full archive at any time and keeps access after they graduate. The department can export the full section archive on request, in a standard format, with no exit fee.',
  },
  {
    q: 'Can faculty see what is on a student desk?',
    a: 'No. Personal desk crit notes, voice memos and redlines are visible only to the student who made them. Pinned work and the crit comments on it are the shared part; the desk is not.',
  },
  {
    q: 'Is student work used to train AI models?',
    a: "No. Work is never used to train models, and it never leaves the school's account without permission.",
  },
  {
    q: 'How does this help with accreditation?',
    a: 'Every board carries its studio, brief, semester and criteria tags as it is pinned, so the evidence set is assembled during the semester rather than rebuilt after it. At review, filter the archive and export as a PDF set or a linked index — with crit comments attached or stripped out.',
  },
  {
    q: 'What happens when a section changes hands?',
    a: 'The archive does not change hands with it. Faculty picking up a studio inherit years of answers to the same brief, so a new coordinator starts with the section’s history rather than a blank folder.',
  },
  {
    q: 'What does it cost after the pilot?',
    a: 'Per student, per year, quoted by program size. That covers all sections, archive retention across cohorts, accreditation exports, single sign-on and an admin dashboard.',
  },
] as const

/**
 * One-at-a-time accordion.
 *
 * The panel animates `grid-template-rows` from `0fr` to `1fr` rather than a
 * measured pixel height: no ResizeObserver, no layout read, and it stays
 * correct when the answer reflows at a different width. It is a CSS
 * transition rather than a keyframe animation so a fast series of clicks
 * retargets from wherever the row currently is instead of restarting.
 */
export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)
  const baseId = useId()

  return (
    <section id="faq" className="relative z-10 scroll-mt-8 px-6 sm:px-10 pb-24 sm:pb-32">
      <div className="max-w-3xl mx-auto">
        <Reveal>
          <Eyebrow>FAQ</Eyebrow>
          <SectionHeading className="mt-5">Questions departments ask first.</SectionHeading>
        </Reveal>

        <Reveal delay={0.06} className="mt-10">
          <div className={`${CARD} overflow-hidden`}>
            {FAQS.map((item, i) => {
              const open = openIndex === i
              const panelId = `${baseId}-panel-${i}`
              const buttonId = `${baseId}-button-${i}`
              return (
                <div
                  key={item.q}
                  className={i === 0 ? '' : 'border-t border-[#16181D]/[0.08]'}
                >
                  <h3>
                    <button
                      type="button"
                      id={buttonId}
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setOpenIndex(open ? null : i)}
                      className="flex w-full items-center justify-between gap-5 px-6 sm:px-8 py-5 text-left transition-colors duration-150 hover:bg-white/60"
                    >
                      <span className="text-[16px] sm:text-[17px] font-semibold tracking-[-0.015em] text-[#16181D]">
                        {item.q}
                      </span>
                      {/* A plus that turns into a cross. One element rotating
                          45° reads as the same control changing state, where
                          swapping two icons reads as a replacement. */}
                      <span
                        aria-hidden="true"
                        className={`relative h-7 w-7 shrink-0 rounded-full bg-[#F0F3FA] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:duration-0 ${
                          open ? 'rotate-45' : ''
                        }`}
                      >
                        <span className="absolute left-1/2 top-1/2 h-[1.5px] w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#16181D]" />
                        <span className="absolute left-1/2 top-1/2 h-3 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#16181D]" />
                      </span>
                    </button>
                  </h3>

                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    className="grid transition-[grid-template-rows] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:duration-0"
                    style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden">
                      <p className="px-6 sm:px-8 pb-6 pr-12 text-[15px] leading-relaxed text-[#5A5E6B]">
                        {item.a}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mt-8 text-center text-[15px] text-[#5A5E6B]">
            Still deciding?{' '}
            <a
              href={`${CONTACT_MAILTO}?subject=Question%20about%20pinspace`}
              className="font-semibold text-[#3B6EF6] underline-offset-4 hover:underline"
            >
              Ask us directly
            </a>
            .
          </p>
        </Reveal>
      </div>
    </section>
  )
}
