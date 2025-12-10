import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { wallIndex, x, y } = await request.json()
    const boardId = params.id

    if (wallIndex === undefined || x === undefined || y === undefined) {
      return NextResponse.json({ error: 'Missing position data' }, { status: 400 })
    }

    const dataPath = path.join(process.cwd(), 'lib', 'data', 'boards.json')
    
    if (!existsSync(dataPath)) {
      return NextResponse.json({ error: 'No boards found' }, { status: 404 })
    }

    const fileContent = await readFile(dataPath, 'utf-8')
    let boards = JSON.parse(fileContent)
    
    // Find and update board
    const boardIndex = boards.findIndex((b: any) => b.id === boardId)
    
    if (boardIndex === -1) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    boards[boardIndex].position = { wallIndex, x, y }
    
    await writeFile(dataPath, JSON.stringify(boards, null, 2))

    return NextResponse.json({ success: true, board: boards[boardIndex] })
  } catch (error) {
    console.error('Error updating position:', error)
    return NextResponse.json({ error: 'Failed to update position' }, { status: 500 })
  }
}









