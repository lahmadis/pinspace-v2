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
  // Signed-in users go straight in; signed-out users get the sign-up path
  // rather than bouncing off /network's own auth redirect. The Dashboard button
  // is the secondary action, so it sends signed-out users to sign-in instead.
  const networkHref = user ? '/network' : signUpHref
  const dashboardHref = user ? '/dashboard' : signInHref

  const content = (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
      <DemoBanner />

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
        {/* Same lockup as the hero, just small — wordmark plus the blue
            terminal dot, no badge. */}
        <div className="text-[#16181D] font-extrabold text-xl tracking-[-0.045em]">
          pinspace
          <span
            aria-hidden="true"
            className="inline-block align-baseline rounded-full bg-[#3B6EF6] w-[0.2em] h-[0.2em] ml-[0.06em]"
          />
        </div>

        <div className="flex items-center gap-3">
          {loading ? (
            <div className="w-8 h-8 border-2 border-[#8A8FA0] border-t-[#3B6EF6] rounded-full animate-spin" />
          ) : user ? (
            <>
              <Link href="/dashboard">
                <button className="px-5 py-2.5 bg-white/80 hover:border-[#3B6EF6] hover:text-[#3B6EF6] text-[#16181D] rounded-full transition-colors font-semibold text-sm border border-[#16181D]/10">
                  Dashboard
                </button>
              </Link>
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
      {/* flex-1 inside the page's flex column, so this takes exactly the space
          left between nav and footer and centres in it — no min-height guess
          and no magic offset for the nav's height, which changes between the
          signed-in and signed-out button sets. Padding is symmetric so the
          content sits on the true centre of that space rather than riding high. */}
      <div className="relative z-10 flex-1 px-4 py-10 flex items-center justify-center">
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
            {/* Terminal period as a true circle rather than the font's own '.',
                so it stays perfectly round and on-brand blue at any size. Sized
                in em so it scales with the wordmark; baseline-aligned so it sits
                exactly where a period would. */}
            <span
              aria-hidden="true"
              className="inline-block align-baseline rounded-full bg-[#3B6EF6] w-[0.2em] h-[0.2em] ml-[0.06em]"
            />
          </motion.h1>

          <motion.p
            className="mt-5 mx-auto max-w-xl leading-relaxed text-[#5A5E6B] text-[clamp(1.05rem,1.9vw,1.6rem)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.35 }}
          >
            where design work lives
          </motion.p>

          <motion.div
            className="flex flex-wrap justify-center gap-3 mt-9"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
          >
            <button
              onClick={() => router.push(networkHref)}
              className="px-9 py-4 bg-[#3B6EF6] hover:bg-[#16181D] text-white rounded-full transition-colors font-bold text-[17px] shadow-[0_14px_34px_rgba(59,110,246,0.35)]"
            >
              Enter your network
            </button>
            <button
              onClick={() => router.push(dashboardHref)}
              className="px-8 py-4 bg-white/80 hover:border-[#3B6EF6] hover:text-[#3B6EF6] text-[#16181D] rounded-full transition-colors font-semibold text-[17px] border border-[#16181D]/10"
            >
              Dashboard
            </button>
          </motion.div>

        </motion.div>
      </div>

      <GalleryAvatarModal
        isOpen={showGalleryModal}
        onClose={() => setShowGalleryModal(false)}
        onEnter={handleEnterGallery}
      />

      {/* No top margin: the hero's flex-1 already owns the space above, so a
          margin here would just push the footer past the fold. */}
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
