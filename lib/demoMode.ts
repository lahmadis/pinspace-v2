/**
 * Demo Mode Utilities
 * 
 * Functions to detect and handle demo mode throughout the app.
 * Demo mode is activated via URL parameter ?demo=true
 */

/**
 * Check if demo mode is active from URL search params
 * Works on both client and server side
 */
export function isDemoMode(searchParams?: URLSearchParams | string | null): boolean {
  if (typeof window !== 'undefined') {
    // Client-side: use window.location
    const params = new URLSearchParams(window.location.search)
    return params.get('demo') === 'true'
  }
  
  // Server-side: use provided searchParams
  if (searchParams) {
    if (typeof searchParams === 'string') {
      const params = new URLSearchParams(searchParams)
      return params.get('demo') === 'true'
    }
    return searchParams.get('demo') === 'true'
  }
  
  return false
}

/**
 * Get the demo parameter value from search params
 */
export function getDemoParam(searchParams?: URLSearchParams | string | null): string | null {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    return params.get('demo')
  }
  
  if (searchParams) {
    if (typeof searchParams === 'string') {
      const params = new URLSearchParams(searchParams)
      return params.get('demo')
    }
    return searchParams.get('demo')
  }
  
  return null
}

/**
 * Add demo parameter to a URL
 */
export function addDemoParam(url: string, isDemo: boolean = true): string {
  if (!isDemo) return url
  
  const urlObj = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')
  urlObj.searchParams.set('demo', 'true')
  return urlObj.toString()
}

/**
 * Preserve demo parameter when navigating
 * Returns search params string with demo=true if currently in demo mode
 */
export function preserveDemoParam(): string {
  if (typeof window !== 'undefined' && isDemoMode()) {
    return '?demo=true'
  }
  return ''
}




