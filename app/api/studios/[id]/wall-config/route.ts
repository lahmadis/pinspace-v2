import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { supabaseServiceRole } from '@/lib/supabase/server'

const DATA_PATH = path.join(process.cwd(), 'lib', 'data', 'wall-configs.json')
const CONFIG_BUCKET = 'board-images'
const CONFIG_PREFIX = 'wall-configs'

function readConfigs(): Record<string, unknown> {
  if (!existsSync(DATA_PATH)) {
    return {}
  }
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    console.error('Failed to read wall configs:', err)
    return {}
  }
}

function writeConfigs(configs: Record<string, unknown>): void {
  writeFileSync(DATA_PATH, JSON.stringify(configs, null, 2), 'utf-8')
}

async function readConfigFromStorage(id: string): Promise<unknown> {
  try {
    const db = supabaseServiceRole()
    const filePath = `${CONFIG_PREFIX}/${id}.json`
    const { data, error } = await db.storage.from(CONFIG_BUCKET).download(filePath)
    if (error || !data) return null
    const raw = await data.text()
    if (!raw) return null
    return JSON.parse(raw)
  } catch (err) {
    console.warn('Storage wall-config read skipped:', err)
    return null
  }
}

async function writeConfigToStorage(id: string, config: unknown): Promise<void> {
  const db = supabaseServiceRole()
  const filePath = `${CONFIG_PREFIX}/${id}.json`
  const payload = Buffer.from(JSON.stringify(config), 'utf-8')
  const { error } = await db.storage.from(CONFIG_BUCKET).upload(filePath, payload, {
    upsert: true,
    contentType: 'application/json',
  })
  if (error) throw error
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  
  // Check if this is a sample studio - return default zigzag config
  if (id.startsWith('sample-studio-')) {
    const defaultConfig = {
      layoutType: 'zigzag',
      walls: [
        { height: 10, width: 20 },
        { height: 10, width: 15 },
        { height: 10, width: 20 },
        { height: 10, width: 15 },
        { height: 10, width: 20 },
      ]
    }
    return NextResponse.json({ exists: true, config: defaultConfig }, { status: 200 })
  }
  
  // Prefer shared storage config so collaborators and production instances stay in sync.
  const storageConfig = await readConfigFromStorage(id)
  if (storageConfig) {
    return NextResponse.json({ exists: true, config: storageConfig }, { status: 200 })
  }

  const configs = readConfigs()
  const config = configs[id]
  if (!config) {
    return NextResponse.json({ exists: false, config: null }, { status: 200 })
  }
  return NextResponse.json({ exists: true, config }, { status: 200 })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  try {
    const body = await request.json()
    const errors: string[] = []
    let persisted = false

    try {
      await writeConfigToStorage(id, body)
      persisted = true
    } catch (err) {
      errors.push(`storage: ${(err as Error).message}`)
    }

    try {
      const configs = readConfigs()
      configs[id] = body
      writeConfigs(configs)
      persisted = true
    } catch (err) {
      errors.push(`file: ${(err as Error).message}`)
    }

    if (!persisted) {
      throw new Error(errors.join(' | ') || 'Unknown persistence failure')
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Failed to save wall config:', err)
    return NextResponse.json({ success: false, error: 'Failed to save wall config' }, { status: 500 })
  }
}






