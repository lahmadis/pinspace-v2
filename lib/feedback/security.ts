import { createHmac } from 'node:crypto'

export const FEEDBACK_MESSAGE_MAX_LENGTH = 4000
export const FEEDBACK_PAGE_URL_MAX_LENGTH = 2048
const INVALID_URL_CHARACTERS = /[\u0000-\u001f\u007f\\]/

type FeedbackPayloadResult =
  | { ok: true; message: string; pageUrl: string | null }
  | { ok: false; error: string }

function isAllowedPageUrl(value: string): boolean {
  if (INVALID_URL_CHARACTERS.test(value)) return false
  if (value.startsWith('/') && !value.startsWith('//')) return true

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function parseFeedbackPayload(body: unknown): FeedbackPayloadResult {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const message = typeof record.message === 'string' ? record.message.trim() : ''
  if (!message) return { ok: false, error: 'Message is required' }
  if (message.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Message must be ${FEEDBACK_MESSAGE_MAX_LENGTH} characters or fewer` }
  }

  if (record.page_url == null || record.page_url === '') {
    return { ok: true, message, pageUrl: null }
  }
  if (typeof record.page_url !== 'string' || record.page_url.length > FEEDBACK_PAGE_URL_MAX_LENGTH) {
    return { ok: false, error: `Page URL must be ${FEEDBACK_PAGE_URL_MAX_LENGTH} characters or fewer` }
  }
  if (!isAllowedPageUrl(record.page_url)) {
    return { ok: false, error: 'Page URL must be a local path or an HTTP(S) URL' }
  }

  return { ok: true, message, pageUrl: record.page_url }
}

export function submitterHash(identifier: string, secret: string): string {
  return createHmac('sha256', secret).update(identifier).digest('hex')
}

export function feedbackSubmitterIdentifier(request: Request, userId: string | null): string {
  if (userId) return `user:${userId}`

  // Vercel overwrites the ordinary X-Forwarded-For header at its edge and
  // provides this platform-owned copy even when another proxy sits in front.
  // Never trust caller-controlled generic forwarding headers here.
  const vercelAddress = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
  const address = vercelAddress || 'unknown'
  return `ip:${address}`
}
