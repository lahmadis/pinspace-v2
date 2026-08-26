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

/**
 * Who a board is credited to. '' when nothing usable is stored — callers decide
 * what to render for that (the 3D room draws no label rather than inventing one).
 *
 * STUDENT_NAME WINS, and that ordering is the whole point of this function.
 * The two columns are not two guesses at the same fact:
 *
 *   student_name — the CURATED label. Free text. It is what LightboxModal's
 *                  author edit writes, what /api/boards/attribution writes, and
 *                  what app/api/boards/[id]/owner deliberately lets a caller
 *                  preserve on reassignment ("let a caller preserve a curated
 *                  label"). It exists precisely so a board can read under a
 *                  name that is not an account holder's.
 *   owner_name   — a SNAPSHOT of the owning account's display name, refreshed
 *                  from the live user_profiles row on every GET /api/boards.
 *
 * A relabel is a statement about this board; an account name is a fact about a
 * person. When they disagree, the deliberate one has to win, or the rename
 * silently does nothing for anyone who has a profile name.
 *
 * Four surfaces used to answer this question and they did not agree — 3D board
 * labels and hover cards preferred student_name while the roster, the 2D
 * archive and the presentation grid preferred owner_name. That is why renaming
 * an author in the lightbox moved the label under the board but left the same
 * person listed under their old name two views away.
 */
export function boardAuthorName(board: {
  studentName?: unknown
  ownerName?: unknown
}): string {
  return cleanDisplayName(board.studentName) || cleanDisplayName(board.ownerName)
}
