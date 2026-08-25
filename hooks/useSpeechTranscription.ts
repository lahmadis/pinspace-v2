'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isPermanentFailure,
  type TranscriptionState,
  type TranscriptionUnavailable,
} from '@/lib/transcription/types'

/**
 * Live transcription through the browser's Web Speech API.
 *
 * The ONLY file that knows this provider exists. Everything above it talks to
 * the shape in lib/transcription/types.ts, so replacing this with an upload to
 * a server-side model is a new hook and one import, not a rewrite. See that
 * file for why that matters.
 *
 * Local types below rather than a global augmentation: SpeechRecognition is not
 * in every TypeScript lib.dom, and declaring it globally would collide in the
 * versions that do have it. Nothing outside this file needs the shape.
 */

interface SpeechAlternativeLike {
  transcript: string
}
interface SpeechResultLike {
  isFinal: boolean
  0: SpeechAlternativeLike
}
interface SpeechResultListLike {
  length: number
  [index: number]: SpeechResultLike
}
interface SpeechResultEventLike {
  resultIndex: number
  results: SpeechResultListLike
}
interface SpeechErrorEventLike {
  error: string
}
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechResultEventLike) => void) | null
  onerror: ((e: SpeechErrorEventLike) => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Consecutive silent restarts before giving up.
 *
 * Chrome's recogniser ends itself after a stretch of silence, so a long quiet
 * pause in a crit has to be restarted or recording dies unnoticed. But a
 * recogniser that ends IMMEDIATELY every time — the shape of a failure this
 * API reports as a plain `onend` with no error — would restart forever, and
 * each cycle is a request to Google's speech service. Ten in a row without a
 * single result means it is not working, not that the room is quiet.
 */
const MAX_SILENT_RESTARTS = 10

/**
 * A recogniser that ends sooner than this after starting never worked.
 *
 * The give-up counter must only count THOSE. Chrome also ends the recogniser
 * after an ordinary silent stretch, and counting those too means about ten
 * quiet pauses — a couple of minutes across a long crit — permanently kills
 * recording and blames the network for it. Anything that ran a second before
 * ending was doing its job, so it resets the count.
 */
const IMMEDIATE_FAIL_MS = 1000


export interface SpeechTranscription extends TranscriptionState {
  start: () => void
  stop: () => void
  /** Take the settled text and clear it, atomically. Interim text is NOT included. */
  flush: () => string
}

export function useSpeechTranscription(): SpeechTranscription {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [committed, setCommitted] = useState('')
  const [unavailable, setUnavailable] = useState<TranscriptionUnavailable | null>(null)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  /** What the USER wants, as opposed to whether the recogniser happens to be up. */
  const wantListeningRef = useRef(false)
  /** Consecutive recognisers that died immediately; see MAX_SILENT_RESTARTS. */
  const silentRestartsRef = useRef(0)
  /** When the live recogniser started, for the immediate-failure test. */
  const launchedAtRef = useRef(0)
  /** Whether the live recogniser has produced anything — proof it works. */
  const sawResultRef = useRef(false)
  /**
   * Committed text, mirrored synchronously.
   *
   * flush() is called from an event handler and must return everything settled
   * up to that instant. Reading the state variable would return whatever the
   * last render saw, dropping any result that landed since — which on stop is
   * precisely the final sentence.
   */
  const committedRef = useRef('')

  /** Support is checked once, on mount: none of it can change during a session. */
  useEffect(() => {
    if (!getRecognitionCtor()) {
      setUnavailable('unsupported-browser')
      return
    }
    // Web Speech refuses to run outside a secure context. A dev server reached
    // at a LAN address is the common way to hit this, and the browser's own
    // error for it is indistinguishable from a denied microphone.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setUnavailable('insecure-context')
    }
  }, [])

  const teardown = useCallback(() => {
    const rec = recognitionRef.current
    if (!rec) return
    // Handlers cleared BEFORE abort: abort() fires onend, which would otherwise
    // run the restart branch on a recogniser we are deliberately discarding.
    rec.onresult = null
    rec.onerror = null
    rec.onend = null
    try {
      rec.abort()
    } catch {
      // Already dead. Nothing to do.
    }
    recognitionRef.current = null
  }, [])

  const launch = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return

    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'

    rec.onresult = (event) => {
      sawResultRef.current = true
      silentRestartsRef.current = 0
      let settled = ''
      let pending = ''
      // From resultIndex, not 0: `results` is cumulative for the life of this
      // recogniser, so replaying it from the start would re-append every
      // sentence already committed on each new event.
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) settled += text
        else pending += text
      }
      if (settled) {
        // Written to the ref first and synchronously, so a flush() during this
        // same tick sees it. Spacing is normalised here rather than at save
        // time — the recogniser returns fragments with inconsistent leading
        // whitespace, and joining them raw produces "the plan.We should".
        const next = `${committedRef.current} ${settled.trim()}`.trim()
        committedRef.current = next
        setCommitted(next)
      }
      setInterim(pending.trim())
    }

    rec.onerror = (event) => {
      switch (event.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          wantListeningRef.current = false
          setUnavailable('mic-denied')
          setListening(false)
          break
        case 'network':
          wantListeningRef.current = false
          setUnavailable('network')
          setListening(false)
          break
        // 'no-speech' and 'aborted' are ordinary: a pause in the conversation,
        // or our own stop(). onend handles both — treating them as failures
        // would end recording every time the room went quiet.
        default:
          break
      }
    }

    rec.onend = () => {
      // ONLY the live recogniser may restart.
      //
      // Chrome can take a second to deliver onend after stop(), so a user who
      // hits Stop then Record lands here for a retired instance while a new one
      // is already running. Without this test that stale onend nulls the ref
      // and launches a THIRD recogniser: two live at once, both transcribing
      // the same audio into one buffer — every word duplicated in the saved
      // record — and the one that got orphaned keeps the microphone open past
      // Stop.
      if (recognitionRef.current !== rec) return

      if (!wantListeningRef.current) {
        recognitionRef.current = null
        setListening(false)
        setInterim('')
        return
      }

      // Chrome ends the recogniser on its own after silence. If the user still
      // wants to be recording, start a fresh one — reusing this instance after
      // onend is unreliable across versions.
      //
      // Three outcomes, not two. Elapsed time alone is not enough: a recogniser
      // that reliably dies just past the threshold with nothing to show would
      // reset the count every cycle and restart forever, silently, with the UI
      // claiming to be recording. Only a RESULT proves it works.
      if (sawResultRef.current) {
        silentRestartsRef.current = 0
      } else if (Date.now() - launchedAtRef.current < IMMEDIATE_FAIL_MS) {
        silentRestartsRef.current += 1
      }
      // The third case — ran a while, heard nothing — is an ordinary quiet
      // stretch in a crit. Neither progress nor failure, so the count is left
      // exactly where it was: silence never triggers the ceiling, and never
      // rescues a recogniser that is genuinely broken.

      if (silentRestartsRef.current >= MAX_SILENT_RESTARTS) {
        wantListeningRef.current = false
        recognitionRef.current = null
        setUnavailable('network')
        setListening(false)
        setInterim('')
        return
      }

      recognitionRef.current = null
      launch()
    }

    // The ref is set BEFORE start(), so the identity test above is already
    // valid if onend fires immediately.
    recognitionRef.current = rec
    launchedAtRef.current = Date.now()
    // Per-instance, not per-session: the question onend asks is whether THIS
    // recogniser did anything.
    sawResultRef.current = false
    try {
      rec.start()
      setListening(true)
    } catch {
      // start() throws InvalidStateError if this instance is already running.
      // It never started, so no onend is coming and nothing will restart it —
      // listening has to be cleared here or the panel shows a live recording
      // that does not exist.
      recognitionRef.current = null
      wantListeningRef.current = false
      setListening(false)
    }
  }, [])

  const start = useCallback(() => {
    if (unavailable && isPermanentFailure(unavailable)) return
    if (wantListeningRef.current) return
    // A denied mic or a dropped network is worth another go — the user has
    // probably just fixed it, which is why they pressed the button again.
    if (unavailable) setUnavailable(null)
    wantListeningRef.current = true
    silentRestartsRef.current = 0
    setInterim('')
    // Guarantees exactly one live recogniser. A stop() whose onend has not
    // landed yet leaves an instance still holding the microphone; launching on
    // top of it is the leak the identity test in onend also guards. Both,
    // because this one prevents the overlap and that one survives it.
    teardown()
    launch()
  }, [launch, teardown, unavailable])

  const stop = useCallback(() => {
    wantListeningRef.current = false
    const rec = recognitionRef.current
    setListening(false)
    setInterim('')
    if (!rec) return
    try {
      // stop(), not abort(): stop lets the recogniser emit whatever it has
      // already heard as a final result, so the last sentence before the button
      // press is kept. abort() discards it.
      rec.stop()
    } catch {
      teardown()
    }
  }, [teardown])

  const flush = useCallback(() => {
    const text = committedRef.current.trim()
    committedRef.current = ''
    setCommitted('')
    return text
  }, [])

  // Recording must not outlive the page. Without this, navigating away from a
  // crit leaves the microphone live and the restart loop running.
  useEffect(
    () => () => {
      wantListeningRef.current = false
      teardown()
    },
    [teardown]
  )

  return { listening, interim, committed, unavailable, start, stop, flush }
}
