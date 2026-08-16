/**
 * Placeholder strings that older upload paths wrote into boards.owner_name and
 * boards.student_name when they could not resolve a real display name. They are
 * stored values, not names, so every surface that renders an owner label has to
 * treat them as "unknown" rather than print them.
 *
 * Two upload paths produced them:
 *   - app/api/boards/route.ts fell back to 'User' (owner_name) and 'Anonymous'
 *     (student_name) whenever user_profiles.full_name was empty.
 *   - hooks/useBoardUpload.ts read Clerk-shaped `fullName`/`firstName` fields
 *     that do not exist on a Supabase user, so optimistic boards were labelled
 *     'Anonymous' unconditionally.
 *
 * Both are fixed going forward, but existing rows still carry these values.
 */
const PLACEHOLDER_NAMES = new Set(['anonymous', 'user', 'uploaded board', 'unknown'])

/**
 * Normalise a stored name field to a real display name, or '' when the value is
 * absent or a known placeholder. Callers decide what to show for '' — the 3D
 * room renders no plate at all rather than inventing a label.
 */
export function cleanDisplayName(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return ''
  return PLACEHOLDER_NAMES.has(trimmed.toLowerCase()) ? '' : trimmed
}
