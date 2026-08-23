/**
 * A free, offline summariser for a desk-crit transcript.
 *
 * NO model, no API key, no network. It reads the transcript with rules and
 * produces a short summary plus a list of next steps. Deliberately a
 * placeholder: the point is that the whole feature — record, summarise, tick
 * things off — works end to end at zero cost, so the shape can be judged before
 * anyone pays for anything.
 *
 * BE CLEAR ABOUT WHAT THIS IS. It does not understand the crit. It finds
 * sentences that look like instructions and sentences that look important, and
 * it will sometimes be wrong in ways a model would not be. The UI says so.
 * Swapping in a real provider means replacing this one function; the callers,
 * the tables and the checkboxes do not change.
 */

import {
  MAX_DELIVERABLE_TITLE,
  MAX_SUMMARY_CHARS,
  MAX_DELIVERABLES,
  safeSlice,
  type ParsedCritSummary,
  type ParsedDeliverable,
} from './types'

/**
 * Openers that mark a sentence as something the student has to DO.
 *
 * Drawn from how crits are actually spoken: an instruction is usually
 * imperative ("redraw the section"), a suggestion ("you might want to"), or a
 * request ("can you bring"). Matched at the START of a sentence, because the
 * same words mid-sentence are usually description — "I tried adding a stair"
 * is not an instruction to add a stair.
 */
const ACTION_OPENERS = [
  'add', 'bring', 'build', 'change', 'check', 'consider', 'cut', 'do',
  'draw', 'explore', 'find', 'fix', 'focus', 'get', 'give', 'go',
  'increase', 'look', 'make', 'model', 'move', 'photograph', 'print',
  'pull', 'push', 'redo', 'redraw', 'reduce', 'rethink', 'revisit',
  'rework', 'section', 'show', 'sketch', 'start', 'study', 'take',
  'test', 'think', 'try', 'update', 'use',
]

/** Phrases that mark an instruction even when it does not open the sentence. */
const ACTION_PHRASES = [
  'you need to', 'you should', 'you have to', 'you might want to',
  'i want to see', "i'd like to see", 'i would like to see',
  'make sure', 'be sure to', "don't forget", 'do not forget',
  'next time', 'for next week', 'by next', 'before next',
  'can you', 'could you', 'try to', 'needs to be', 'has to be',
]

/** Words that make a sentence more likely to be worth summarising. */
const SALIENT_WORDS = [
  'section', 'plan', 'elevation', 'model', 'scale', 'drawing', 'diagram',
  'site', 'ground', 'roof', 'stair', 'facade', 'massing', 'circulation',
  'threshold', 'structure', 'material', 'light', 'programme', 'program',
  'concept', 'idea', 'problem', 'issue', 'works', 'working', 'strong',
  'weak', 'unclear', 'clear',
]

/** Deliverables shorter than this are fragments, not tasks. */
const MIN_DELIVERABLE_CHARS = 12
/** Bullets in the summary. Enough to be useful, few enough to scan. */
const SUMMARY_POINTS = 5
/** Shorter than this is a fragment, not a point worth its own bullet. */
const MIN_BULLET_CHARS = 15
/** Bullets past this get an ellipsis; a summary line should not wrap forever. */
const MAX_BULLET_CHARS = 160

/**
 * Split into sentences.
 *
 * Speech transcription rarely produces clean punctuation, so a newline counts
 * as a break too — Web Speech emits one settled result per pause, and the
 * segments are joined with blank lines. Without that, a whole crit with no full
 * stops would be one enormous "sentence".
 */
function toSentences(text: string): string[] {
  // Deliberately NO lookbehind. `(?<=[.!?])` is a parse-time SyntaxError on
  // Safari and iOS below 16.4 — and because it is a regex literal, it takes the
  // whole module down at load rather than failing inside a try. Matching runs
  // of non-terminator characters plus their trailing punctuation produces the
  // same split with syntax every target supports.
  return text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Negations, which flip what a sentence means.
 *
 * "You shouldn't add more programme" contains an action phrase and would
 * otherwise become the task "Add more programme" — the exact opposite of what
 * was said. Stripping the lead-in cannot fix that, so a negated sentence is not
 * turned into a task at all. Missing a real instruction is recoverable; putting
 * an inverted one on someone's to-do list is not.
 */
const NEGATIONS = [
  "n't", ' not ', 'never ', 'no need', 'instead of', 'rather than',
  'stop ', 'avoid ', 'without ',
]

/**
 * Negated phrasings that are nonetheless instructions.
 *
 * "Don't forget to bring the section model" is a task, not a prohibition.
 * Without this exception the negation check swallowed it — and swallowed the
 * two "forget" entries in ACTION_PHRASES entirely, since isNegated runs first
 * and made them unreachable.
 */
const NEGATED_INSTRUCTIONS = ["don't forget", 'do not forget', "dont forget"]

function isNegated(lower: string): boolean {
  if (NEGATED_INSTRUCTIONS.some((p) => lower.includes(p))) return false
  return NEGATIONS.some((n) => lower.includes(n))
}

/**
 * Spoken filler that carries nothing once a sentence is standing on its own.
 *
 * Transcription punctuates these with commas as often as with spaces — "Yeah,
 * um, the massing is unclear" — so matching only `word + space` left most of
 * them in place. Both forms are handled below.
 */
const FILLER_WORDS = [
  'so', 'and', 'but', 'well', 'okay', 'ok', 'right', 'yeah', 'yep', 'um', 'uh',
  'i mean', 'you know', 'like', 'basically', 'actually', 'anyway',
]
const FILLER_SET = new Set(FILLER_WORDS)

/**
 * Remove spoken filler from a sentence.
 *
 * Built from regex LITERALS and a token walk rather than `new RegExp` with the
 * word interpolated in. A dynamic pattern here has to carry `\s` through a
 * template literal to survive as a whitespace class, and `\s` written as `\s`
 * silently becomes the letter "s" — the class matches an s instead of a space,
 * the strip quietly does nothing, and nothing anywhere reports an error.
 */
function stripFiller(text: string): string {
  let out = text.replace(/\s+/g, ' ').trim()

  // Mid-sentence, and only comma-delimited on both sides: ", you know," is
  // filler, but "at a scale, like one to fifty" is not, and the trailing comma
  // is the whole difference.
  out = out.replace(/,\s*([A-Za-z' ]+?)\s*,/g, (whole, inner: string) =>
    FILLER_SET.has(inner.toLowerCase()) ? ', ' : whole,
  )

  // Lead-ins, which stack — "Okay, so, well the plan..." is three of them.
  // Walked a token at a time rather than matched, so a two-word marker ("you
  // know", "i mean") is tested before the single word it begins with.
  for (;;) {
    const m = /^([A-Za-z']+)([,\s]+)([A-Za-z']+)?/.exec(out)
    if (!m) break
    const pair = m[3] ? `${m[1]} ${m[3]}`.toLowerCase() : null
    // A pair only counts when the two words are separated by a space; a comma
    // between them means they are two separate lead-ins, handled one per pass.
    if (pair && m[2].trim() === '' && FILLER_SET.has(pair)) {
      out = out.slice(m[0].length).replace(/^[,\s]+/, '').trim()
      continue
    }
    if (FILLER_SET.has(m[1].toLowerCase())) {
      out = out.slice(m[1].length).replace(/^[,\s]+/, '').trim()
      continue
    }
    break
  }
  // Collapsed LAST, not first: removing a mid-sentence marker leaves the space
  // that preceded it next to the one that replaced it.
  return out.replace(/\s+/g, ' ').trim()
}

function startsWithAction(lower: string): boolean {
  // Filler stripped FIRST. "So redraw the section" opens with "so", which is
  // not an action opener, so the instruction was missed entirely — the most
  // common way a spoken instruction reaches this function.
  const firstWord = stripFiller(lower).split(/[^a-z']+/).find(Boolean)
  return firstWord ? ACTION_OPENERS.includes(firstWord) : false
}

function looksLikeAction(sentence: string): boolean {
  const lower = sentence.toLowerCase()
  if (isNegated(lower)) return false
  if (ACTION_PHRASES.some((p) => lower.includes(p))) return true
  return startsWithAction(lower)
}

/** Strip the lead-in so a task reads as a task, not as a quote of the critic. */
function toTaskTitle(sentence: string): string {
  let text = sentence.trim().replace(/\s+/g, ' ')
  for (const phrase of ["don't forget to", 'do not forget to', 'you need to', 'you should', 'you have to', 'you might want to', 'i want to see', 'make sure', 'be sure to', 'try to', 'can you', 'could you']) {
    const idx = text.toLowerCase().indexOf(phrase)
    if (idx !== -1) {
      text = text.slice(idx + phrase.length).trim()
      break
    }
  }
  text = stripFiller(text.replace(/[.!?]+$/, '').trim())
  if (!text) return ''
  // Sentence case: these render as list items, and a lowercase first letter
  // reads as a fragment torn out of the middle of something.
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Tidy one sentence into a bullet.
 *
 * Speech is full of lead-ins that carry nothing once the sentence is standing
 * on its own in a list — "so", "and", "I mean", "you know". Dropping them is
 * what makes a bullet read as a point rather than as an overheard fragment.
 */
function toBullet(sentence: string): string {
  let text = stripFiller(sentence.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, ''))
  if (!text) return ''
  if (text.length > MAX_BULLET_CHARS) {
    // Cut at a word boundary rather than mid-word.
    const cut = text.slice(0, MAX_BULLET_CHARS)
    const lastSpace = cut.lastIndexOf(' ')
    text = `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`
  }
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A rough "is this worth keeping" score for summary selection. */
function salience(sentence: string): number {
  const lower = sentence.toLowerCase()
  let score = 0
  for (const word of SALIENT_WORDS) if (lower.includes(word)) score += 2
  // Very short lines are usually filler ("yeah", "okay, right"); very long ones
  // are usually a whole paragraph the recogniser never punctuated.
  const words = lower.split(/\s+/).length
  if (words >= 6 && words <= 40) score += 1
  return score
}

/**
 * Summarise a transcript and pull out next steps, with no model.
 *
 * Never throws and always returns something usable: an empty transcript gives
 * empty output rather than an error, because the caller renders it either way.
 */
export function summariseLocally(transcript: string): ParsedCritSummary {
  const sentences = toSentences(transcript)
  if (sentences.length === 0) return { summary: '', deliverables: [] }

  const actions: string[] = []
  const seen = new Set<string>()
  for (const sentence of sentences) {
    if (!looksLikeAction(sentence)) continue
    const title = toTaskTitle(sentence)
    if (title.length < MIN_DELIVERABLE_CHARS) continue
    // De-duped on a normalised form: people repeat an instruction two or three
    // times in a crit, and three identical checkboxes is worse than one.
    // Case and spacing only. Stripping non-ASCII — as this used to — collapsed
    // every title in a non-Latin script to the same empty key, so only the
    // first of them survived.
    const key = title.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    actions.push(title)
    if (actions.length >= MAX_DELIVERABLES) break
  }

  const deliverables: ParsedDeliverable[] = actions.map((title) => ({
    title: safeSlice(title, MAX_DELIVERABLE_TITLE),
  }))

  // The summary is BULLETS, one point per line, not a paragraph.
  //
  // Joining the chosen sentences into prose produced something that read like
  // a transcript with the boring parts removed — long, flat, and no faster to
  // scan than the transcript itself. A crit is a handful of separate points,
  // so the summary should be a handful of separate lines. Stored newline
  // separated; the column renders each line as a bullet.
  const actionSet = new Set(actions.map((a) => a.toLowerCase()))
  const candidates = sentences
    .map((sentence, index) => ({ sentence, index, score: salience(sentence) }))
    .filter(({ sentence }) => !actionSet.has(toTaskTitle(sentence).toLowerCase()))
    .filter(({ score }) => score > 0)

  const chosen = [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, SUMMARY_POINTS)
    // Back into spoken order: reordering by score turns a conversation into a
    // ranked list and loses the thread of it.
    .sort((a, b) => a.index - b.index)
    .map(({ sentence }) => toBullet(sentence))
    .filter((line) => line.length >= MIN_BULLET_CHARS)

  // Nothing scored? Fall back to the opening lines — the first thing said in a
  // crit is usually what it was about — rather than showing nothing.
  const points =
    chosen.length > 0
      ? chosen
      : sentences.slice(0, SUMMARY_POINTS).map(toBullet).filter((l) => l.length >= MIN_BULLET_CHARS)

  const body = points.join('\n')

  return {
    summary: safeSlice(body, MAX_SUMMARY_CHARS),
    deliverables,
  }
}
