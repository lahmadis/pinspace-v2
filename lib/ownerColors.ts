// Color palette for board owners
// Vibrant, distinct colors that work well on white boards
const OWNER_COLOR_PALETTE = [
  '#4444ff', // Blue
  '#ff4444', // Red
  '#44ff44', // Green
  '#ff44ff', // Magenta
  '#ffaa44', // Orange
  '#44ffff', // Cyan
  '#aa44ff', // Purple
  '#ff4488', // Pink
  '#88ff44', // Lime
  '#4488ff', // Sky Blue
  '#ff8844', // Coral
  '#44ff88', // Mint
]

// Generate a consistent color for a user based on their ID
export function generateOwnerColor(userId: string): string {
  // Simple hash function to get consistent color for same user
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash // Convert to 32bit integer
  }
  
  const index = Math.abs(hash) % OWNER_COLOR_PALETTE.length
  return OWNER_COLOR_PALETTE[index]
}

// Get a random color from palette (for new users without ID)
export function getRandomOwnerColor(): string {
  return OWNER_COLOR_PALETTE[Math.floor(Math.random() * OWNER_COLOR_PALETTE.length)]
}

// Get text color (white or black) based on background color for contrast
export function getContrastTextColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '')
  
  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)
  
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  
  // Return black for light backgrounds, white for dark
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

