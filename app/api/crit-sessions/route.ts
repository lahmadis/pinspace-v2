import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

// Update active board in session
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { activeBoardId, participant } = await request.json()
    const sessionId = params.id

    const dataPath = path.join(process.cwd(), 'lib', 'data', 'crit-sessions.json')
    
    if (!existsSync(dataPath)) {
      return NextResponse.json({ error: 'No sessions found' }, { status: 404 })
    }

    const fileContent = await readFile(dataPath, 'utf-8')
    let sessions = JSON.parse(fileContent)
    
    sessions = sessions.map((s: any) => {
      if (s.id === sessionId) {
        const updates: any = {}
        
        if (activeBoardId !== undefined) {
          updates.activeBoardId = activeBoardId
        }
        
        if (participant && !s.participants.includes(participant)) {
          updates.participants = [...s.participants, participant]
        }
        
        return { ...s, ...updates }
      }
      return s
    })

    await writeFile(dataPath, JSON.stringify(sessions, null, 2))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating session:', error)
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
  }
}