const INVITE_CODE_PATTERN = /^[A-Z0-9-]{6,128}$/

export function normalizeInviteCode(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().toUpperCase()
  return INVITE_CODE_PATTERN.test(normalized) ? normalized : ''
}

export function workspaceInviteMatches(
  workspaceType: string | null | undefined,
  storedCode: string | null | undefined,
  providedCode: unknown
): boolean {
  if (workspaceType === 'personal') return false

  const expected = normalizeInviteCode(storedCode)
  const provided = normalizeInviteCode(providedCode)
  return Boolean(expected && provided && expected === provided)
}
