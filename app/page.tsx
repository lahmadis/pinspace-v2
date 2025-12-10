'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import GalleryAvatarModal, { AvatarFormValues } from '@/components/GalleryAvatarModal'

export default function Home() {
  const router = useRouter()
  const [showGalleryModal, setShowGalleryModal] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null)
      setLoading(false)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
    setShowGalleryModal(false)
    router.push(`/gallery?${params.toString()}`)
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
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
                router.push('/sign-in')
              }}
              className="px-4 py-2 text-text-primary hover:text-primary transition-colors font-medium text-sm"
            >
              Sign In
            </button>
            <button
              onClick={() => router.push('/sign-up')}
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
            <Link href="/explore">
              <button className="group relative px-8 py-4 bg-primary hover:bg-primary-light text-white rounded-lg font-medium transition-all duration-300 hover:scale-105 hover:shadow-lg min-w-[200px]">
                <span className="relative z-10">Enter the Network</span>
              </button>
            </Link>
            
            <Link href="/upload">
              <button className="px-8 py-4 bg-background-card border border-primary text-primary hover:bg-primary hover:text-white rounded-lg font-medium transition-all duration-300 hover:scale-105 min-w-[200px]">
                Upload Your Board
              </button>
            </Link>

            <button
              onClick={() => setShowGalleryModal(true)}
              className="px-8 py-4 bg-white/80 border border-primary/40 text-primary-dark hover:bg-primary hover:text-white rounded-lg font-medium transition-all duration-300 hover:scale-105 min-w-[200px] shadow-md"
            >
              Enter Gallery
            </button>
          </motion.div>

          {/* Feature Pills */}
          <motion.div 
            className="flex flex-wrap gap-3 justify-center mt-16 max-w-2xl mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1 }}
          >
            {['3D Studio Rooms', 'Interactive Network', 'Live Critiques', 'Spatial Feedback'].map((feature, i) => (
              <div 
                key={feature}
                className="px-4 py-2 bg-white/60 backdrop-blur-sm border border-border rounded-full text-sm text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all duration-300 cursor-default shadow-sm"
              >
                {feature}
              </div>
            ))}
          </motion.div>
        </motion.div>

        {/* Scroll Indicator */}
        <motion.div
          className="absolute bottom-8 left-1/2 transform -translate-x-1/2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 10, 0] }}
          transition={{ 
            opacity: { duration: 1, delay: 1.5 },
            y: { duration: 2, repeat: Infinity, ease: "easeInOut" }
          }}
        >
          <div className="w-6 h-10 border-2 border-text-muted rounded-full flex justify-center">
            <div className="w-1 h-3 bg-text-secondary rounded-full mt-2"></div>
          </div>
        </motion.div>
      </div>

      <GalleryAvatarModal 
        isOpen={showGalleryModal}
        onClose={() => setShowGalleryModal(false)}
        onEnter={handleEnterGallery}
      />
    </div>
  )
}
