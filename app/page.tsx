'use client'

import { Suspense, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import GalleryAvatarModal, { AvatarFormValues } from '@/components/GalleryAvatarModal'
import DemoBanner from '@/components/DemoBanner'
import { isDemoMode } from '@/lib/demoMode'
import AvatarMenu from '@/components/AvatarMenu'
import KineticGrid from '@/components/ui/kinetic-grid'
import ForSchoolsSection from '@/components/landing/ForSchoolsSection'
import FaqSection from '@/components/landing/FaqSection'
import ScrollCue from '@/components/landing/ScrollCue'
import HeroPin from '@/components/landing/HeroPin'

function HomeInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showGalleryModal, setShowGalleryModal] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [institutionSlug, setInstitutionSlug] = useState<string | null>(null)

  const isDemo = isDemoMode(searchParams)
  const institutionFromUrl = searchParams?.get('institution') ?? null

  // Persist institution from URL when landing via /i/[slug] (e.g. /?institution=wit)
  useEffect(() => {
    if (typeof window !== 'undefined' && institutionFromUrl) {
      window.sessionStorage.setItem('pinspace_institution', institutionFromUrl)
      setInstitutionSlug(institutionFromUrl)
    } else if (typeof window !== 'undefined') {
      setInstitutionSlug(window.sessionStorage.getItem('pinspace_institution'))
    }
  }, [institutionFromUrl])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user || null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user || null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleEnterGallery = (values: AvatarFormValues) => {
    const params = new URLSearchParams({
      color: values.color,
      appearance: values.appearance,
      department: values.department,
      year: values.year,
    })
    // Preserve demo mode if active
    if (isDemo) {
      params.set('demo', 'true')
    }
    setShowGalleryModal(false)
    router.push(`/gallery?${params.toString()}`)
  }

  const signInHref = institutionSlug ? `/sign-in?institution=${institutionSlug}` : '/sign-in'
  const signUpHref = institutionSlug ? `/sign-up?institution=${institutionSlug}` : '/sign-up'

  const content = (
    <div id="top" className="min-h-screen flex flex-col relative overflow-x-hidden" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
      <DemoBanner />

      {/* Faint grid, now cursor-reactive — it pinches toward the pointer and
          rings out from a click. Same near-white ruling on the same paper wash
          as the CSS version it replaces; only the behaviour is new.

          Renders as a bare background layer rather than wrapping the page:
          the ambient glows below have to sit OVER the grid, and a wrapper
          would put everything above it. Takes no pointer events, so it stays
          purely paper. */}
      <KineticGrid />

      {/* Ambient blue glows */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -left-44 -top-52 w-[700px] h-[700px] rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgba(59,110,246,0.16), rgba(59,110,246,0))' }}
        />
        <div
          className="absolute -right-36 -bottom-64 w-[800px] h-[800px] rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgba(160,190,255,0.28), rgba(160,190,255,0))' }}
        />
      </div>

      {/* Nav */}
      <div className="relative z-20 flex items-center justify-between px-6 sm:px-10 py-6">
        <div className="flex items-center gap-10">
          {/* Same lockup as the hero, just small — wordmark plus the blue
              terminal dot, no badge. */}
          <a href="#top" className="text-[#16181D] font-extrabold text-xl tracking-[-0.045em]">
            pinspace
            <span
              aria-hidden="true"
              className="inline-block align-baseline rounded-full bg-[#3B6EF6] w-[0.2em] h-[0.2em] ml-[0.06em]"
            />
          </a>

          {/* The two section tabs. Hidden on small screens rather than folded
              into a menu: the sections are directly below the hero, so on a
              phone scrolling IS the navigation. */}
          <nav className="hidden md:flex items-center gap-7">
            <a
              href="#for-schools"
              className="text-sm font-medium text-[#5A5E6B] hover:text-[#3B6EF6] transition-colors"
            >
              For Universities
            </a>
            <a
              href="#faq"
              className="text-sm font-medium text-[#5A5E6B] hover:text-[#3B6EF6] transition-colors"
            >
              FAQ
            </a>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {loading ? (
            <div className="w-8 h-8 border-2 border-[#8A8FA0] border-t-[#3B6EF6] rounded-full animate-spin" />
          ) : user ? (
            <>
              {/* Dashboard has moved into the hero, under the tagline. It is
                  the one thing a signed-in visitor came here to do, and a small
                  bordered pill in the corner asked them to hunt for it. The
                  avatar stays: that is the account control, not the way in. */}
              <AvatarMenu
                email={user.email || user.user_metadata?.email}
                onSignOut={() => supabase.auth.signOut().then(() => { window.location.href = '/' })}
              />
            </>
          ) : (
            <>
              <button
                onClick={(e) => { e.preventDefault(); router.push(signInHref) }}
                className="px-6 py-3 bg-white/80 hover:border-[#3B6EF6] hover:text-[#3B6EF6] text-[#16181D] rounded-full transition-colors font-semibold text-[15px] border border-[#16181D]/10"
              >
                Sign in
              </button>
              <button
                onClick={() => router.push(signUpHref)}
                className="px-7 py-3.5 bg-[#16181D] hover:bg-[#3B6EF6] text-white rounded-full transition-colors font-bold text-[15px]"
              >
                Get started
              </button>
            </>
          )}
        </div>
      </div>

      {/* Hero */}
      {/* Two rules, because the page has two shapes. flex-1 takes whatever the
          column has left over — which is what centred the hero when the footer
          sat directly below it. Now that the For Universities and FAQ sections follow,
          there IS no leftover space, so the min-height is what holds the hero to
          the first screen. 104px is the nav's own height; svh so mobile browser
          chrome doesn't push the fold. Padding is symmetric so the content sits
          on the true centre rather than riding high. */}
      <div className="relative z-10 flex-1 min-h-[calc(100svh_-_104px)] px-4 py-10 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="w-full text-center"
        >
          {/* The wordmark IS the logo here — no badge. Sized fluidly with vw
              rather than breakpoint steps so it holds the same share of the
              viewport (~40%) at every width, which is what makes it read as a
              logo lockup instead of just large text. Onest 800 is already
              loaded via globals.css. */}
          <motion.h1
            className="font-extrabold leading-[0.9] tracking-[-0.045em] text-[#16181D] text-[clamp(3.5rem,11vw,13rem)]"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.15 }}
          >
            pinspace
            {/* The terminal period, and the pin that drops in and becomes it.
                Its own component only because it is three nested spans and an
                SVG; it holds no state and takes no props, and the type is still
                sized and tracked entirely by this <h1>. */}
            <HeroPin />
          </motion.h1>

          <motion.p
            className="mt-9 mx-auto max-w-xl leading-relaxed text-[#5A5E6B] text-[clamp(1.25rem,2.4vw,2rem)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.35 }}
          >
            where design work lives
          </motion.p>

          {/* The way in, for someone already signed in. Sized to the hero
              rather than to the nav, and delayed one beat past the tagline so
              the page still reads wordmark -> line -> action. Rendered only
              once auth has settled, so it cannot flash for a signed-out
              visitor and then vanish. */}
          {!loading && user && (
            <motion.div
              className="mt-9"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.5 }}
            >
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-full bg-[#3B6EF6] px-9 py-4 text-[16px] font-bold text-white transition-[transform,background-color] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[#16181D] active:scale-[0.97]"
              >
                Go to Dashboard
              </Link>
            </motion.div>
          )}

        </motion.div>

        {/* Sits in the hero's own box, so it scrolls away as the sections
            arrive rather than needing to be told when to go. */}
        <ScrollCue />
      </div>

      <ForSchoolsSection />
      <FaqSection />

      <GalleryAvatarModal
        isOpen={showGalleryModal}
        onClose={() => setShowGalleryModal(false)}
        onEnter={handleEnterGallery}
      />

      {/* No top margin: the section above brings its own bottom padding. */}
      <footer className="relative z-10 border-t border-[#16181D]/10 bg-white/70 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-[#8A8FA0]">
          <p>© {new Date().getFullYear()} pinspace</p>
          <nav className="flex gap-6">
            <Link href="/terms" className="hover:text-[#3B6EF6] transition-colors">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-[#3B6EF6] transition-colors">
              Privacy Policy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )

  return content
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  )
}
