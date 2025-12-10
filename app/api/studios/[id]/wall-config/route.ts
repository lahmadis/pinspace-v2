import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

const DATA_PATH = path.join(process.cwd(), 'lib', 'data', 'wall-configs.json')

function readConfigs(): Record<string, any> {
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

function writeConfigs(configs: Record<string, any>) {
  try {
    writeFileSync(DATA_PATH, JSON.stringify(configs, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to write wall configs:', err)
  }
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
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
    const configs = readConfigs()
    configs[id] = body
    writeConfigs(configs)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Failed to save wall config:', err)
    return NextResponse.json({ success: false, error: 'Failed to save wall config' }, { status: 500 })
  }
}




