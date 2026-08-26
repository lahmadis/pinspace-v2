// Workspace utility functions

// Generate a cryptographically secure, URL-safe invite capability (~100 bits).
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Removed confusing chars
  const randomBytes = globalThis.crypto.getRandomValues(new Uint8Array(20))
  return Array.from(randomBytes, (byte) => chars[byte & 31]).join('')
}

// Convert workspace name to slug
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .substring(0, 50) // Limit length
}

// Generate unique workspace ID
export function generateWorkspaceId(): string {
  const randomBytes = globalThis.crypto.getRandomValues(new Uint8Array(8))
  const suffix = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `workspace-${Date.now()}-${suffix}`
}

// Generate studio ID for workspace
export function generateStudioId(workspaceId: string): string {
  return `studio-${workspaceId.replace('workspace-', '')}`
}
