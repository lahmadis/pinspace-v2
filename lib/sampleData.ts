/**
 * Sample Data for Public Network and Galleries
 * 
 * This generates sample studios and boards that appear alongside real user-created data
 * in the public network and gallery views. This helps demonstrate the app's functionality
 * when there aren't many real studios yet.
 */

import { Board, Comment } from '@/types'

// ============================================================================
// SAMPLE STUDIO GENERATION
// ============================================================================

const DEPARTMENTS = ['Architecture', 'Interior Design', 'Industrial Design'] as const
const YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Masters'] as const
const SEMESTERS = ['Fall 2024', 'Spring 2025'] as const

const STUDIO_TEMPLATES = [
  { name: 'Urban Housing Studio', instructor: 'Prof. Sarah Chen' },
  { name: 'Sustainable Design Studio', instructor: 'Prof. James Park' },
  { name: 'Adaptive Reuse Studio', instructor: 'Prof. Maria Lopez' },
  { name: 'Parametric Design', instructor: 'Prof. David Kim' },
  { name: 'Waterfront Development', instructor: 'Prof. Emily Wong' },
  { name: 'Digital Fabrication Studio', instructor: 'Prof. Robert Chen' },
  { name: 'Environmental Systems Studio', instructor: 'Prof. Lisa Anderson' },
  { name: 'Historic Preservation Studio', instructor: 'Prof. Michael Brown' },
  { name: 'Landscape Architecture Studio', instructor: 'Prof. Jennifer Davis' },
  { name: 'Building Technology Studio', instructor: 'Prof. Christopher Wilson' },
]

const STUDENT_NAMES = [
  'Alex Johnson', 'Jordan Martinez', 'Taylor Chen', 'Morgan Williams',
  'Casey Brown', 'Riley Davis', 'Avery Garcia', 'Quinn Rodriguez',
  'Sage Thompson', 'River Anderson', 'Phoenix Lee', 'Blake Wilson',
  'Cameron Moore', 'Dakota Taylor', 'Emery Jackson', 'Finley White',
  'Harper Harris', 'Indigo Martin', 'Jasper Lewis', 'Kai Walker',
  'Lane Hall', 'Nova Young', 'Ocean King', 'Parker Wright',
  'Quinn Lopez', 'River Hill', 'Sky Green', 'Tatum Adams',
  'Willow Nelson', 'Zion Baker', 'Aria Patel', 'Eden Kim',
  'Luna Rodriguez', 'Orion Singh', 'Sage Williams', 'Jade Thompson'
]

const PROJECT_TITLES = [
  'Mixed-Use Residential Complex',
  'Sustainable Community Center',
  'Adaptive Reuse: Factory to Lofts',
  'Parametric Facade System',
  'Waterfront Cultural Center',
  'Affordable Housing Development',
  'Green Building Retrofit',
  'Computational Design Exploration',
  'Coastal Resilience Hub',
  'Urban Infill Project',
  'Net-Zero Energy Building',
  'Modular Housing System',
]

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#a855f7', '#d946ef', '#e11d48', '#dc2626'
]

// Default wall config for sample studios (zigzag layout with 5 walls)
function getDefaultWallConfig() {
  return {
    layoutType: 'zigzag',
    walls: [
      { height: 10, width: 20 }, // 20ft wide, 10ft tall
      { height: 10, width: 15 }, // 15ft wide, 10ft tall
      { height: 10, width: 20 }, // 20ft wide, 10ft tall
      { height: 10, width: 15 }, // 15ft wide, 10ft tall
      { height: 10, width: 20 }, // 20ft wide, 10ft tall
    ]
  }
}

// Generate sample studios: 10 studios per year (distributed across departments)
export function getSampleStudios() {
  const studios: Array<{
    id: string
    name: string
    label: string
    department: string
    instructor: string
    semester: string
    year: number | string
    memberCount: number
    count: number
    color: string
    url: string
    studioId: string
    wallConfig?: any
  }> = []

  YEARS.forEach((year, yearIdx) => {
    // Generate 10 studios per year, distributed across departments
    for (let i = 0; i < 10; i++) {
      const dept = DEPARTMENTS[i % DEPARTMENTS.length]
      const semester = SEMESTERS[i % SEMESTERS.length]
      const template = STUDIO_TEMPLATES[i % STUDIO_TEMPLATES.length]
      
      const yearNum = year === 'Masters' ? 'Masters' : parseInt(year.replace('Year ', ''))
      const studioId = `sample-studio-${year}-${dept}-${i}`
      
      studios.push({
        id: studioId,
        name: `${template.name} - ${year}`,
        label: `${template.name} - ${year}`,
        department: dept,
        instructor: template.instructor,
        semester: semester,
        year: yearNum,
        memberCount: 12, // Exactly 12 students per studio
        count: 12,
        color: '#6366f1',
        url: `/studio/${studioId}/view`,
        studioId: studioId,
        wallConfig: getDefaultWallConfig(), // Add zigzag wall config
      })
    }
  })

  return studios
}

// ============================================================================
// SAMPLE BOARD GENERATION
// ============================================================================

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash
}

function getArchitectureImageUrl(index: number, width: number, height: number, title: string): string {
  // Use Picsum Photos (Lorem Picsum) for reliable, real images
  // The seed parameter ensures deterministic images based on index
  // This provides real architectural/building images
  const seed = Math.abs(index) % 1000
  return `https://picsum.photos/seed/${seed}/${width}/${height}`
}

function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

function generateBoardPositions(count: number, wallCount: number = 5): Array<{
  wallIndex: number
  x: number
  y: number
  width: number
  height: number
  side: 'front' | 'back'
}> {
  const positions: Array<{
    wallIndex: number
    x: number
    y: number
    width: number
    height: number
    side: 'front' | 'back'
  }> = []
  
  const boardWidth = 0.15
  const boardHeight = 0.4 // Slightly smaller to fit more boards
  const spacingX = 0.15
  const spacingY = 0.12
  
  // Calculate how many boards per wall side
  const totalSides = wallCount * 2 // front and back for each wall
  const boardsPerSide = Math.floor(count / totalSides)
  const extraBoards = count % totalSides
  
  let boardIndex = 0
  
  // Distribute boards evenly across all walls and both sides
  for (let wallIndex = 0; wallIndex < wallCount; wallIndex++) {
    for (const side of ['front', 'back'] as const) {
      // Calculate how many boards for this specific wall side
      const sideIndex = wallIndex * 2 + (side === 'front' ? 0 : 1)
      const boardsForThisSide = boardsPerSide + (sideIndex < extraBoards ? 1 : 0)
      
      // Place boards in a grid on this wall side
      const boardsPerRow = 3 // 3 columns
      for (let i = 0; i < boardsForThisSide && boardIndex < count; i++) {
        const row = Math.floor(i / boardsPerRow)
        const col = i % boardsPerRow
        
        // Calculate position: center the grid, then place each board
        const totalWidth = boardsPerRow * boardWidth + (boardsPerRow - 1) * spacingX
        const startX = -totalWidth / 2 + boardWidth / 2
        const x = startX + col * (boardWidth + spacingX)
        
        // Distribute vertically (top to bottom)
        const maxRows = Math.ceil(boardsForThisSide / boardsPerRow)
        const totalHeight = maxRows * boardHeight + (maxRows - 1) * spacingY
        const startY = totalHeight / 2 - boardHeight / 2
        const y = startY - row * (boardHeight + spacingY)
        
        positions.push({
          wallIndex,
          x: Math.max(-0.45, Math.min(0.45, x)), // Clamp to safe bounds
          y: Math.max(-0.4, Math.min(0.4, y)),   // Clamp to safe bounds
          width: boardWidth,
          height: boardHeight,
          side
        })
        boardIndex++
      }
    }
  }
  
  return positions.slice(0, count)
}

// Generate sample boards for a studio (24 boards per studio for better distribution)
export function getSampleBoards(studioId: string): Board[] {
  // Check if this is a sample studio
  if (!studioId.startsWith('sample-studio-')) {
    return []
  }

  const STUDENTS_PER_STUDIO = 24 // Increased from 12 to ensure multiple boards on all walls
  const wallCount = 5
  const positions = generateBoardPositions(STUDENTS_PER_STUDIO, wallCount)
  
  // Use deterministic selection based on studioId for consistent data
  const studioHash = Math.abs(hashCode(studioId))
  
  return Array.from({ length: STUDENTS_PER_STUDIO }, (_, i) => {
    const studentName = STUDENT_NAMES[(studioHash + i) % STUDENT_NAMES.length]
    const title = PROJECT_TITLES[(studioHash + i) % PROJECT_TITLES.length]
    const position = positions[i] || { wallIndex: 0, x: 0, y: 0, width: 0.15, height: 0.6, side: 'front' as const }
    
    const physicalWidth = 36 // 3ft = 36 inches
    const physicalHeight = 72 // 6ft = 72 inches
    const aspectRatio = physicalHeight / physicalWidth
    
    const boardId = `sample-board-${studioId}-${i}`
    const imageIndex = Math.abs(hashCode(boardId))
    
    // Convert normalized positions (-0.5 to 0.5) to percentage format (0-100)
    // WallSystem expects: 0 = left/top, 50 = center, 100 = right/bottom
    // Formula: percentage = (normalized + 0.5) * 100
    const xPercent = (position.x + 0.5) * 100
    const yPercent = (position.y + 0.5) * 100
    
    // Width and height should stay as normalized (0-1), not percentage
    // WallSystem multiplies them by wall dimensions directly
    
    return {
      id: boardId,
      studioId: studioId,
      studentName: studentName,
      studentEmail: `${studentName.toLowerCase().replace(/\s+/g, '.')}@wit.edu`,
      title: title,
      description: `A comprehensive design project exploring ${title.toLowerCase()} in the context of contemporary architecture.`,
      thumbnailUrl: getArchitectureImageUrl(imageIndex, 800, 600, title),
      fullImageUrl: getArchitectureImageUrl(imageIndex, 1600, 1200, title),
      tags: ['studio', 'architecture', 'design'],
      uploadedAt: new Date('2024-10-15'),
      position: {
        wallIndex: position.wallIndex,
        x: xPercent, // 0-100 format (0 = left, 50 = center, 100 = right)
        y: yPercent, // 0-100 format (0 = top, 50 = center, 100 = bottom)
        width: position.width, // Keep as normalized 0-1
        height: position.height, // Keep as normalized 0-1
        side: position.side || 'front'
      },
      ownerId: `sample-user-${studentName.replace(/\s/g, '-').toLowerCase()}`,
      ownerName: studentName,
      ownerColor: COLORS[(studioHash + i) % COLORS.length],
      aspectRatio: aspectRatio,
      physicalWidth: physicalWidth,
      physicalHeight: physicalHeight,
      originalWidth: 1600,
      originalHeight: Math.round(1600 / aspectRatio)
    }
  })
}

// Get totals for sample data
export function getSampleTotals() {
  const studios = getSampleStudios()
  return {
    studios: studios.length,
    students: studios.reduce((sum, s) => sum + (s.memberCount || 0), 0)
  }
}

// ============================================================================
// SAMPLE COMMENT GENERATION
// ============================================================================

const COMMENT_TEMPLATES = [
  "This is excellent work! The concept is well thought out and the execution is strong.",
  "I really appreciate the attention to detail in this design. The material choices work well together.",
  "The spatial relationships here are interesting. Have you considered exploring this further?",
  "Great use of light and shadow in the renderings. It adds depth to the composition.",
  "This project demonstrates a strong understanding of site context. Well done!",
  "The model work is impressive. The level of craftsmanship really shows through.",
  "I think there's potential to develop this concept further. The foundation is solid.",
  "The presentation is clear and professional. Easy to understand the design intent.",
  "Interesting take on the program requirements. The solution is creative yet functional.",
  "The drawings communicate the design well. Good technical skill demonstrated here.",
  "This shows strong design thinking. I can see the research and development process.",
  "The use of materials and textures is thoughtful. Creates a nice visual hierarchy.",
  "Well executed project! The presentation quality enhances the work significantly.",
  "I appreciate the conceptual clarity here. The design intent comes through clearly.",
  "The scale relationships work well. Good sense of proportion throughout.",
  "Interesting approach to the brief. The solution addresses the constraints creatively.",
  "The craftsmanship in the models is excellent. Really elevates the work.",
  "Strong technical drawings. The details support the overall concept well.",
  "This project shows good development from initial concept to final presentation.",
  "The environmental considerations are well integrated. Sustainable design thinking is evident."
]

const INSTRUCTOR_NAMES = [
  'Prof. Sarah Chen',
  'Prof. James Park',
  'Prof. Maria Lopez',
  'Prof. David Kim',
  'Prof. Emily Wong',
  'Prof. Robert Chen',
  'Prof. Lisa Anderson',
  'Prof. Michael Brown',
  'Prof. Jennifer Davis',
  'Prof. Christopher Wilson'
]

// Generate sample comments for a board
export function getSampleComments(boardId: string): Comment[] {
  // Check if this is a sample board
  if (!boardId.startsWith('sample-board-')) {
    return []
  }

  // Use deterministic selection based on boardId for consistent data
  const boardHash = Math.abs(hashCode(boardId))
  const commentCount = 2 + (boardHash % 4) // 2-5 comments per board

  // Get the studio ID from board ID
  const studioIdMatch = boardId.match(/sample-board-(.+?)-/)
  const studioId = studioIdMatch ? studioIdMatch[1] : ''

  return Array.from({ length: commentCount }, (_, i) => {
    const commentIndex = (boardHash + i) % COMMENT_TEMPLATES.length
    const instructorIndex = (boardHash + i) % INSTRUCTOR_NAMES.length
    
    // Mix of instructors and peers
    const isInstructor = (boardHash + i) % 3 === 0 // ~33% instructor comments
    const authorName = isInstructor 
      ? INSTRUCTOR_NAMES[instructorIndex]
      : STUDENT_NAMES[(boardHash + i * 2) % STUDENT_NAMES.length]
    
    // Create timestamps that vary (days ago)
    const daysAgo = (boardHash + i) % 7 // 0-6 days ago
    const createdAt = new Date()
    createdAt.setDate(createdAt.getDate() - daysAgo)
    createdAt.setHours(10 + (boardHash + i) % 8) // Random hour during day
    createdAt.setMinutes((boardHash + i) % 60) // Random minute
    
    const commentId = `sample-comment-${boardId}-${i}`
    
    return {
      id: commentId,
      boardId: boardId,
      authorName: authorName,
      authorEmail: `${authorName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@wit.edu`,
      content: COMMENT_TEMPLATES[commentIndex],
      type: isInstructor ? 'peer' : 'peer', // Can be 'peer' or 'instructor'
      createdAt: createdAt.toISOString()
    }
  })
}
