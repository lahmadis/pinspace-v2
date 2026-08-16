#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_EXTENSIONS = new Set(['.css', '.js', '.ts', '.tsx'])
const TOKEN_DEFINITION_FILES = new Set(['app/globals.css', 'tailwind.config.js'])
const PINSPACE_PALETTE = new Set(['#ffc800', '#fff3cc', '#fffcf0', '#14705c', '#0a2f28', '#0b0b0b'])
const LEGACY_HEX = new Set(['#4444ff', '#3333ee'])
const OBSOLETE_UI_IMPORTS = [
  '@/components/Button',
  '@/components/Card',
  '@/components/Input',
  '@/components/Modal',
  '@/components/LoadingSpinner',
]
const ANY_ALLOW_PATTERN = /pinspace-ui-allow\s+([a-z-]+)/g
const APPROVED_ENGINE_PALETTES = new Map([
  ['components/3d/enginePalette.ts', new Set(['ENGINE_PALETTE'])],
  ['components/Gallery3D.tsx', new Set(['GALLERY_VISUAL_COLORS'])],
  ['components/GalleryAvatarModal.tsx', new Set(['GALLERY_AVATAR_COLOR_OPTIONS'])],
  ['components/LightboxModal.tsx', new Set(['MEDIA_ANNOTATION_PALETTE'])],
])

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function lineText(source, line) {
  return source.split('\n')[line - 1]?.trim() ?? ''
}

function issue(source, file, rule, offset, message) {
  const line = lineNumber(source, offset)
  return { file, line, rule, message, source: lineText(source, line) }
}

function invalidInlineAllowlists(source) {
  const invalid = []
  for (const match of source.matchAll(ANY_ALLOW_PATTERN)) {
    const line = lineNumber(source, match.index)
    invalid.push({
      line,
      rule: 'invalid-allowlist',
      message: 'Inline PinSpace UI allowlists are forbidden; use an exact reviewed named palette export.',
      source: lineText(source, line),
    })
  }
  return invalid
}

function enginePaletteRanges(source, file) {
  const ranges = []
  const approvedNames = APPROVED_ENGINE_PALETTES.get(file)
  if (!approvedNames) return ranges

  const pattern = /(?:\/\*\*?[\s\S]{12,240}?\*\/|\/\/[^\n]{12,})\s*\n\s*export\s+const\s+([A-Z][A-Z0-9_]*)(?:\s*:[^=]+)?\s*=\s*(?:Object\.freeze\()?\s*\{/g
  for (const match of source.matchAll(pattern)) {
    if (!approvedNames.has(match[1])) continue
    if (!/(?:WebGL|3D|canvas|material|data visualization|contrast|sRGB|scene)/i.test(match[0])) continue
    const open = source.indexOf('{', match.index)
    let depth = 0
    let end = open
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      if (source[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    ranges.push([open, end])
  }
  return ranges
}

function isInRange(offset, ranges) {
  return ranges.some(([start, end]) => offset >= start && offset <= end)
}

function maskComments(source) {
  const mask = (value) => value.replace(/[^\n]/g, ' ')
  return source
    .replace(/\/\*[\s\S]*?\*\//g, mask)
    .replace(/\/\/[^\n]*/g, mask)
}

function* tagMatches(source, tagName) {
  const opening = new RegExp('<' + tagName + '\\b', 'g')
  for (const match of source.matchAll(opening)) {
    let braces = 0
    let quote = null
    let end = match.index
    for (; end < source.length && end - match.index < 5000; end += 1) {
      const character = source[end]
      const previous = source[end - 1]
      if (quote) {
        if (character === quote && previous !== '\\') quote = null
        continue
      }
      if (character === '"' || character === "'" || character.charCodeAt(0) === 96) {
        quote = character
      } else if (character === '{') {
        braces += 1
      } else if (character === '}') {
        braces = Math.max(0, braces - 1)
      } else if (character === '>' && braces === 0) {
        break
      }
    }
    yield { 0: source.slice(match.index, end + 1), index: match.index }
  }
}

function isPropagationBoundary(tag) {
  const clickLikeHandlers = tag.match(/\bon(?:Click|PointerDown)\s*=/g) ?? []
  if (clickLikeHandlers.length !== 1) return false
  return /on(?:Click|PointerDown)=\{\s*\([^)]*\)\s*=>\s*(?:\{\s*)?[A-Za-z_$][\w$]*\.stopPropagation\(\)\s*;?\s*(?:\})?\s*\}/.test(tag)
}

function hasOnlyPropagationClickHandlers(tag) {
  const clickLikeHandlers = tag.match(/\bon(?:Click|PointerDown|DoubleClick)\s*=/g) ?? []
  const propagationHandlers = tag.match(/\bon(?:Click|PointerDown|DoubleClick)=\{\s*\([^)]*\)\s*=>\s*[A-Za-z_$][\w$]*\.stopPropagation\(\)\s*\}/g) ?? []
  return clickLikeHandlers.length > 0 && clickLikeHandlers.length === propagationHandlers.length
}

function isReviewedNonControlGesture(file, tag) {
  if (file === 'components/LightboxModal.tsx') {
    if (/\bonClick=\{handleBackdropClick\}/.test(tag)) return true
    if (/\bref=\{viewport\.containerRef\}/.test(tag)
      && /\bonPointerDown=\{viewport\.onPointerDown\}/.test(tag)
      && /\bonDoubleClick=\{viewport\.onDoubleClick\}/.test(tag)) return true

    if (/\bclassName=["']absolute inset-0 z-20 cursor-crosshair["']/.test(tag)) {
      return /\bonClick=\{handleCalloutPlace\}/.test(tag)
        && /\bonPointerDown=\{\s*\([^)]*\)\s*=>\s*[A-Za-z_$][\w$]*\.stopPropagation\(\)\s*\}/.test(tag)
        && /\bonDoubleClick=\{\s*\([^)]*\)\s*=>\s*[A-Za-z_$][\w$]*\.stopPropagation\(\)\s*\}/.test(tag)
    }

    const reviewedBoundaryClass = [
      /pointer-events-auto flex items-center gap-1 px-2/,
      /absolute z-30 pointer-events-auto/,
      /absolute top-3 left-1\/2 -translate-x-1\/2 z-30 pointer-events-auto/,
      /absolute top-3 right-3 z-40 pointer-events-auto/,
      /absolute bottom-20 left-1\/2 -translate-x-1\/2 z-40 pointer-events-auto/,
    ].some((pattern) => pattern.test(tag))
    return reviewedBoundaryClass && hasOnlyPropagationClickHandlers(tag)
  }

  return file === 'components/3d/FloorEditorOverlay.tsx'
    && /\baria-hidden=["']true["']/.test(tag)
    && /\bonPointerDown=\{\s*\([^)]*\)\s*=>\s*handleRotateTable\(table\.id,\s*[^)]+\)\s*\}/.test(tag)
    && /\bonClick=\{\s*\([^)]*\)\s*=>\s*[^.]+\.stopPropagation\(\)\s*\}/.test(tag)
}

export function auditSource(source, file) {
  const normalizedFile = file.split(path.sep).join('/')
  const findings = []
  const invalid = invalidInlineAllowlists(source)
  findings.push(...invalid.map((finding) => ({ file: normalizedFile, ...finding })))

  const add = (rule, offset, message) => {
    findings.push(issue(source, normalizedFile, rule, offset, message))
  }

  if (normalizedFile.endsWith('.tsx') && normalizedFile !== 'components/ui/DataTable.tsx') {
    for (const match of source.matchAll(/<table\b/g)) {
      add('raw-data-table', match.index, 'Use the shared DataTable primitives so table semantics, responsive scrolling, and state rows remain consistent.')
    }
  }

  const legacyUtility = /\b(?:bg|text|border|ring|outline|fill|stroke|from|to|via)-(?:indigo|purple|gray|slate)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g
  for (const match of source.matchAll(legacyUtility)) {
    add('legacy-theme-class', match.index, 'Replace legacy theme utility "' + match[0] + '" with a semantic PinSpace token.')
  }

  const rawStatusUtility = /\b(?:bg|text|border|ring|outline|fill|stroke|from|to|via)-(?:red|amber|emerald)(?:-\d{2,3})(?:\/\d{1,3})?\b/g
  for (const match of source.matchAll(rawStatusUtility)) {
    add('raw-status-class', match.index, 'Replace raw status utility "' + match[0] + '" with the matching semantic status variable.')
  }

  const colorSource = maskComments(source)
  const colorLiteral = /#[0-9a-fA-F]{3,8}\b/g
  for (const match of colorSource.matchAll(colorLiteral)) {
    if (LEGACY_HEX.has(match[0].toLowerCase())) {
      add('legacy-hex', match.index, 'Legacy highlight color "' + match[0] + '" is not part of PinSpace.')
    }
  }

  if (!TOKEN_DEFINITION_FILES.has(normalizedFile)) {
    const paletteRanges = enginePaletteRanges(source, normalizedFile)
    for (const match of colorSource.matchAll(colorLiteral)) {
      const value = match[0].toLowerCase()
      if (LEGACY_HEX.has(value)) {
        continue
      } else if (isInRange(match.index, paletteRanges)) {
        continue
      } else if (PINSPACE_PALETTE.has(value)) {
        add('raw-pinspace-color', match.index, 'Use a semantic PinSpace token instead of raw palette value "' + match[0] + '".')
      } else {
        add('raw-color', match.index, 'Move raw color "' + match[0] + '" to a semantic token or a documented engine palette constant.')
      }
    }

    const rawPinSpaceRgb = /rgba?\(\s*(?:255[\s,]+200[\s,]+0|255[\s,]+243[\s,]+204|255[\s,]+252[\s,]+240|20[\s,]+112[\s,]+92|10[\s,]+47[\s,]+40|11[\s,]+11[\s,]+11)\b[^)]*\)/gi
    for (const match of colorSource.matchAll(rawPinSpaceRgb)) {
      if (!isInRange(match.index, paletteRanges)) {
        add('raw-pinspace-color', match.index, 'Use a semantic PinSpace token instead of raw palette value "' + match[0] + '".')
      }
    }
  }

  for (const tagName of ['div', 'span']) {
    for (const match of tagMatches(source, tagName)) {
      const tag = match[0]
      if (!/\bon(?:Click|PointerDown)\s*=/.test(tag)) continue
      if (isPropagationBoundary(tag)) continue
      if (isReviewedNonControlGesture(normalizedFile, tag)) continue
      const hasButtonRole = /\brole\s*=\s*["']button["']/.test(tag)
      if (!hasButtonRole) {
        add('non-semantic-click', match.index, 'Use a native button/link instead of a clickable <' + tagName + '>, or document a non-control event boundary.')
        continue
      }

      const missing = []
      if (!/\btabIndex\s*=\s*(?:\{\s*0\s*\}|["']0["'])/.test(tag)) missing.push('tabIndex={0}')
      if (!/\bonKey(?:Down|Up)\s*=/.test(tag)) missing.push('keyboard handler')
      if (!/\b(?:aria-label|aria-labelledby)\s*=/.test(tag)) missing.push('accessible name')
      if (!/focus-visible:(?:outline|ring|border)/.test(tag)) missing.push('visible focus style')
      if (missing.length > 0) {
        add('custom-control-a11y', match.index, 'Custom <' + tagName + '> control is missing ' + missing.join(', ') + '.')
      }
    }
  }

  for (const tagName of ['button', 'a']) {
    for (const match of tagMatches(source, tagName)) {
      const tag = match[0]
      if (/\b(?:opacity-0|invisible|hidden)\b/.test(tag) && /\bgroup-hover:(?:opacity-100|visible|block)\b/.test(tag)) {
        add('hover-only-action', match.index, 'Do not reveal an actionable <' + tagName + '> only on hover.')
      }
    }
  }

  const fixedViewport = /(?:\b(?:w|h|min-w|min-h|max-w|max-h)-\[(?:1440px|900px)\]|\b(?:width|height)\s*:\s*["']?(?:1440px|900px)\b)/g
  for (const match of source.matchAll(fixedViewport)) {
    add('fixed-viewport', match.index, 'Replace fixed 1440×900 layout assumptions with responsive sizing.')
  }

  for (const importPath of OBSOLETE_UI_IMPORTS) {
    const importPattern = new RegExp("from\\s+['\"]" + importPath.replace('/', '\\/') + "['\"]", 'g')
    for (const match of source.matchAll(importPattern)) {
      add('obsolete-ui-import', match.index, 'Replace obsolete UI import "' + importPath + '" with components/ui primitives.')
    }
  }

  return findings.sort((left, right) => left.line - right.line || left.rule.localeCompare(right.rule))
}

async function sourceFiles(root) {
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'api') continue
        await walk(absolute)
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolute)
      }
    }
  }

  for (const directory of ['app', 'components']) {
    await walk(path.join(root, directory))
  }
  files.push(path.join(root, 'tailwind.config.js'))
  return files.sort()
}

export async function auditTree(root = process.cwd()) {
  const findings = []
  for (const absolute of await sourceFiles(root)) {
    const file = path.relative(root, absolute)
    findings.push(...auditSource(await readFile(absolute, 'utf8'), file))
  }
  return findings
}

async function main() {
  const findings = await auditTree()
  if (findings.length === 0) {
    console.log('PinSpace UI audit passed (0 findings).')
    return
  }

  for (const finding of findings) {
    console.error(finding.file + ':' + finding.line + ' [' + finding.rule + '] ' + finding.message)
    if (finding.source) console.error('  ' + finding.source)
  }
  console.error('PinSpace UI audit failed with ' + findings.length + ' finding' + (findings.length === 1 ? '' : 's') + '.')
  process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) await main()
