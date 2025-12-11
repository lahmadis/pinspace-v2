import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

// GET /api/boards/[id]/comments - Get all comments for a board
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id
    const dataPath = path.join(process.cwd(), 'lib', 'data', 'boards.json')

    if (!existsSync(dataPath)) {
      return NextResponse.json({ comments: [] })
    }

    const fileContent = await readFile(dataPath, 'utf-8')
    const allBoards = JSON.parse(fileContent)
    
    const board = allBoards.find((b: any) => b.id === boardId)
    
    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // Transform comments to new format (support both old and new formats)
    const comments = (board.comments || []).map((comment: any) => {
      // If already in new format, return as-is
      if (comment.authorName && comment.content && comment.createdAt) {
        return comment
      }
      // Transform old format to new format
      return {
        id: comment.id,
        boardId: boardId,
        authorName: comment.author || 'Anonymous',
        content: comment.text || '',
        createdAt: comment.timestamp || comment.createdAt || new Date().toISOString()
      }
    })
    
    console.log(`📖 [Comments API] GET - Board ${boardId} has ${comments.length} comments`)

    return NextResponse.json({ comments })
  } catch (error) {
    console.error('Error fetching comments:', error)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }
}

// POST /api/boards/[id]/comments - Add a new comment to a board
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id
    const { content, authorName } = await request.json()

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 })
    }

    const dataPath = path.join(process.cwd(), 'lib', 'data', 'boards.json')

    if (!existsSync(dataPath)) {
      return NextResponse.json({ error: 'Data file not found' }, { status: 404 })
    }

    const fileContent = await readFile(dataPath, 'utf-8')
    const allBoards = JSON.parse(fileContent)
    
    const boardIndex = allBoards.findIndex((b: any) => b.id === boardId)
    
    if (boardIndex === -1) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // Create new comment with new format
    const newComment = {
      id: `comment-${Date.now()}`,
      boardId: boardId,
      authorName: authorName || 'Anonymous', // Use provided authorName or default
      content: content.trim(),
      createdAt: new Date().toISOString()
    }

    // Add comment to board
    if (!allBoards[boardIndex].comments) {
      allBoards[boardIndex].comments = []
    }
    allBoards[boardIndex].comments.push(newComment)

    // Save back to file
    await writeFile(dataPath, JSON.stringify(allBoards, null, 2), 'utf-8')

    console.log(`💬 [Comments API] POST - Added comment to board ${boardId}:`, newComment)

    return NextResponse.json({ comment: newComment, success: true })
  } catch (error) {
    console.error('Error adding comment:', error)
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
  }
}

