const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function safeRedirectPath(
  value: string | null | undefined,
  fallback = '/dashboard'
): string {
  if (!value || value !== value.trim()) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  if (value.includes('\\') || CONTROL_CHARACTERS.test(value)) return fallback

  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || decoded.includes('\\') || CONTROL_CHARACTERS.test(decoded)) {
      return fallback
    }
  } catch {
    return fallback
  }

  return value
}
