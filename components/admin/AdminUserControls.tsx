'use client'

import { useEffect, useState } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { resetAccountModeCache } from '@/lib/useAccountMode'
import { toast } from '@/lib/toast'

export function AdminUserControls() {
  const router = useRouter()
  const [email, setEmail] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser()
      if (data?.user?.email) {
        setEmail(data.user.email)
      }
    }
    loadUser()
  }, [])

  const handleSignOut = async () => {
    if (loading) return
    setLoading(true)
    try {
      resetAccountModeCache()
      await supabase.auth.signOut()
      toast.success('Signed out successfully')
      router.push('/login')
    } catch (err: any) {
      toast.error(err.message || 'Logout failed')
    } finally {
      setLoading(false)
    }
  }

  const initials = email ? email.slice(0, 2).toUpperCase() : 'AD'

  return (
    <div className="space-y-3">
      {/* Admin User Info Card */}
      <div className="flex items-center gap-2.5 rounded-lg border border-border-light bg-background-lighter px-3 py-2 text-xs">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-pinspace-forest">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-text-primary">{email || 'Administrator'}</p>
          <div className="flex items-center gap-1 text-[10px] font-medium text-accent">
            <ShieldCheck className="h-3 w-3" />
            <span>Admin Control Plane</span>
          </div>
        </div>
      </div>

      {/* Logout Action Button */}
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading}
        className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger/15 hover:border-danger/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
      >
        <LogOut className="h-3.5 w-3.5" />
        <span>{loading ? 'Signing out…' : 'Logout'}</span>
      </button>
    </div>
  )
}

export default AdminUserControls
