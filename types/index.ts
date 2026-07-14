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
  /**
   * Client-only stable identifier used as a React key across the temp→real
   * id swap. Set on temp-board creation and carried over to the real board
   * in replaceTempBoardInState so the rendering component instance survives
   * the swap (otherwise an in-flight drag/resize gesture is torn down with
   * the unmounted temp instance). Never sent to or read from the server;
   * fall back to `id` when absent (boards loaded from the server have none).
   */
  localId?: string
  studioId: string
  workspaceId?: string  // alias used by some APIs; prefer studioId when both exist
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
    rotation?: number // Radians, around the board's center (Three.js rotation.z); 0 = unrotated
  }
  /** Convenience top-level mirror of `position.rotation` — also accepts the snake_case API shape. */
  position_rotation?: number
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
  // Absolute rendered board size in inches, independent of wall geometry. This
  // is the source of truth for board size; resizing a wall must NOT change it.
  // Resolved via getBoardSizeInches (lib/boardDimensions.ts) when absent.
  boardWidthIn?: number
  boardHeightIn?: number
  // Optional external video link (YouTube, Vimeo, Loom, …). The board image is
  // the cover; a non-null value renders a play badge in the 3D room and an
  // "Open video" button in the lightbox. Validated via lib/linkUrl.ts. Maps to
  // the boards.link_url column. Undefined / absent = no link.
  linkUrl?: string
}

export interface Comment {
  id: string
  boardId?: string
  authorId?: string
  authorName: string
  authorEmail?: string
  content: string
  type?: string
  createdAt: string
}

/**
 * Phase A.1 critique layer: an anchored, threaded comment on a board. Distinct
 * from the unanchored `Comment` (lightbox panel) — do not conflate. A root pin
 * carries anchorX/anchorY (fraction 0..1 of the image's intrinsic dimensions)
 * and parentId null; a reply carries parentId and null anchors. Maps to the
 * board_comments table (migration 028). Author is either an account user
 * (authorId) or a guest critic (guestTokenId) — never neither (DB CHECK).
 */
export interface BoardComment {
  id: string
  boardId: string
  roomId: string
  parentId: string | null
  anchorX: number | null
  anchorY: number | null
  body: string
  authorId: string | null
  guestTokenId: string | null
  authorName: string
  resolved: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Phase A.4 trace layer: one freehand stroke. color = CSS color; width = stroke
 * width as a FRACTION of the image width (so it scales with zoom like the
 * points); points = [x, y] pairs, each a fraction 0..1 of the image's intrinsic
 * dimensions (same anchor space as BoardComment).
 */
export interface TraceStroke {
  color: string
  width: number
  points: [number, number][]
}

/**
 * Phase A.4: a single author's drawing layer over a board. One row per
 * (board, author) — maps to the board_traces table (migration 028). Author is
 * an account user (authorId) or a guest critic (guestTokenId).
 */
export interface BoardTrace {
  id: string
  boardId: string
  roomId: string
  authorId: string | null
  guestTokenId: string | null
  authorName: string
  authorColor: string | null
  strokes: TraceStroke[]
  createdAt: string
  updatedAt: string
}

export interface WorkspaceMember {
  userId: string
  name: string
  role: 'instructor' | 'student'
  joinedAt: Date
}

export interface Institution {
  id: string
  name: string
  slug: string
  network_label?: string
  /** Email domains allowed to join workspaces for this institution. Empty array means no restriction. */
  domains?: string[]
  /** 'university' = school; 'firm' = e.g. architecture/design firm */
  type?: 'university' | 'firm'
  logo_url?: string
}

export interface Workspace {
  id: string
  name: string // "Studio 08 - Fall 2024"
  slug: string // for URL, e.g., "studio-08-fall-2024"
  type: 'class' | 'personal' | 'shared'
  createdBy: string // user ID of professor
  studioId: string // the shared 3D room ID
  members: WorkspaceMember[]
  inviteCode: string // random code for joining
  createdAt: Date
  isPublic: boolean // Whether visible in public network (default: false)
  publishedAt?: Date // When it was published to network
  instructor?: string // Instructor/professor name
  semester?: string // e.g., "Fall 2024"
  institutionId?: string
  institution?: Institution
  // Institution categorization (required when isPublic is true)
  networkMetadata?: {
    department: 'Aerospace Engineering' | 'Architecture' | 'Civil Engineering' | 'Electrical Engineering' | 'Industrial Design' | 'Interior Design' | 'Mechanical Engineering' | 'Robotics Engineering'
    year: 'Year 1' | 'Year 2' | 'Year 3' | 'Year 4' | 'Year 5' | 'Masters'
  }
  academicYear?: string
  isArchived: boolean
  archivedAt: string | null
  // Phase 6.2: a workspace contains 1+ rooms. Settings/dashboard/upload UIs
  // read these; other surfaces ignore them. Optional because not every API
  // shape returns them yet.
  rooms?: Room[]
}

export interface Room {
  id: string
  name: string
  displayOrder: number
  isPublished: boolean
  publishedAt: string | null
  createdAt: string | null
  /** Room-level wall color for the 3D studio. Defaults to 'grey' (the current look). */
  wallColor?: 'grey' | 'white'
  /** Returned by /api/workspaces/[id]; absent on PATCH/POST responses for a single room. */
  boardCount?: number
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

/** Table on the studio floor for displaying a 3D model. Position in inches (same as 3D scene). */
export interface FloorTable {
  id: string
  x: number
  z: number
  width: number  // inches (e.g. 24)
  depth: number // inches (e.g. 18)
  /** Rotation in radians around Y (0 = aligned with room). */
  rotation?: number
  boardId?: string // optional link to a board
  modelUrl?: string // GLB/GLTF URL for model on top
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