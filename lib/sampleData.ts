/**
 * Sample Data for Public Network and Galleries
 * 
 * This generates sample studios and boards that appear alongside real user-created data
 * in the public network and gallery views. This helps demonstrate the app's functionality
 * when there aren't many real studios yet.
 */

import { Board } from '@/types'

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
  const colors = [
    { bg: '4a5568', text: 'ffffff' },
    { bg: '2d3748', text: 'ffffff' },
    { bg: '1a202c', text: 'ffffff' },
    { bg: '2c5282', text: 'ffffff' },
    { bg: '2c7a7b', text: 'ffffff' },
    { bg: '744210', text: 'ffffff' },
    { bg: '553c9a', text: 'ffffff' },
    { bg: '702459', text: 'ffffff' },
  ]
  const color = colors[Math.abs(index) % colors.length]
  const shortTitle = title.substring(0, 20).replace(/\s+/g, '+')
  return `https://placehold.co/${width}x${height}/${color.bg}/${color.text}?text=${encodeURIComponent(shortTitle)}`
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
  const boardHeight = 0.6
  const spacingX = 0.2
  const spacingY = 0.15
  
  const guaranteedBoards = wallCount * 2
  let boardIndex = 0
  
  // Place at least one board on front and back of each wall
  for (let wallIndex = 0; wallIndex < wallCount; wallIndex++) {
    positions.push({
      wallIndex,
      x: -0.3 + 0 * (boardWidth + spacingX) + boardWidth / 2,
      y: 0.2 - 0 * (boardHeight + spacingY) - boardHeight / 2,
      width: boardWidth,
      height: boardHeight,
      side: 'front'
    })
    boardIndex++
    
    positions.push({
      wallIndex,
      x: -0.3 + 0 * (boardWidth + spacingX) + boardWidth / 2,
      y: 0.2 - 0 * (boardHeight + spacingY) - boardHeight / 2,
      width: boardWidth,
      height: boardHeight,
      side: 'back'
    })
    boardIndex++
  }
  
  // Distribute remaining boards
  const remainingBoards = count - guaranteedBoards
  if (remainingBoards > 0) {
    const totalSides = wallCount * 2
    const boardsPerSide = Math.floor(remainingBoards / totalSides)
    const extraBoards = remainingBoards % totalSides
    
    for (let sideIndex = 0; sideIndex < totalSides && boardIndex < count; sideIndex++) {
      const wallIndex = Math.floor(sideIndex / 2)
      const side = (sideIndex % 2 === 0 ? 'front' : 'back') as 'front' | 'back'
      const boardsForThisSide = boardsPerSide + (sideIndex < extraBoards ? 1 : 0)
      
      const existingOnSide = positions.filter(p => p.wallIndex === wallIndex && p.side === side).length
      
      for (let i = 0; i < boardsForThisSide && boardIndex < count; i++) {
        const row = Math.floor((existingOnSide + i) / 2)
        const col = (existingOnSide + i) % 2
        
        positions.push({
          wallIndex,
          x: -0.3 + col * (boardWidth + spacingX) + boardWidth / 2,
          y: 0.2 - row * (boardHeight + spacingY) - boardHeight / 2,
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

// Generate sample boards for a studio (12 boards per studio)
export function getSampleBoards(studioId: string): Board[] {
  // Check if this is a sample studio
  if (!studioId.startsWith('sample-studio-')) {
    return []
  }

  const STUDENTS_PER_STUDIO = 12
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
