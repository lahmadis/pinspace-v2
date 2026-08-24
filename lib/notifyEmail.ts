/**
 * Operational notification recipient.
 *
 * This is the inbox that receives product/ops mail the platform generates on its
 * own — feedback submissions and account-deletion requests. It is deliberately
 * SEPARATE from PINSPACE_ADMIN_EMAILS, which is an authorization list deciding
 * who may call the admin routes. Conflating them would mean granting admin
 * rights to change where mail goes, or granting mail to everyone with admin.
 *
 * Falls back to the original hardcoded address when unset so notifications never
 * silently stop, and warns once at module load so a missing configuration is
 * visible in the server logs rather than discovered by absence.
 */

/** Recipient used when PINSPACE_NOTIFY_EMAIL is not configured. */
const FALLBACK_NOTIFY_EMAIL = 'slahmadi04@gmail.com'

const configured = process.env.PINSPACE_NOTIFY_EMAIL?.trim()

export const NOTIFY_EMAIL = configured || FALLBACK_NOTIFY_EMAIL

/** True when the address came from the environment rather than the fallback. */
export const NOTIFY_EMAIL_CONFIGURED = Boolean(configured)

if (!NOTIFY_EMAIL_CONFIGURED) {
  console.warn(
    `[notify] PINSPACE_NOTIFY_EMAIL is not configured — falling back to ${FALLBACK_NOTIFY_EMAIL}. ` +
    'Set it so operational mail does not depend on a hardcoded personal address.',
  )
}
