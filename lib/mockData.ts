/**
 * Mock Data for Demo Mode
 * 
 * Wentworth Institute of Technology - Sample Architecture Studio Data
 * Used when ?demo=true is in the URL
 */

import { Board } from '@/types'

// ============================================================================
// WENTWORTH INSTITUTE OF TECHNOLOGY - MOCK DATA
// ============================================================================

export interface DemoStudio {
  id: string
  name: string
  instructor: string
  semester: string
  department: 'Architecture' | 'Interior Design' | 'Industrial Design'
  year: 'Year 1' | 'Year 2' | 'Year 3' | 'Year 4' | 'Masters'
  studentCount: number
  description: string
}

export interface DemoBoard {
  id: string
  studioId: string
  studentName: string
  studentEmail: string
  title: string
  description: string
  thumbnailUrl: string
  fullImageUrl: string
  tags: string[]
  uploadedAt: string
  position: {
    wallIndex: number
    x: number
    y: number
    width: number
    height: number
    side?: 'front' | 'back'
  }
  ownerId: string
  ownerName: string
  ownerColor: string
  aspectRatio: number
  physicalWidth: number
  physicalHeight: number
  originalWidth: number
  originalHeight: number
}

export interface DemoComment {
  id: string
  boardId: string
  authorName: string
  authorEmail: string
  content: string
  type: string
  createdAt: string
  authorId: string
}

// ============================================================================
// STUDIOS DATA
// ============================================================================

const STUDIO_TEMPLATES = [
  {
    name: 'Urban Housing Studio',
    instructor: 'Prof. Sarah Chen',
    description: 'Exploring sustainable urban housing solutions and community integration.'
  },
  {
    name: 'Sustainable Design Studio',
    instructor: 'Prof. James Park',
    description: 'Focus on environmental responsibility and energy-efficient building design.'
  },
  {
    name: 'Adaptive Reuse Studio',
    instructor: 'Prof. Maria Lopez',
    description: 'Transforming existing structures for new purposes and contemporary needs.'
  },
  {
    name: 'Parametric Design',
    instructor: 'Prof. David Kim',
    description: 'Advanced computational design methods and algorithmic architecture.'
  },
  {
    name: 'Waterfront Development',
    instructor: 'Prof. Emily Wong',
    description: 'Designing resilient waterfront communities and coastal architecture.'
  }
]

const SEMESTERS = [
  { id: 'fall-2023', name: 'Fall 2023', startDate: '2023-09-01', endDate: '2023-12-15' },
  { id: 'spring-2024', name: 'Spring 2024', startDate: '2024-01-15', endDate: '2024-05-01' },
  { id: 'fall-2024', name: 'Fall 2024', startDate: '2024-09-01', endDate: '2024-12-15' },
  { id: 'spring-2025', name: 'Spring 2025', startDate: '2025-01-15', endDate: '2025-05-01' }
]

const DEPARTMENTS: ('Architecture' | 'Interior Design' | 'Industrial Design')[] = ['Architecture', 'Interior Design', 'Industrial Design']
const YEARS: ('Year 1' | 'Year 2' | 'Year 3' | 'Year 4' | 'Masters')[] = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Masters']

// Additional studio templates to have enough for 10 per department
const ADDITIONAL_STUDIO_TEMPLATES = [
  {
    name: 'Digital Fabrication Studio',
    instructor: 'Prof. Robert Chen',
    description: 'Exploring advanced manufacturing techniques and digital design workflows.'
  },
  {
    name: 'Environmental Systems Studio',
    instructor: 'Prof. Lisa Anderson',
    description: 'Focus on building performance, energy systems, and environmental integration.'
  },
  {
    name: 'Historic Preservation Studio',
    instructor: 'Prof. Michael Brown',
    description: 'Conservation and adaptive reuse of historic structures and sites.'
  },
  {
    name: 'Landscape Architecture Studio',
    instructor: 'Prof. Jennifer Davis',
    description: 'Designing outdoor spaces and integrating landscape with built environment.'
  },
  {
    name: 'Building Technology Studio',
    instructor: 'Prof. Christopher Wilson',
    description: 'Advanced construction methods, materials, and structural systems.'
  }
]

const ALL_STUDIO_TEMPLATES = [...STUDIO_TEMPLATES, ...ADDITIONAL_STUDIO_TEMPLATES]

// Generate studios: 10 studios per year per department (total, not per semester)
// This means for Architecture Year 1, there will be 10 studios total across all semesters
export const DEMO_STUDIOS: DemoStudio[] = DEPARTMENTS.flatMap((department) =>
  YEARS.flatMap((year) =>
    Array.from({ length: 10 }, (_, studioIdx) => {
      // Distribute studios across semesters (2-3 per semester)
      const semester = SEMESTERS[Math.floor(studioIdx / 3) % SEMESTERS.length]
      const template = ALL_STUDIO_TEMPLATES[studioIdx % ALL_STUDIO_TEMPLATES.length]
      
      return {
        id: `demo-studio-${semester.id}-${department}-${year}-${studioIdx}`,
        name: `${template.name} - ${year}`,
        instructor: template.instructor,
        semester: semester.name,
        department: department,
        year: year,
        studentCount: 15 + Math.floor(Math.random() * 6), // 15-20 students
        description: template.description
      }
    })
  )
)

// ============================================================================
// PROJECT TITLES AND DESCRIPTIONS
// ============================================================================

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
  'Historic Preservation Study',
  'Biomimetic Structure',
  'Transit-Oriented Development'
]

const PROJECT_DESCRIPTIONS = [
  'A comprehensive design exploring the integration of residential and commercial spaces in urban environments.',
  'Focus on sustainable materials and passive design strategies for community engagement.',
  'Transformation of industrial heritage into contemporary living spaces while preserving architectural character.',
  'Exploration of algorithmic design processes and digital fabrication techniques.',
  'Resilient design addressing climate change and sea-level rise in coastal communities.',
  'Innovative approaches to affordable housing with emphasis on quality and sustainability.',
  'Energy-efficient retrofit strategies for existing building stock.',
  'Computational methods for generating complex architectural forms.',
  'Community-focused design for waterfront resilience and adaptation.',
  'Dense urban development maximizing limited site potential.',
  'Achieving net-zero energy through integrated design strategies.',
  'Flexible and adaptable housing solutions for changing needs.',
  'Sensitive approach to preserving and enhancing historic structures.',
  'Nature-inspired design principles applied to architectural systems.',
  'Development patterns centered around public transportation infrastructure.'
]

// ============================================================================
// STUDENT NAMES
// ============================================================================

const STUDENT_NAMES = [
  'Alex Johnson', 'Jordan Martinez', 'Taylor Chen', 'Morgan Williams',
  'Casey Brown', 'Riley Davis', 'Avery Garcia', 'Quinn Rodriguez',
  'Sage Thompson', 'River Anderson', 'Phoenix Lee', 'Blake Wilson',
  'Cameron Moore', 'Dakota Taylor', 'Emery Jackson', 'Finley White',
  'Harper Harris', 'Indigo Martin', 'Jasper Lewis', 'Kai Walker',
  'Lane Hall', 'Nova Young', 'Ocean King', 'Parker Wright',
  'Quinn Lopez', 'River Hill', 'Sky Green', 'Tatum Adams',
  'Willow Nelson', 'Zion Baker'
]

// ============================================================================
// COMMENTS TEMPLATES
// ============================================================================

const COMMENT_TEMPLATES = {
  professor: [
    'Strong spatial concept. Consider the entry sequence more carefully and how visitors will experience the threshold.',
    'Excellent materiality. The transparency creates a beautiful dialogue between interior and exterior spaces.',
    'The structural system is well-articulated. Have you considered seismic performance in this region?',
    'Great attention to detail in the facade design. Think about thermal performance and solar orientation.',
    'This section drawing is very clear. Can you develop the roof detail further to show waterproofing?',
    'Interesting programmatic organization. How does circulation connect the public and private zones?',
    'The site analysis is thorough. Now translate these findings more directly into your design decisions.',
    'Beautiful renderings. Make sure the scale and proportion are consistent across all views.',
    'The sustainability strategy is promising. Quantify the energy performance to support your claims.',
    'Consider accessibility throughout. How do people of all abilities move through this space?'
  ],
  peer: [
    'Love the material choices! The wood and concrete create a really nice contrast.',
    'The axonometric drawing is super clear - really helps understand the spatial relationships.',
    'Really compelling form. How did you arrive at this geometry?',
    'The lighting in your rendering is beautiful. What software did you use?',
    'This is such a thoughtful response to the site. The views you\'ve captured are perfect.',
    'The texture mapping on your model is excellent. Very realistic materials.',
    'I appreciate how you\'ve integrated landscape and building. They feel like one unified design.',
    'The color palette is very sophisticated. Much more subtle than most of our projects.',
    'Your diagrams are always so clear. The parti is immediately readable.',
    'The physical model photographs are stunning. Great composition and lighting.'
  ],
  question: [
    'How does this design respond to the site\'s historical context? Are there any precedents?',
    'What informed your choice of materials? Are they locally sourced?',
    'Can you explain the structural system in more detail? Is it steel or concrete frame?',
    'How does the building perform in different seasons? Have you studied solar angles?',
    'What is the approximate square footage? How does this compare to the program requirements?',
    'How does this design address issues of equity and accessibility in the community?',
    'What inspired this formal language? I see references to other architects - which ones?',
    'How do you envision the construction sequence? What would be built first?',
    'What is the budget per square foot? Is this feasible for the client?',
    'How does your design respond to climate change and rising sea levels?'
  ]
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

function generateEmail(name: string): string {
  const normalized = name.toLowerCase().replace(/\s+/g, '.')
  return `${normalized}@wit.edu`
}

function generateDateInRange(startDate: string, endDate: string): string {
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  const random = new Date(start + Math.random() * (end - start))
  return random.toISOString()
}

// Hash function for deterministic image selection
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash
}

// Use a reliable placeholder service with architecture-themed colors
// This ensures images always load without authentication issues
function getArchitectureImageUrl(index: number, width: number, height: number, title: string): string {
  // Create deterministic color and pattern based on index
  const colors = [
    { bg: '4a5568', text: 'ffffff' }, // Dark gray - modern
    { bg: '2d3748', text: 'ffffff' }, // Charcoal - contemporary
    { bg: '1a202c', text: 'ffffff' }, // Near black - sleek
    { bg: '2c5282', text: 'ffffff' }, // Blue - professional
    { bg: '2c7a7b', text: 'ffffff' }, // Teal - sustainable
    { bg: '744210', text: 'ffffff' }, // Brown - natural materials
    { bg: '553c9a', text: 'ffffff' }, // Purple - innovative
    { bg: '702459', text: 'ffffff' }, // Maroon - traditional
    { bg: '742a2a', text: 'ffffff' }, // Dark red - bold
    { bg: '1a365d', text: 'ffffff' }, // Navy - classic
  ]
  const color = colors[Math.abs(index) % colors.length]
  const shortTitle = title.substring(0, 20).replace(/\s+/g, '+')
  // Use placeholder.com - very reliable, no auth needed
  return `https://placehold.co/${width}x${height}/${color.bg}/${color.text}?text=${encodeURIComponent(shortTitle)}`
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#a855f7', '#d946ef', '#e11d48', '#dc2626'
]

// ============================================================================
// GENERATE BOARDS
// ============================================================================

// Generate board positions for a studio (distributed across all walls, both sides)
// Gallery studios have 5 walls in zigzag layout
// GUARANTEES: Every wall gets at least one board on front AND back
function generateBoardPositions(count: number, wallCount: number = 5): Array<{ wallIndex: number; x: number; y: number; width: number; height: number; side: 'front' | 'back' }> {
  const positions: Array<{ wallIndex: number; x: number; y: number; width: number; height: number; side: 'front' | 'back' }> = []
  
  // Board dimensions in normalized units (relative to wall)
  // Boards are 3ft wide x 6ft tall, walls are typically 20ft wide x 10ft tall
  const boardWidth = 0.15 // 3ft / 20ft = 0.15
  const boardHeight = 0.6 // 6ft / 10ft = 0.6
  const spacingX = 0.2 // More spacing for larger boards
  const spacingY = 0.15
  
  // Step 1: Guarantee at least one board on front and back of each wall
  // This uses 2 * wallCount boards (e.g., 10 boards for 5 walls)
  const guaranteedBoards = wallCount * 2
  let boardIndex = 0
  
  for (let wallIndex = 0; wallIndex < wallCount; wallIndex++) {
    // Place at least one board on front of each wall
    positions.push({
      wallIndex,
      x: -0.3 + 0 * (boardWidth + spacingX) + boardWidth / 2,
      y: 0.2 - 0 * (boardHeight + spacingY) - boardHeight / 2,
      width: boardWidth,
      height: boardHeight,
      side: 'front'
    })
    boardIndex++
    
    // Place at least one board on back of each wall
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
  
  // Step 2: Distribute remaining boards evenly across all sides
  const remainingBoards = count - guaranteedBoards
  if (remainingBoards > 0) {
    const totalSides = wallCount * 2
    const boardsPerSide = Math.floor(remainingBoards / totalSides)
    const extraBoards = remainingBoards % totalSides
    
    // Distribute boards evenly
    for (let sideIndex = 0; sideIndex < totalSides && boardIndex < count; sideIndex++) {
      const wallIndex = Math.floor(sideIndex / 2)
      const side = (sideIndex % 2 === 0 ? 'front' : 'back') as 'front' | 'back'
      const boardsForThisSide = boardsPerSide + (sideIndex < extraBoards ? 1 : 0)
      
      // Find how many boards are already on this side
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
  
  return positions.slice(0, count) // Ensure we don't exceed count
}

export const DEMO_BOARDS: DemoBoard[] = DEMO_STUDIOS.flatMap(studio => {
  const boardCount = studio.studentCount
  // Gallery studios have 5 walls in zigzag layout
  const wallCount = 5
  const positions = generateBoardPositions(boardCount, wallCount)
  
  return Array.from({ length: boardCount }, (_, i) => {
    const studentName = getRandomItem(STUDENT_NAMES)
    const title = getRandomItem(PROJECT_TITLES)
    const description = getRandomItem(PROJECT_DESCRIPTIONS)
    const position = positions[i] || { wallIndex: 0, x: 0, y: 0, width: 0.15, height: 0.6, side: 'front' as const }
    
    // Boards are 3ft wide by 6ft long (36 inches by 72 inches)
    const physicalWidth = 36 // 3ft = 36 inches
    const physicalHeight = 72 // 6ft = 72 inches
    const aspectRatio = physicalHeight / physicalWidth // 2.0 (6ft / 3ft)
    
    const boardId = `demo-board-${studio.id}-${i}`
    // Use real architecture images from Unsplash
    // Deterministic selection based on boardId for consistent images per board
    const imageIndex = Math.abs(hashCode(boardId))
    
    return {
      id: boardId,
      studioId: studio.id,
      studentName,
      studentEmail: generateEmail(studentName),
      title,
      description,
      // Use reliable images from Picsum Photos
      thumbnailUrl: getArchitectureImageUrl(imageIndex, 800, 600, title),
      fullImageUrl: getArchitectureImageUrl(imageIndex, 1600, 1200, title),
      tags: [studio.department.toLowerCase(), 'studio', getRandomItem(['sustainable', 'urban', 'contemporary', 'innovative'])],
      uploadedAt: generateDateInRange(
        SEMESTERS.find(s => s.name === studio.semester)!.startDate,
        SEMESTERS.find(s => s.name === studio.semester)!.endDate
      ),
      position,
      ownerId: `demo-user-${studentName.replace(/\s/g, '-').toLowerCase()}`,
      ownerName: studentName,
      ownerColor: getRandomItem(COLORS),
      aspectRatio,
      physicalWidth,
      physicalHeight,
      originalWidth: 1600,
      originalHeight: Math.round(1600 / aspectRatio)
    }
  })
})

// ============================================================================
// GENERATE COMMENTS
// ============================================================================

export const DEMO_COMMENTS: DemoComment[] = DEMO_BOARDS.flatMap(board => {
  const commentCount = 2 + Math.floor(Math.random() * 3) // 2-4 comments per board
  const comments: DemoComment[] = []
  
  for (let i = 0; i < commentCount; i++) {
    const types: ('professor' | 'peer' | 'question')[] = ['professor', 'peer', 'question']
    const commentType: 'professor' | 'peer' | 'question' = i === 0 ? 'professor' : getRandomItem(types)
    
    const studio = DEMO_STUDIOS.find(s => s.id === board.studioId)!
    const authorName = commentType === 'professor' 
      ? studio.instructor
      : getRandomItem(STUDENT_NAMES.filter(name => name !== board.studentName))
    
    // Generate comment timestamp after board upload
    const boardDate = new Date(board.uploadedAt).getTime()
    const maxDate = boardDate + 14 * 24 * 60 * 60 * 1000 // Up to 2 weeks after
    const commentDate = new Date(boardDate + Math.random() * (maxDate - boardDate))
    
    comments.push({
      id: `demo-comment-${board.id}-${i}`,
      boardId: board.id,
      authorName,
      authorEmail: generateEmail(authorName),
      content: getRandomItem(COMMENT_TEMPLATES[commentType]),
      type: commentType,
      createdAt: commentDate.toISOString(),
      authorId: `demo-user-${authorName.replace(/\s/g, '-').toLowerCase()}`
    })
  }
  
  return comments
})

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Get all demo studios formatted for the explore API
 */
export function getDemoStudios() {
  return DEMO_STUDIOS.map(studio => ({
    id: studio.id,
    name: studio.name,
    label: studio.name,
    department: studio.department,
    instructor: studio.instructor,
    semester: studio.semester,
    year: studio.year === 'Masters' ? 'Masters' : parseInt(studio.year.replace('Year ', '')),
    memberCount: studio.studentCount,
    count: studio.studentCount,
    color: '#6366f1',
    url: `/studio/${studio.id}/view?demo=true`,
    studioId: studio.id
  }))
}

/**
 * Get demo studio by ID
 */
export function getDemoStudioById(id: string): DemoStudio | undefined {
  return DEMO_STUDIOS.find(s => s.id === id)
}

/**
 * Alias for getDemoStudioById (for compatibility)
 */
export const getStudioById = getDemoStudioById

/**
 * Get all boards for a demo studio
 */
export function getDemoBoards(studioId: string): DemoBoard[] {
  return DEMO_BOARDS.filter(b => b.studioId === studioId)
}

/**
 * Alias for getDemoBoards (for compatibility)
 */
export const getBoardsByStudio = getDemoBoards

/**
 * Transform demo board to Board format
 */
export function transformDemoBoard(demoBoard: DemoBoard): Board {
  const comments = DEMO_COMMENTS
    .filter(c => c.boardId === demoBoard.id)
    .map(c => ({
      id: c.id,
      boardId: c.boardId,
      content: c.content,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      type: c.type,
      createdAt: c.createdAt
    }))
  
  return {
    id: demoBoard.id,
    studioId: demoBoard.studioId,
    studentName: demoBoard.studentName,
    studentEmail: demoBoard.studentEmail,
    title: demoBoard.title,
    description: demoBoard.description,
    thumbnailUrl: demoBoard.thumbnailUrl,
    fullImageUrl: demoBoard.fullImageUrl,
    tags: demoBoard.tags,
    uploadedAt: new Date(demoBoard.uploadedAt),
    position: {
      ...demoBoard.position,
      side: demoBoard.position.side || 'front'
    },
    ownerId: demoBoard.ownerId,
    ownerName: demoBoard.ownerName,
    ownerColor: demoBoard.ownerColor,
    aspectRatio: demoBoard.aspectRatio,
    physicalWidth: demoBoard.physicalWidth,
    physicalHeight: demoBoard.physicalHeight,
    originalWidth: demoBoard.originalWidth,
    originalHeight: demoBoard.originalHeight,
    comments
  }
}

/**
 * Get totals for demo data
 */
export function getDemoTotals() {
  return {
    studios: DEMO_STUDIOS.length,
    students: DEMO_STUDIOS.reduce((sum, s) => sum + s.studentCount, 0)
  }
}

/**
 * Get all demo schools (for network view)
 */
export function getSchools(): DemoSchool[] {
  return [{
    id: 'wentworth',
    name: 'Wentworth Institute of Technology',
    abbreviation: 'WIT',
    color: '#6366f1',
    location: 'Boston, MA'
  }]
}

/**
 * Get years for a demo school
 */
export function getYearsBySchool(schoolId: string): Array<{ id: string; year: number | string; semester: string }> {
  if (schoolId !== 'wentworth') return []
  
  // Get unique year/semester combinations from DEMO_STUDIOS
  const yearSemesterMap = new Map<string, { id: string; year: number | string; semester: string }>()
  
  DEMO_STUDIOS.forEach(studio => {
    const year = studio.year
    const semester = studio.semester
    const key = `${year}-${semester}`
    
    if (!yearSemesterMap.has(key)) {
      const yearId = `year-${year}-${semester}`
      yearSemesterMap.set(key, {
        id: yearId,
        year: typeof year === 'string' && year.includes('Year ') 
          ? parseInt(year.replace('Year ', '')) 
          : year === 'Masters' ? 'Masters' : year,
        semester
      })
    }
  })
  
  return Array.from(yearSemesterMap.values())
}

/**
 * Get studios for a specific year
 */
export function getStudiosByYear(yearId: string): DemoStudio[] {
  // Parse yearId format: "year-Year 1-Fall 2023" or similar
  const match = yearId.match(/year-(.+?)-(.+)/)
  if (!match) return []
  
  const yearStr = match[1]
  const semester = match[2]
  
  return DEMO_STUDIOS.filter(studio => {
    const studioYear = typeof studio.year === 'string' ? studio.year : `Year ${studio.year}`
    return studioYear === yearStr && studio.semester === semester
  })
}

/**
 * Export DemoSchool type (compatible with School type)
 */
export interface DemoSchool {
  id: string
  name: string
  abbreviation: string
  color: string
  location: string
}
