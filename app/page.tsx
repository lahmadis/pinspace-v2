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
import InstitutionCard, { Institution } from '@/components/InstitutionCard'

function HomeInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showGalleryModal, setShowGalleryModal] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [institutionSlug, setInstitutionSlug] = useState<string | null>(null)
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [institutionsLoading, setInstitutionsLoading] = useState(true)

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

  useEffect(() => {
    fetch('/api/institutions')
      .then((r) => r.json())
      .then((data) => setInstitutions(data.institutions || []))
      .catch(() => {})
      .finally(() => setInstitutionsLoading(false))
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

  const content = (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      <DemoBanner />
      {/* Auth buttons in top-right */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-3">
        {loading ? (
          <div className="w-8 h-8 border-2 border-text-muted border-t-primary rounded-full animate-spin"></div>
        ) : user ? (
          <>
            <Link href="/dashboard">
              <button className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-900 rounded-lg transition-colors font-medium text-sm shadow-md border border-gray-200">
                Dashboard
              </button>
            </Link>
            <button
              onClick={() => supabase.auth.signOut().then(() => window.location.href = '/')}
              className="w-10 h-10 rounded-full bg-primary text-white font-semibold flex items-center justify-center hover:bg-primary-light transition-colors shadow-md"
              title={user.user_metadata?.email || 'User'}
            >
              {user.user_metadata?.email?.charAt(0).toUpperCase() || 'U'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={(e) => {
                e.preventDefault()
                router.push(institutionSlug ? `/sign-in?institution=${institutionSlug}` : '/sign-in')
              }}
              className="px-4 py-2 text-text-primary hover:text-primary transition-colors font-medium text-sm"
            >
              Sign In
            </button>
            <button
              onClick={() => router.push(institutionSlug ? `/sign-up?institution=${institutionSlug}` : '/sign-up')}
              className="px-6 py-2 bg-primary hover:bg-primary-light text-white rounded-lg transition-colors font-medium text-sm shadow-md"
            >
              Get Started
            </button>
          </>
        )}
      </div>

      {/* Animated gradient background - vibrant but not dark */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -inset-[10px] opacity-30">
          <div className="absolute top-0 -left-4 w-96 h-96 bg-primary/60 rounded-full mix-blend-multiply filter blur-3xl animate-float"></div>
          <div className="absolute top-0 -right-4 w-96 h-96 bg-accent/60 rounded-full mix-blend-multiply filter blur-3xl animate-float animation-delay-2000"></div>
          <div className="absolute -bottom-8 left-20 w-96 h-96 bg-purple-400/60 rounded-full mix-blend-multiply filter blur-3xl animate-float animation-delay-4000"></div>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center"
        >
          {/* Logo/Title */}
          <motion.h1 
            className="text-7xl md:text-9xl font-bold mb-6 bg-gradient-to-r from-primary-dark via-accent to-primary bg-clip-text text-transparent"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.2 }}
          >
            PinSpace
          </motion.h1>
          
          <motion.p 
            className="text-xl md:text-2xl text-text-secondary mb-4 font-light"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            Explore architecture studios in immersive 3D
          </motion.p>

          <motion.p 
            className="text-sm md:text-base text-text-muted mb-12 max-w-2xl mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
          >
            Navigate through a living network of studio work. From institutions to individual boards,
            experience design education like never before.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
          >
            <a
              href="#institutions"
              className="group relative px-8 py-4 bg-primary hover:bg-primary-light text-white rounded-lg font-medium transition-all duration-300 hover:scale-105 hover:shadow-lg min-w-[200px] text-center"
              onClick={(e) => {
                e.preventDefault()
                document.getElementById('institutions')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              Browse Institutions ↓
            </a>
          </motion.div>
          <motion.p
            className="mt-4 text-sm text-text-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1 }}
          >
            or{' '}
            <Link href="/sign-up" className="text-primary hover:underline">
              create a free personal account →
            </Link>
          </motion.p>

          {/* Feature Pills */}
          <motion.div 
            className="flex flex-wrap gap-3 justify-center mt-16 max-w-2xl mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1 }}
          >
            {['3D Studio Rooms', 'Interactive Network', 'Spatial Feedback'].map((feature) => (
              <div 
                key={feature}
                className="px-4 py-2 bg-white/60 backdrop-blur-sm border border-border rounded-full text-sm text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all duration-300 cursor-default shadow-sm"
              >
                {feature}
              </div>
            ))}
          </motion.div>
        </motion.div>

      </div>

      {/* Institution Directory */}
      <section id="institutions" className="relative z-10 bg-white/80 backdrop-blur-sm border-t border-gray-100 px-4 py-16">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2 text-center">
            Schools &amp; Firms on PinSpace
          </h2>
          <p className="text-gray-500 text-center mb-10 text-sm">Pick your institution to explore their studio network.</p>

          {institutionsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4 animate-pulse">
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-lg bg-gray-100" />
                    <div className="w-16 h-5 rounded-full bg-gray-100" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-100 rounded w-3/4" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                  </div>
                  <div className="h-4 bg-gray-100 rounded w-16 mt-auto" />
                </div>
              ))}
            </div>
          ) : institutions.length === 0 ? (
            <p className="text-center text-gray-400 py-12">Coming soon — no institutions yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {institutions.map((inst, i) => (
                <InstitutionCard key={inst.id} institution={inst} index={i} />
              ))}
            </div>
          )}

          <p className="mt-10 text-center text-sm text-gray-400">
            Don&apos;t see your school?{' '}
            <a
              href="mailto:hello@pinspace.app?subject=Request%20Access"
              className="text-primary hover:underline"
            >
              Request access →
            </a>
            {' · '}
            Just want a personal archive?{' '}
            <Link href="/sign-up" className="text-primary hover:underline">
              Sign up free →
            </Link>
          </p>
        </div>
      </section>

      <GalleryAvatarModal
        isOpen={showGalleryModal}
        onClose={() => setShowGalleryModal(false)}
        onEnter={handleEnterGallery}
      />

      <footer className="relative z-10 border-t border-border bg-white/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-text-muted">
          <p>© {new Date().getFullYear()} PinSpace</p>
          <nav className="flex gap-6">
            <Link href="/terms" className="hover:text-primary transition-colors">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-primary transition-colors">
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
