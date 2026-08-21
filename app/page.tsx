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
  const primaryHref = user ? '/dashboard' : signUpHref

  const content = (
    <div className="min-h-screen relative overflow-x-hidden" style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}>
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
        <div className="flex items-center gap-2 text-[#16181D] font-extrabold text-xl tracking-tight">
          <span className="w-7 h-7 rounded-lg bg-[#3B6EF6] text-white flex items-center justify-center text-xs">◉</span>
          pinspace
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
      <div className="relative z-10 px-4 pt-8 pb-48 sm:pb-56">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center"
        >
          <motion.h1
            className="mx-auto max-w-4xl text-6xl sm:text-7xl md:text-8xl font-extrabold leading-[0.98] tracking-[-0.03em] text-[#16181D]"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.15 }}
          >
            Your studio,
            <br />
            always on the wall.
          </motion.h1>

          <motion.p
            className="mt-6 mx-auto max-w-xl text-lg sm:text-xl leading-relaxed text-[#5A5E6B]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.35 }}
          >
            Pin work into a 3D room, crit it in place, and keep every semester — beautifully archived.
          </motion.p>

          <motion.div
            className="flex flex-wrap justify-center gap-3 mt-9"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
          >
            <button
              onClick={() => router.push(primaryHref)}
              className="px-9 py-4 bg-[#3B6EF6] hover:bg-[#16181D] text-white rounded-full transition-colors font-bold text-[17px] shadow-[0_14px_34px_rgba(59,110,246,0.35)]"
            >
              Enter your studio
            </button>
            <button
              onClick={() => router.push(signInHref)}
              className="px-8 py-4 bg-white/80 hover:border-[#3B6EF6] hover:text-[#3B6EF6] text-[#16181D] rounded-full transition-colors font-semibold text-[17px] border border-[#16181D]/10"
            >
              I have a class code
            </button>
          </motion.div>

          <motion.div
            className="flex flex-wrap justify-center gap-8 mt-8 text-[13px] font-semibold text-[#8A8FA0]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.65 }}
          >
            <span>✓ Free for students</span>
            <span>✓ Join with a class code</span>
            <span>✓ Works in the browser</span>
          </motion.div>
        </motion.div>
      </div>

      {/* Decorative studio wall preview */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[-120px] w-[min(980px,92vw)] h-[280px] sm:h-[360px] rounded-t-[26px] p-5 box-border"
        style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.9)', backdropFilter: 'blur(16px)', boxShadow: '0 -20px 70px rgba(22,24,29,0.12)' }}
      >
        <div className="relative w-full h-full rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, #EDF1F9 60%, #DFE6F2 60%)' }}>
          <div className="absolute left-[6%] top-[14%] w-[7%] h-[52%]" style={{ background: 'repeating-linear-gradient(180deg, #8A8FA0 0 2px, #F4F6FA 2px 6px)' }} />
          <div className="absolute left-[16%] top-[14%] w-[13%] h-[36%]" style={{ background: 'repeating-linear-gradient(135deg, #D3D9E6 0 8px, #C2C9DA 8px 16px)' }} />
          <div className="absolute left-[33%] top-[18%] w-[10%] h-[30%] rounded" style={{ background: '#3B6EF6' }} />
          <div className="absolute left-[47%] top-[12%] w-[15%] h-[48%]" style={{ background: 'repeating-linear-gradient(135deg, #D3D9E6 0 8px, #C2C9DA 8px 16px)' }} />
          <div className="absolute left-[66%] top-[16%] w-[8%] h-[44%]" style={{ background: 'repeating-linear-gradient(180deg, #8A8FA0 0 2px, #F4F6FA 2px 6px)' }} />
          <div className="absolute right-4 top-4 bg-white/90 rounded-full px-4 py-2 text-xs font-bold text-[#5A5E6B]">
            your studio, live
          </div>
        </div>
      </div>

      <GalleryAvatarModal
        isOpen={showGalleryModal}
        onClose={() => setShowGalleryModal(false)}
        onEnter={handleEnterGallery}
      />

      <footer className="relative z-10 border-t border-[#16181D]/10 bg-white/70 backdrop-blur-sm mt-[220px] sm:mt-[260px]">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-[#8A8FA0]">
          <p>© {new Date().getFullYear()} PinSpace</p>
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
