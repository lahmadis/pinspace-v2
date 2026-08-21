'use client'

import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

import AvatarMenu from '@/components/AvatarMenu'
import DemoBanner from '@/components/DemoBanner'
import GalleryAvatarModal, { type AvatarFormValues } from '@/components/GalleryAvatarModal'
import { isDemoMode } from '@/lib/demoMode'
import { supabase } from '@/lib/supabase/client'

function withInstitution(path: string, institutionSlug: string | null) {
  if (!institutionSlug) return path
  const params = new URLSearchParams({ institution: institutionSlug })
  return `${path}?${params.toString()}`
}

function HomeInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const institutionFromUrl = searchParams?.get('institution') ?? null
  const [showGalleryModal, setShowGalleryModal] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [institutionSlug, setInstitutionSlug] = useState<string | null>(null)

  const isDemo = isDemoMode(searchParams)

  useEffect(() => {
    if (institutionFromUrl) {
      window.sessionStorage.setItem('pinspace_institution', institutionFromUrl)
      // sessionStorage is unavailable during server rendering; update after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstitutionSlug(institutionFromUrl)
    } else {
      setInstitutionSlug(window.sessionStorage.getItem('pinspace_institution'))
    }
  }, [institutionFromUrl])

  useEffect(() => {
    let active = true

    void supabase.auth.getSession()
      .then(({ data: { session } }: { data: { session: Session | null } }) => {
        if (active) setUser(session?.user || null)
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (!active) return
        setUser(session?.user || null)
        setLoading(false)
      },
    )

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const handleEnterGallery = (values: AvatarFormValues) => {
    const params = new URLSearchParams({
      color: values.color,
      appearance: values.appearance,
      department: values.department,
      year: values.year,
    })
    if (isDemo) params.set('demo', 'true')
    setShowGalleryModal(false)
    router.push(`/gallery?${params.toString()}`)
  }

  const signInHref = withInstitution('/sign-in', institutionSlug)
  const dashboardSignInParams = new URLSearchParams()
  if (institutionSlug) dashboardSignInParams.set('institution', institutionSlug)
  dashboardSignInParams.set('redirect', '/dashboard')
  const dashboardHref = user ? '/dashboard' : `/sign-in?${dashboardSignInParams.toString()}`

  return (
    <div className="min-h-dvh overflow-hidden bg-primary font-sans text-pinspace-ink selection:bg-accent selection:text-primary">
      <DemoBanner />
      <main className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-primary px-4 py-24 text-center sm:px-8">
        <div className="absolute right-4 top-4 z-10 sm:right-8 sm:top-7">
          {loading ? (
            <div aria-hidden="true" className="h-11 w-20 rounded-full bg-accent/60 animate-pulse" />
          ) : user ? (
            <AvatarMenu
              email={user.email || user.user_metadata?.email}
              onSignOut={() => supabase.auth.signOut().then(() => {
                router.replace('/')
                router.refresh()
              })}
            />
          ) : (
            <Link
              href={signInHref}
              aria-label="Sign in to pinspace"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-2 text-sm font-extrabold text-primary transition-colors hover:bg-pinspace-ink hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pinspace-ink focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
            >
              Sign In
            </Link>
          )}
        </div>

        <div className="flex w-full flex-col items-center">
          <h1 className="max-w-full whitespace-nowrap text-[clamp(4rem,11.95vw,10.75rem)] font-black leading-[0.85] tracking-[-0.035em] text-pinspace-ink">
            <span>pinspace</span><span className="text-accent">.</span>
          </h1>
          <p className="mt-6 text-[clamp(1.25rem,2.08vw,1.875rem)] font-semibold leading-tight text-pinspace-ink sm:mt-[34px]">
            where design work lives
          </p>

          {loading && (
            <p role="status" aria-live="polite" className="sr-only">Checking your session</p>
          )}

          <div className="mt-10 flex w-full max-w-sm flex-col justify-center gap-4 sm:mt-14 sm:max-w-none sm:flex-row">
            {loading ? (
              <button
                type="button"
                disabled
                className="inline-flex min-h-16 items-center justify-center rounded-full border-0 bg-background-light px-10 py-5 text-[19px] font-extrabold text-pinspace-ink opacity-65"
              >
                Loading…
              </button>
            ) : user ? (
              <>
                <Link
                  href={dashboardHref}
                  className="inline-flex min-h-16 items-center justify-center rounded-full border-0 bg-background-light px-10 py-5 text-[19px] font-extrabold text-pinspace-ink transition-colors hover:bg-pinspace-ink hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pinspace-ink focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
                >
                  Dashboard
                </Link>
                <Link
                  href={isDemo ? '/explore?demo=true' : '/explore'}
                  className="inline-flex min-h-16 items-center justify-center rounded-full border-0 bg-accent px-10 py-5 text-[19px] font-extrabold text-primary transition-colors hover:bg-pinspace-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pinspace-ink focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
                >
                  Enter the network <span aria-hidden="true" className="ml-1">→</span>
                </Link>
              </>
            ) : (
              <Link
                href={signInHref}
                className="inline-flex min-h-16 items-center justify-center rounded-full border-0 bg-accent px-10 py-5 text-[19px] font-extrabold text-primary transition-colors hover:bg-pinspace-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pinspace-ink focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
              >
                Sign in to Get Started <span aria-hidden="true" className="ml-1">→</span>
              </Link>
            )}
          </div>
        </div>
      </main>

      <GalleryAvatarModal
        isOpen={showGalleryModal}
        onClose={() => setShowGalleryModal(false)}
        onEnter={handleEnterGallery}
      />
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-primary" />}>
      <HomeInner />
    </Suspense>
  )
}
