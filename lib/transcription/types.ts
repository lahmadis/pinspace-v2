/**
 * The transcription contract.
 *
 * Imports nothing, like lib/canvas/types.ts, so both the browser hook and any
 * future server route can share it.
 *
 * This exists because the FIRST transcriber is not meant to be the last. The
 * browser's Web Speech API is free, needs no key and no account, and is the
 * only reason voice notes can ship without a card on file — but it runs in
 * Chrome and Edge only, cannot label speakers, and is mediocre on a room with
 * three people at arm's length from a laptop mic. Swapping it for a server-side
 * model later should be one module, not a rewrite of the panel, the API and the
 * summary step.
 *
 * So the panel talks to THIS shape and never to `webkitSpeechRecognition`.
 */

/** Transcribers, as recorded on each stored segment. */
export const TRANSCRIPTION_SOURCES = ['web-speech', 'whisper', 'manual'] as const
export type TranscriptionSource = (typeof TRANSCRIPTION_SOURCES)[number]

/**
 * Why transcription is unavailable, when it is.
 *
 * Separate cases rather than one boolean because the user's next action differs
 * for each, and "voice notes aren't available" with no reason is the kind of
 * dead end people file a bug about.
 */
export type TranscriptionUnavailable =
  /** Firefox and Safari have no Web Speech recognition at all. */
  | 'unsupported-browser'
  /** Web Speech requires a secure context: https, or localhost. A LAN IP is neither. */
  | 'insecure-context'
  /** The user said no to the microphone, or the OS has it blocked. */
  | 'mic-denied'
  /** The recogniser reached the network and failed — offline, or the service is down. */
  | 'network'

export interface TranscriptionState {
  /** Recording and receiving results. */
  listening: boolean
  /**
   * Speech recognised but not yet settled — the recogniser may still revise it.
   *
   * Rendered distinctly from committed text and NEVER saved: interim results
   * are frequently rewritten a word later, so persisting them would put
   * half-heard phrases into the permanent record of a crit.
   */
  interim: string
  /** Settled text since the last flush. This is what gets saved. */
  committed: string
  /** Set when transcription cannot run; `listening` is false whenever it is. */
  unavailable: TranscriptionUnavailable | null
}

/**
 * Whether trying again could possibly help.
 *
 * A denied microphone or a network blip is recoverable — the user grants
 * permission, or the connection returns — so the Record button must stay live
 * and clear the state on the next press. A browser with no speech recognition
 * and a page served outside a secure context will not change until the user
 * does something this app cannot prompt for, so the button is genuinely dead.
 *
 * Lives here rather than in the hook because both the hook (deciding whether
 * to retry) and the panel (deciding whether to disable) need the same answer,
 * and two copies would drift into a button that is enabled but does nothing.
 */
export function isPermanentFailure(reason: TranscriptionUnavailable): boolean {
  return reason === 'unsupported-browser' || reason === 'insecure-context'
}

/** Human-readable reason, for the panel to show without a switch of its own. */
export function unavailableMessage(reason: TranscriptionUnavailable): string {
  switch (reason) {
    case 'unsupported-browser':
      return 'Voice notes need Chrome or Edge — this browser has no speech recognition.'
    case 'insecure-context':
      return 'Voice notes need a secure page. Open the app at localhost rather than a network address.'
    case 'mic-denied':
      return 'The microphone is blocked. Allow it for this site, then try again.'
    case 'network':
      return "Speech recognition couldn't reach the network. Check your connection and try again."
  }
}
