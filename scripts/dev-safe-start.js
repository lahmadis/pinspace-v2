#!/usr/bin/env node

const { execSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = process.cwd()
const cacheDirs = ['.next-dev', '.next']

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8' })
  } catch {
    return ''
  }
}

function killPortListener(port) {
  if (process.platform !== 'win32') return

  const output = run(`netstat -ano -p tcp | findstr :${port}`)
  if (!output) return

  const pids = new Set()
  for (const line of output.split(/\r?\n/)) {
    if (!line || !line.toUpperCase().includes('LISTENING')) continue
    const parts = line.trim().split(/\s+/)
    const pid = parts[parts.length - 1]
    if (pid && /^\d+$/.test(pid)) {
      pids.add(pid)
    }
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' })
      console.log(`Freed port ${port} by stopping PID ${pid}`)
    } catch {
      // Best effort.
    }
  }
}

function deleteDirSafe(dirName) {
  const fullPath = path.join(projectRoot, dirName)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 3) {
        console.warn(`Could not remove ${dirName}:`, error.message)
      }
    }
  }
}

killPortListener(3000)
for (const dir of cacheDirs) {
  deleteDirSafe(dir)
}

const nextBin = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
const child = spawn(process.execPath, [nextBin, 'dev', '-p', '3000'], {
  cwd: projectRoot,
  stdio: 'inherit',
})

child.on('exit', (code) => process.exit(code ?? 0))
