import { NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

export const revalidate = 60
export const dynamic = 'force-dynamic'

/** GET /api/institutions – list all institutions (public, no auth). */
export async function GET() {
  try {
    const supabase = supabaseServiceRole()
    const { data: institutions, error } = await supabase
      .from('institutions')
      .select('id, name, slug, network_label')
      .order('name')

    if (error) {
      console.error('Error fetching institutions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch institutions', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(institutions || [])
  } catch (error) {
    console.error('Error in GET /api/institutions:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: (error as Error).message },
      { status: 500 }
    )
  }
}
