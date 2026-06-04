// Shared validation + normalization for a board's optional video link
// (link_url). Used by BOTH the client upload/edit form (LightboxModal) and the
// server API (POST + PUT /api/boards) so the rules can never drift apart.
//
// Rules:
//   - nullable: null / undefined / empty / whitespace-only -> null (no link)
//   - trimmed (leading/trailing whitespace stripped)
//   - must start with http:// or https:// (case-insensitive)
//   - max 2048 characters (after trimming)

export const MAX_LINK_URL_LENGTH = 2048

export interface LinkUrlValidation {
  /** Normalized value to store: a trimmed URL string, or null for "no link". */
  value: string | null
  /** Human-readable reason the input was rejected, or null when valid. */
  error: string | null
}

/**
 * Validate and normalize a candidate board video link.
 * When `error` is non-null the input is invalid and `value` is null.
 */
export function validateLinkUrl(raw: unknown): LinkUrlValidation {
  if (raw === null || raw === undefined) return { value: null, error: null }
  if (typeof raw !== 'string') return { value: null, error: 'Invalid link.' }

  const trimmed = raw.trim()
  if (trimmed === '') return { value: null, error: null }

  if (trimmed.length > MAX_LINK_URL_LENGTH) {
    return { value: null, error: `Link must be ${MAX_LINK_URL_LENGTH} characters or fewer.` }
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return { value: null, error: 'Link must start with http:// or https://' }
  }
  return { value: trimmed, error: null }
}
