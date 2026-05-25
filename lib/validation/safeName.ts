// Shared validation for user-supplied display names (workspaces, rooms, member
// names, profile names, instructor labels). These values are stored raw and
// later rendered. React/SVG escape them on render, so this is defense-in-depth
// + input hygiene: keep angle brackets and control characters out of the DB so
// names stay safe across any future render path (emails, exports, etc.).
//
// Pure and side-effect free so it can be unit-tested directly.

export type SafeNameResult =
  | { ok: true; value: string }
  | { ok: false; error: string }

export interface SafeNameOptions {
  /** Maximum allowed length after trimming. */
  maxLength: number
  /** Human label interpolated into error messages, e.g. "Workspace name". */
  fieldLabel: string
}

// True if the string contains any C0 control char (0x00–0x1F) or DEL (0x7F):
// null bytes, newlines, tabs, etc. Done by char code so the source stays plain
// ASCII (no control bytes embedded in a regex literal).
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export function validateName(raw: unknown, opts: SafeNameOptions): SafeNameResult {
  const { maxLength, fieldLabel } = opts

  if (typeof raw !== 'string') {
    return { ok: false, error: `${fieldLabel} is required` }
  }

  const value = raw.trim()

  if (value.length === 0) {
    return { ok: false, error: `${fieldLabel} is required` }
  }
  if (value.length > maxLength) {
    return { ok: false, error: `${fieldLabel} must be ${maxLength} characters or fewer` }
  }
  if (/[<>]/.test(value)) {
    return { ok: false, error: `${fieldLabel} cannot contain < or >` }
  }
  if (hasControlChars(value)) {
    return { ok: false, error: `${fieldLabel} cannot contain control characters` }
  }

  return { ok: true, value }
}
