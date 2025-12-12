// Core data types for PinSpace

export interface School {
  id: string
  name: string
  abbreviation: string
  location: string
  color?: string // For bubble visualization
}

export interface Year {
  id: string
  schoolId: string
  year: number // e.g., 1, 2, 3, 4, 5 (for grad)
  semester: 'Fall' | 'Spring'
  academicYear: string // e.g., "2023-2024"
}

export interface Studio {
  id: string
  yearId: string
  name: string
  instructor: string
  theme?: string
  studentCount: number
  // Gallery mode metadata
  department?: string
  year?: string
  boundingBox?: {
    width: number
    depth: number
  }
  galleryPosition?: {
    x: number
    z: number
  }
}

export interface Board {
  id: string
  studioId: string
  studentName: string
  studentEmail?: string
  title: string
  description?: string
  thumbnailUrl: string
  fullImageUrl: string
  tags?: string[]
  uploadedAt: Date
  comments?: Comment[]
  position?: { // For 3D room placement
    wallIndex: number
    x: number
    y: number
    width?: number  // Stored as 0-1 decimal of wall width
    height?: number // Stored as 0-1 decimal of wall height
    side?: 'front' | 'back' // Which side of the wall (defaults to 'front')
  }
  // Board ownership
  ownerId?: string      // User ID who created/owns this board
  ownerName?: string    // Display name for UI
  ownerColor?: string   // Hex color to visually distinguish owners
  // Original dimensions for proper aspect ratio
  originalWidth?: number   // Original image/PDF width in pixels
  originalHeight?: number  // Original image/PDF height in pixels
  aspectRatio?: number     // width / height
  // Physical dimensions in inches (for realistic sizing on walls)
  physicalWidth?: number   // Physical width in inches (e.g., 36 for a 3ft wide board)
  physicalHeight?: number  // Physical height in inches (e.g., 72 for a 6ft tall board)
}

export interface Comment {
  id: string
  boardId?: string
  authorName: string
  authorEmail?: string
  content: string
  type?: string
  createdAt: string
}

export interface WorkspaceMember {
  userId: string
  name: string
  role: 'instructor' | 'student'
  joinedAt: Date
}

export interface Workspace {
  id: string
  name: string // "Studio 08 - Fall 2024"
  slug: string // for URL, e.g., "studio-08-fall-2024"
  type: 'class' | 'personal' // for now just 'class'
  createdBy: string // user ID of professor
  studioId: string // the shared 3D room ID
  members: WorkspaceMember[]
  inviteCode: string // random code for joining
  createdAt: Date
  isPublic: boolean // Whether visible in public network (default: false)
  publishedAt?: Date // When it was published to network
  instructor?: string // Instructor/professor name
  semester?: string // e.g., "Fall 2024"
  // WIT-specific categorization (required when isPublic is true)
  networkMetadata?: {
    department: 'Architecture' | 'Interior Design' | 'Industrial Design'
    year: 'Year 1' | 'Year 2' | 'Year 3' | 'Year 4' | 'Masters'
  }
}

export interface CritSession {
  id: string
  studioId: string
  hostName: string
  hostEmail: string
  startTime: Date
  endTime?: Date
  participants: string[] // User IDs or emails
  activeBoardId?: string
}

// Navigation state types
export type ViewMode = 'landing' | 'network' | '3d-room' | 'board-detail'

export interface NetworkNode {
  id: string
  type: 'school' | 'year' | 'studio'
  data: School | Year | Studio
  x?: number
  y?: number
  children?: NetworkNode[]
}

export interface Room3DConfig {
  wallCount: number
  wallSpacing: number
  wallHeight: number
  wallWidth: number
  zigzagAngle: number
  cameraPosition: [number, number, number]
}
// ... your existing types ...

export interface WallDimensions {
  height: number // in feet
  width: number // in feet
}

export interface WallConfig {
  walls: WallDimensions[]
}

export const DEFAULT_WALL_CONFIG: WallConfig = {
  walls: [
    { height: 10, width: 8 },
    { height: 10, width: 8 },
    { height: 10, width: 8 },
    { height: 10, width: 8 }
  ]
}

export interface Avatar3D {
  color: string
  position: {
    x: number
    y: number
    z: number
  }
  rotation: number
}