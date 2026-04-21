import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

const ADMIN_EMAILS = (process.env.PINSPACE_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

function isAdmin(email: string | undefined): boolean {
  if (!email) return false
  return ADMIN_EMAILS.includes(email.toLowerCase())
}

interface TypeIssue {
  id: string
  title: string
  issue: string
  rawValue: unknown
  rawType: string
  parsedValue: number
  canConvert: boolean
}

interface WallIndexGroup {
  value: number | string | null
  type: string
  count: number
  boards: unknown[]
}

interface UpdateRecord {
  boardId: string
  title: string
  oldValue: unknown
  oldType: string
  newValue: number
  newType: string
}

interface ErrorRecord {
  boardId: string
  title?: string
  error: string
}

// Debug endpoint to check data types in database
export async function GET(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const workspaceId = searchParams.get('workspaceId') || searchParams.get('studioId')

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId or studioId required' }, { status: 400 })
    }

    // Fetch all boards with position data
    const { data: boards, error } = await supabase
      .from('boards')
      .select('id, title, position_wall_index, position_x, position_y, position_side')
      .eq('workspace_id', workspaceId)
      .order('position_wall_index', { ascending: true, nullsFirst: false })

    if (error) {
      console.error('Error fetching boards in check-types endpoint:', error)
      return NextResponse.json({ error: 'Failed to fetch boards' }, { status: 500 })
    }

    // Analyze types
    const typeAnalysis = {
      total: boards?.length || 0,
      byWallIndex: {} as Record<string, WallIndexGroup>,
      typeIssues: [] as TypeIssue[],
      typeCounts: {} as Record<string, number>
    }

    boards?.forEach(board => {
      const wallIndex = board.position_wall_index
      const type = typeof wallIndex

      // Count types
      const typeKey = wallIndex === null ? 'null' : type
      typeAnalysis.typeCounts[typeKey] = (typeAnalysis.typeCounts[typeKey] || 0) + 1

      // Group by wallIndex value
      const wallKey = wallIndex === null ? 'null' : String(wallIndex)
      if (!typeAnalysis.byWallIndex[wallKey]) {
        typeAnalysis.byWallIndex[wallKey] = {
          value: wallIndex,
          type: type,
          count: 0,
          boards: []
        }
      }
      typeAnalysis.byWallIndex[wallKey].count++
      typeAnalysis.byWallIndex[wallKey].boards.push({
        id: board.id,
        title: board.title,
        position_wall_index: board.position_wall_index,
        position_x: board.position_x,
        position_y: board.position_y,
        position_side: board.position_side,
        parseIntResult: wallIndex !== null ? parseInt(String(wallIndex), 10) : null,
        parseIntIsNaN: wallIndex !== null ? isNaN(parseInt(String(wallIndex), 10)) : null,
        rawType: typeof wallIndex,
        rawValue: wallIndex
      })

      // Check for type issues (should be number, not string)
      if (wallIndex !== null && type === 'string') {
        const parsed = parseInt(String(wallIndex), 10)
        typeAnalysis.typeIssues.push({
          id: board.id,
          title: board.title,
          issue: 'position_wall_index is stored as string',
          rawValue: wallIndex,
          rawType: type,
          parsedValue: parsed,
          canConvert: !isNaN(parsed)
        })
      }
    })

    // Get schema info (Supabase doesn't expose this easily, so we'll infer from data)
    const schemaInfo = {
      inferredType: typeAnalysis.typeCounts['number'] > 0 ? 'likely INTEGER or NUMERIC' :
                     typeAnalysis.typeCounts['string'] > 0 ? 'likely TEXT or VARCHAR' : 'unknown',
      recommendation: typeAnalysis.typeIssues.length > 0
        ? 'Some boards have string values. Consider migrating or the API should handle both types.'
        : 'All values are numbers. Type conversion in API should work fine.'
    }

    return NextResponse.json({
      summary: typeAnalysis,
      schemaInfo,
      detailed: typeAnalysis.byWallIndex,
      typeIssues: typeAnalysis.typeIssues,
      message: 'Use POST /api/debug/fix-types to convert string wallIndex values to numbers'
    })
  } catch (error) {
    console.error('Error in check-types endpoint:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// POST endpoint to fix type issues by updating string values to numbers
export async function POST(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { workspaceId, dryRun = true } = body

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    // Fetch boards with string wallIndex values
    const { data: boards, error: fetchError } = await supabase
      .from('boards')
      .select('id, title, position_wall_index')
      .eq('workspace_id', workspaceId)
      .not('position_wall_index', 'is', null)

    if (fetchError) {
      console.error('Error fetching boards in fix-types endpoint:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch boards' }, { status: 500 })
    }

    const updates: UpdateRecord[] = []
    const errors: ErrorRecord[] = []

    // Find boards with string values
    for (const board of boards || []) {
      const currentValue = board.position_wall_index
      const currentType = typeof currentValue

      if (currentType === 'string') {
        const numValue = parseInt(String(currentValue), 10)
        if (!isNaN(numValue)) {
          updates.push({
            boardId: board.id,
            title: board.title,
            oldValue: currentValue,
            oldType: currentType,
            newValue: numValue,
            newType: 'number'
          })

          if (!dryRun) {
            // Actually update the database
            const { error: updateError } = await supabase
              .from('boards')
              .update({ position_wall_index: numValue })
              .eq('id', board.id)

            if (updateError) {
              errors.push({
                boardId: board.id,
                error: updateError.message
              })
            }
          }
        } else {
          errors.push({
            boardId: board.id,
            title: board.title,
            error: `Cannot convert "${currentValue}" to number`
          })
        }
      }
    }

    return NextResponse.json({
      dryRun,
      totalBoards: boards?.length || 0,
      boardsToUpdate: updates.length,
      updates,
      errors,
      message: dryRun
        ? 'This was a dry run. Set dryRun: false to actually update the database.'
        : `${updates.length} boards updated successfully. ${errors.length} errors.`
    })
  } catch (error) {
    console.error('Error in fix-types endpoint:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
