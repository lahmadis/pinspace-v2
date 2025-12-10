import { School, Year, Studio, Board } from '@/types'

// Sample school data
export const schools: School[] = [
  {
    id: 'wentworth',
    name: 'Wentworth Institute of Technology',
    abbreviation: 'WIT',
    location: 'Boston, MA',
    color: '#6366f1'
  },
  {
    id: 'mit',
    name: 'Massachusetts Institute of Technology',
    abbreviation: 'MIT',
    location: 'Cambridge, MA',
    color: '#ec4899'
  },
  {
    id: 'harvard',
    name: 'Harvard Graduate School of Design',
    abbreviation: 'GSD',
    location: 'Cambridge, MA',
    color: '#8b5cf6'
  }
]

// Sample year data for Wentworth
export const years: Year[] = [
  {
    id: 'wentworth-y3-f23',
    schoolId: 'wentworth',
    year: 3,
    semester: 'Fall',
    academicYear: '2023-2024'
  },
  {
    id: 'wentworth-y3-s24',
    schoolId: 'wentworth',
    year: 3,
    semester: 'Spring',
    academicYear: '2023-2024'
  },
  {
    id: 'wentworth-y4-f23',
    schoolId: 'wentworth',
    year: 4,
    semester: 'Fall',
    academicYear: '2023-2024'
  }
]

// Sample studio data
export const studios: Studio[] = [
  {
    id: 'studio-a',
    yearId: 'wentworth-y3-f23',
    name: 'Urban Interventions',
    instructor: 'Prof. Sarah Chen',
    theme: 'Adaptive reuse in post-industrial landscapes',
    studentCount: 15
  },
  {
    id: 'studio-b',
    yearId: 'wentworth-y3-f23',
    name: 'Sustainable Housing',
    instructor: 'Prof. Michael Torres',
    theme: 'Net-zero residential design',
    studentCount: 12
  },
  {
    id: 'studio-c',
    yearId: 'wentworth-y4-f23',
    name: 'Civic Architecture',
    instructor: 'Prof. Lisa Wang',
    theme: 'Community centers for the 21st century',
    studentCount: 18
  }
]

// Sample board data
export const boards: Board[] = [
  {
    id: 'board-1',
    studioId: 'studio-a',
    studentName: 'Emma Rodriguez',
    title: 'Factory Reimagined: Cultural Hub',
    description: 'Converting a 1920s textile factory into a community arts center',
    thumbnailUrl: '/placeholder-board-1.jpg',
    fullImageUrl: '/placeholder-board-1-full.jpg',
    tags: ['adaptive reuse', 'industrial', 'cultural'],
    uploadedAt: new Date('2023-12-15'),
    position: { wallIndex: 0, x: 0, y: 0 },
    ownerId: 'sample-user-1',
    ownerName: 'Emma',
    ownerColor: '#4444ff'
  },
  {
    id: 'board-2',
    studioId: 'studio-a',
    studentName: 'James Park',
    title: 'Warehouse District: Mixed Use',
    description: 'Transforming waterfront warehouses into residential and retail spaces',
    thumbnailUrl: '/placeholder-board-2.jpg',
    fullImageUrl: '/placeholder-board-2-full.jpg',
    tags: ['waterfront', 'mixed-use', 'revitalization'],
    uploadedAt: new Date('2023-12-15'),
    position: { wallIndex: 0, x: 1, y: 0 },
    ownerId: 'sample-user-2',
    ownerName: 'James',
    ownerColor: '#ff4444'
  },
  {
    id: 'board-3',
    studioId: 'studio-a',
    studentName: 'Sofia Martinez',
    title: 'Power Plant Pavilion',
    description: 'Public pavilion within a decommissioned power plant',
    thumbnailUrl: '/placeholder-board-3.jpg',
    fullImageUrl: '/placeholder-board-3-full.jpg',
    tags: ['public space', 'infrastructure', 'landscape'],
    uploadedAt: new Date('2023-12-15'),
    position: { wallIndex: 1, x: 0, y: 0 },
    ownerId: 'sample-user-3',
    ownerName: 'Sofia',
    ownerColor: '#44ff44'
  },
  {
    id: 'board-4',
    studioId: 'studio-a',
    studentName: 'Alex Kim',
    title: 'Rail Yard Revival',
    description: 'Transit-oriented development at former rail maintenance facility',
    thumbnailUrl: '/placeholder-board-4.jpg',
    fullImageUrl: '/placeholder-board-4-full.jpg',
    tags: ['transit', 'TOD', 'connectivity'],
    uploadedAt: new Date('2023-12-15'),
    position: { wallIndex: 1, x: 1, y: 0 },
    ownerId: 'sample-user-4',
    ownerName: 'Alex',
    ownerColor: '#ff44ff'
  },
  {
    id: 'board-5',
    studioId: 'studio-a',
    studentName: 'Maya Johnson',
    title: 'Brewery Commons',
    description: 'Historic brewery transformed into maker spaces and housing',
    thumbnailUrl: '/placeholder-board-5.jpg',
    fullImageUrl: '/placeholder-board-5-full.jpg',
    tags: ['historic preservation', 'maker space', 'housing'],
    uploadedAt: new Date('2023-12-15'),
    position: { wallIndex: 2, x: 0, y: 0 },
    ownerId: 'sample-user-5',
    ownerName: 'Maya',
    ownerColor: '#ffaa44'
  },
  {
    id: 'board-6',
    studioId: 'studio-a',
    studentName: 'David Chen',
    title: 'Mill District Park',
    description: 'Paper mill site becomes urban ecological corridor',
    thumbnailUrl: '/placeholder-board-6.jpg',
    fullImageUrl: '/placeholder-board-6-full.jpg',
    tags: ['ecology', 'park', 'remediation'],
    uploadedAt: new Date('2023-12-15'),
    position: { wallIndex: 2, x: 1, y: 0 },
    ownerId: 'sample-user-6',
    ownerName: 'David',
    ownerColor: '#44ffff'
  }
]

// Helper functions to get related data
export const getYearsBySchool = (schoolId: string) => 
  years.filter(y => y.schoolId === schoolId)

export const getStudiosByYear = (yearId: string) => 
  studios.filter(s => s.yearId === yearId)

export const getBoardsByStudio = (studioId: string) => 
  boards.filter(b => b.studioId === studioId)