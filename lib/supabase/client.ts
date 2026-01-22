'use client'

import { createBrowserClient } from '@supabase/auth-helpers-nextjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

function createMockSupabase() {
  // Minimal no-op client so the UI can render a helpful message instead of hanging
  const subscription = { unsubscribe: () => {} }
  return {
    auth: {
      async getSession() {
        return {
          data: { session: null },
          error: { message: 'Supabase env vars are missing' },
        }
      },
      onAuthStateChange() {
        return {
          data: { subscription },
          error: null,
        }
      },
      async signOut() {
        return { error: null }
      },
    },
  } as any
}

export const supabase = isSupabaseConfigured
  ? createBrowserClient(supabaseUrl!, supabaseAnonKey!)
  : createMockSupabase()