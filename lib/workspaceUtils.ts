// Workspace utility functions

// Generate a random invite code (8 characters, URL-safe)
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Removed confusing chars
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
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
  return `workspace-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// Generate studio ID for workspace
export function generateStudioId(workspaceId: string): string {
  return `studio-${workspaceId.replace('workspace-', '')}`
}

