import { NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

const YEARS = [
  { year: 'Year 1', slug: 'year-1' },
  { year: 'Year 2', slug: 'year-2' },
  { year: 'Year 3', slug: 'year-3' },
  { year: 'Year 4', slug: 'year-4' },
  { year: 'Masters', slug: 'masters' },
]

function slugToDept(slug: string) {
  if (slug === 'architecture') return 'Architecture'
  if (slug === 'interior-design') return 'Interior Design'
  if (slug === 'industrial-design') return 'Industrial Design'
  return null
}

export async function GET(
  _req: Request,
  { params }: { params: { department: string } }
) {
  try {
    const deptSlug = params.department
    const deptName = slugToDept(deptSlug)
    if (!deptName) {
      return NextResponse.json({ error: 'Invalid department' }, { status: 400 })
    }

    // Use service role to bypass RLS for public endpoint
    const supabase = supabaseServiceRole()
    
    // Fetch public workspaces for this department
    const { data: publicWorkspaces, error } = await supabase
      .from('workspaces')
      .select('network_metadata')
      .eq('is_public', true)
      .not('published_at', 'is', null)
      .eq('network_metadata->>department', deptName)

    if (error) {
      console.error('Error fetching workspaces:', error)
      return NextResponse.json({ error: 'Failed to fetch years', details: error.message }, { status: 500 })
    }

    // Count studios per year
    const years = YEARS.map(y => {
      const count = (publicWorkspaces || []).filter(w => {
        const year = w.network_metadata?.year
        return year === y.year || (typeof year === 'string' && year.includes(y.year.replace('Year ', '')))
      }).length
      return { ...y, studioCount: count }
    })

    return NextResponse.json(years)
  } catch (error) {
    console.error('Error fetching years:', error)
    return NextResponse.json({ error: 'Failed to fetch years', details: (error as Error).message }, { status: 500 })
  }
}







