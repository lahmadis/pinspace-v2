/**
 * Throttle utility function
 * Limits how often a function can be called to at most once per delay period.
 * Use for events that should fire regularly but not excessively (e.g., mousemove during drag).
 * 
 * @param func - Function to throttle
 * @param delay - Minimum time between calls in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0
  let timeoutId: NodeJS.Timeout | null = null
  let lastArgs: Parameters<T> | null = null

  return function throttled(...args: Parameters<T>) {
    const now = Date.now()
    const timeSinceLastCall = now - lastCall

    // Store latest arguments for delayed execution
    lastArgs = args

    // If enough time has passed, call immediately
    if (timeSinceLastCall >= delay) {
      lastCall = now
      func(...args)
      lastArgs = null
    } else {
      // Schedule a call for when the delay period has elapsed
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          if (lastArgs) {
            lastCall = Date.now()
            func(...lastArgs)
            lastArgs = null
          }
          timeoutId = null
        }, delay - timeSinceLastCall)
      }
    }
  }
}

/**
 * Debounce utility function
 * Delays function execution until after a period of inactivity.
 * Use for events that should only fire after user stops doing something (e.g., resize, search input).
 * 
 * @param func - Function to debounce
 * @param delay - Time to wait after last call before executing, in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null

  return function debounced(...args: Parameters<T>) {
    // Clear any pending execution
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    // Schedule new execution
    timeoutId = setTimeout(() => {
      func(...args)
      timeoutId = null
    }, delay)
  }
}



