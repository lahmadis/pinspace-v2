'use client'

import { Suspense, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Figtree } from 'next/font/google'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import GalleryAvatarModal, { AvatarFormValues } from '@/components/GalleryAvatarModal'
import DemoBanner from '@/components/DemoBanner'
import { isDemoMode } from '@/lib/demoMode'
import AvatarMenu from '@/components/AvatarMenu'

const figtree = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
})

// Scoped to this page only — every selector is nested under .ps-landing so no
// global palette or Tailwind token is touched. Colors are intentionally literal
// here rather than tailwind.config.js entries.
const LANDING_CSS = `
.ps-landing {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  width: 100%;
  padding: 20px;
  background-color: #FFC800;
  color: #0B0B0B;
  text-align: center;
  overflow-x: hidden;
}

.ps-landing ::selection { background-color: #14705C; color: #FFC800; }
.ps-landing::selection { background-color: #14705C; color: #FFC800; }

/* 172px at desktop; 17vw keeps "pinspace." inside a 375px viewport with room
   to spare even while the fallback face (wider than Figtree) is still showing. */
.ps-landing-wordmark {
  margin: 0;
  font-weight: 900;
  font-size: clamp(3.25rem, 17vw, 172px);
  line-height: 0.85;
  letter-spacing: -0.055em;
  color: #0B0B0B;
}

.ps-landing-dot { color: #14705C; }

.ps-landing-tagline {
  margin: 34px 0 0;
  font-weight: 600;
  font-size: clamp(1.125rem, 4.5vw, 30px);
  line-height: 1.2;
  color: #0B0B0B;
}

.ps-landing-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 56px;
}

.ps-landing-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px 40px;
  border: none;
  border-radius: 999px;
  font-family: inherit;
  font-weight: 800;
  font-size: 19px;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease;
}

.ps-landing-btn:focus-visible { outline: 3px solid #0B0B0B; outline-offset: 3px; }

.ps-landing-btn-light { background-color: #FFFCF0; color: #0B0B0B; }
.ps-landing-btn-light:hover { background-color: #0B0B0B; color: #FFC800; }

.ps-landing-btn-green { background-color: #14705C; color: #FFC800; }
.ps-landing-btn-green:hover { background-color: #0B0B0B; }

.ps-landing-btn-arrow { flex: none; }

.ps-landing-corner {
  position: absolute;
  top: 28px;
  right: 32px;
  z-index: 20;
}

/* Restyles the shared AvatarMenu trigger for this page without editing that
   component, so its menu, click-outside and sign-out wiring stay untouched. */
.ps-landing-corner button[aria-haspopup='menu'] {
  width: 42px;
  height: 42px;
  background-color: #14705C;
  color: #FFC800;
  font-weight: 800;
  font-size: 16px;
  box-shadow: none;
}

.ps-landing-corner button[aria-haspopup='menu']:hover { background-color: #0B0B0B; }

.ps-landing-spinner {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  border: 3px solid rgba(11, 11, 11, 0.18);
  border-top-color: #0B0B0B;
  animation: ps-landing-spin 0.8s linear infinite;
}

@keyframes ps-landing-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .ps-landing-actions {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    max-width: 22rem;
  }
  .ps-landing-corner { top: 20px; right: 20px; }
}

@media (prefers-reduced-motion: reduce) {
  .ps-landing-spinner { animation-duration: 2.4s; }
  .ps-landing-btn { transition: none; }
}
`

function ArrowRight() {
  return (
    <svg
      className="ps-landing-btn-arrow"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

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

  const content = (
    <div className={`ps-landing ${figtree.className}`}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <DemoBanner />

      {/* Top-right corner: spinner while the session resolves, avatar once
          signed in, nothing when signed out — same three-way branch as before. */}
      <div className="ps-landing-corner">
        {loading ? (
          <div className="ps-landing-spinner" />
        ) : user ? (
          <AvatarMenu
            email={user.email || user.user_metadata?.email}
            onSignOut={() => supabase.auth.signOut().then(() => { window.location.href = '/' })}
          />
        ) : null}
      </div>

      <h1 className="ps-landing-wordmark">
        pinspace<span className="ps-landing-dot">.</span>
      </h1>

      <p className="ps-landing-tagline">where design work lives.</p>

      {/* Same auth split as before: signed-in users get Dashboard, signed-out
          users get the Sign In / Get Started pair with the institution param. */}
      {!loading && (
        <div className="ps-landing-actions">
          {user ? (
            <>
              <Link href="/dashboard" className="ps-landing-btn ps-landing-btn-light">
                Dashboard
              </Link>
              <Link href="/network" className="ps-landing-btn ps-landing-btn-green">
                Enter the network
                <ArrowRight />
              </Link>
            </>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  router.push(institutionSlug ? `/sign-in?institution=${institutionSlug}` : '/sign-in')
                }}
                className="ps-landing-btn ps-landing-btn-light"
              >
                Sign In
              </button>
              <button
                onClick={() => router.push(institutionSlug ? `/sign-up?institution=${institutionSlug}` : '/sign-up')}
                className="ps-landing-btn ps-landing-btn-green"
              >
                Get Started
                <ArrowRight />
              </button>
            </>
          )}
        </div>
      )}

      <GalleryAvatarModal
        isOpen={showGalleryModal}
        onClose={() => setShowGalleryModal(false)}
        onEnter={handleEnterGallery}
      />
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
