'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'

/**
 * Single-writer gate for the wall-config blob.
 *
 * The blob uses optimistic concurrency: a client sends the `baseVersion` its
 * config is based on and the server (app/api/studios/[id]/wall-config/route.ts)
 * rejects with 409 when that doesn't equal the stored version. Four call sites
 * write the blob — the page's debounced autosave, Save & Exit, the wall-delete
 * persist and the text-item save — and they all previously read the shared
 * version ref at payload-build time. Two writes overlapping in flight therefore
 * shipped the SAME baseVersion, and whichever landed second 409'd against the
 * version the first had just created: a "Room layout was updated by another
 * user" toast with only one user in the room.
 *
 * This module fixes that by owning the version AND a serialization queue in one
 * object. At most one POST is in flight; each write reads the version only once
 * it reaches the front of the queue, i.e. after the previous write has resolved
 * and adopted its new version. No two writes can carry the same baseVersion.
 *
 * On a surviving 409 it then decides between REBASE and REPORT based on WHO
 * wrote the stored blob last. Every write stamps `lastWriterId` (the session
 * user id) into the blob, so a 409 can be attributed:
 *   - stored lastWriterId === this user  → the same human overlapping with
 *     themselves (two tabs, or a write still in flight). Rebase: adopt the
 *     server's version and re-post this config on top, up to MAX_REBASE_RETRIES
 *     times. Their newest intent is the right winner and nothing is lost.
 *   - a DIFFERENT user, or no lastWriterId at all (a blob written before this
 *     field existed) → a genuine second editor. Do NOT rebase: report the
 *     conflict (reload + toast) so the other person's layout is not silently
 *     clobbered. Absent id fails safe into this branch.
 * This attribution is what makes it safe for more than one person (owner plus
 * instructor/members) to edit walls. Callers whose config is not the user's
 * intent for the room opt out of rebase entirely with rebaseOnConflict:false;
 * see that field.
 */

/**
 * How many times a single write may adopt the server's version and re-post
 * itself before giving up and reporting the conflict. Small on purpose: if the
 * version moves this many times under a serialized, owner-only writer, something
 * is going on that we should not paper over by retrying harder.
 */
const MAX_REBASE_RETRIES = 2

/** The server's 409 body: the stored config plus its authoritative version. */
export type WallConfigLatest = Record<string, unknown> & { version?: number }

export type WallConfigWriteResult =
  /** `version` is null when the server accepted but returned no version; the
   *  writer then treats its base as unknown and re-learns before the next write
   *  rather than guessing. */
  | { status: 'ok'; version: number | null }
  | { status: 'conflict'; latest?: WallConfigLatest }
  | { status: 'error'; error: Error }

export interface WallConfigWriteParams {
  /** Workspace id — the route's auth check keys on this path segment. */
  wsKey: string
  /** Room id — selects the per-room blob. */
  roomId: string
  /** The config to store (without `version`; the server stamps it). */
  config: unknown
  /** Let the POST outlive a navigation (Save & Exit, text saves). */
  keepalive?: boolean
  /**
   * Adopt the server's version and return the conflict WITHOUT firing
   * onConflict. Used by the first-entry default-config write, where a 409 just
   * means another client seeded the same defaults — nobody's edit was lost, so
   * a toast would be a lie.
   */
  silentConflict?: boolean
  /**
   * On a 409, adopt the server's version and immediately re-POST THIS config on
   * top of it, up to MAX_REBASE_RETRIES times, instead of reloading the server's
   * layout and discarding the user's edit. Defaults to true.
   *
   * Rebase is NOT unconditional last-write-wins anymore. It fires ONLY when the
   * stored blob's `lastWriterId` is THIS user — the same human overlapping with
   * themselves (two tabs, or an in-flight write), where re-posting their newest
   * intent loses nothing. When a DIFFERENT user wrote last — or the blob predates
   * lastWriterId — the writer reports the conflict instead of rebasing, so a
   * second editor's work is never silently overwritten. This flag governs only
   * the same-user branch; a different-writer 409 always reports regardless of it.
   *
   * Pass false when THIS config is not the user's intent for the room — the
   * first-entry seed writes DEFAULT_CONFIG, so rebasing it onto a room that
   * turned out to already have a layout would replace a real room with an empty
   * one. That is data loss, not a false toast.
   */
  rebaseOnConflict?: boolean
  signal?: AbortSignal
}

export interface WallConfigWriter {
  /** Queue a write. Resolves once it reaches the front of the queue and lands. */
  write(params: WallConfigWriteParams): Promise<WallConfigWriteResult>
  /** Adopt a version learned from a load GET, for one room. */
  setVersion(roomId: string, version: number): void
  /**
   * Forget a room's version, optionally recording the config our local state for
   * it is based on. Called when a load never obtained a version (baseline =
   * whatever we fell back to).
   *
   * The baseline is what makes the next write safe. Version-unknown means we
   * loaded from a stale localStorage copy or from defaults, so the config in hand
   * is NOT derived from whatever the server holds. The next write re-learns the
   * version from a GET, but may only adopt it if the stored config still equals
   * this baseline — otherwise the server has content we never saw and writing
   * would silently destroy it. No baseline = nothing to justify a write against.
   */
  markVersionUnknown(roomId: string, baseline?: unknown): void
  /**
   * The room the user is actually looking at, or null when no studio is mounted.
   * Conflicts for any OTHER room are settled silently: a room we've navigated
   * away from can still have a write in flight (the page flushes its pending
   * autosave on room change), and pushing that room's config or toast into the UI
   * of the room now on screen — or of a page that has no studio at all — would be
   * both wrong and alarming.
   */
  setCurrentRoom(roomId: string | null): void
  /** null = unknown. Diagnostics. */
  getVersion(roomId: string): number | null
}

function configUrl(wsKey: string, roomId: string): string {
  return `/api/studios/${wsKey}/wall-config?roomId=${encodeURIComponent(roomId)}`
}

/**
 * Deep compare that ignores object key order and a top-level `version`.
 *
 * `version` is stripped from both sides because WallConfig carries an optional
 * one (lib/wallLayout.ts) and the route overwrites it on write — so it is never
 * part of the stored config's identity. Arrays keep their order: `walls` is
 * positional. Undefined-valued keys are dropped to match what JSON.stringify
 * actually put on the wire.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue
      out[key] = canonical(src[key])
    }
    return out
  }
  return value
}

/** The metadata key the writer stamps so a 409 can be attributed to a user. */
const LAST_WRITER_KEY = 'lastWriterId'

/**
 * Strip the two server-/writer-owned metadata keys so neither counts toward a
 * config's identity: `version` (the route overwrites it on write) and
 * `lastWriterId` (stamped on every write below). Two configs that differ only in
 * who saved them last, or at what version, are the SAME layout — the exactly-once
 * self-heal and the version-unknown rebase guard both depend on that, so a blob
 * that gained a lastWriterId must still compare equal to the un-stamped baseline
 * a load handed us.
 */
function stripMeta(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const { version: _version, [LAST_WRITER_KEY]: _lastWriterId, ...rest } = value as Record<string, unknown>
  return rest
}

function sameStoredConfig(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(canonical(stripMeta(a))) === JSON.stringify(canonical(stripMeta(b)))
  )
}

/** Read the stored blob's writer id, or null when it's absent/blank (legacy). */
function lastWriterOf(config: unknown): string | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const v = (config as Record<string, unknown>)[LAST_WRITER_KEY]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Stamp the current writer onto the config that goes on the wire. Objects only —
 * a non-object config passes through untouched, and a null userId leaves the blob
 * unstamped. Unstamped fails safe: the next 409 against it can't be attributed to
 * us, so the writer reports rather than clobbers.
 */
function withLastWriter(config: unknown, userId: string | null): unknown {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  if (!userId) return config
  return { ...(config as Record<string, unknown>), [LAST_WRITER_KEY]: userId }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/** Per-room concurrency state. `baseline` matters only while `version` is null. */
type RoomVersionState = { version: number | null; baseline: unknown }

/** One POST attempt, classified. Never throws. */
type Attempt =
  | { kind: 'ok'; version: number | null }
  | { kind: 'conflict'; latest?: WallConfigLatest }
  /** Reached the server and it said no — retrying is pointless for 4xx but the
   *  caller only retries transport failures, so this is terminal. */
  | { kind: 'rejected'; error: Error }
  /** Transport-layer failure: the request may or may not have committed. */
  | { kind: 'unreachable'; error: Error }

export function useWallConfigWriter(
  onConflict: (latest: WallConfigLatest) => void
): WallConfigWriter {
  // Version state is keyed BY ROOM, because that is what it describes: the
  // version of one room's blob. Keeping a single shared version meant room A's
  // number could be used as room B's baseVersion, and no amount of
  // reset-on-navigation fixed it cleanly — the page flushes room A's pending
  // autosave DURING the switch, so that write legitimately still needs room A's
  // version after the UI has moved on. Per-room state makes the leak impossible
  // by construction and lets the trailing flush succeed.
  const roomsRef = useRef<Map<string, RoomVersionState>>(new Map())
  // The room on screen. Only used to decide whether a conflict is the user's to
  // see — never to pick a version.
  const currentRoomRef = useRef<string | null>(null)
  // The mutex. Every write links onto this chain; it never rejects and never
  // carries a value, so one failure can't wedge the queue.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())

  // The session user id, stamped into every write so a later 409 can tell "me in
  // another tab" (rebase) from "a different editor" (report). Read through a ref
  // so the write callbacks stay referentially stable. Resolved from the supabase
  // session, cached, and refreshed on sign-in/out.
  const userIdRef = useRef<string | null>(null)
  const resolveUserId = useCallback(async (): Promise<string | null> => {
    if (userIdRef.current) return userIdRef.current
    try {
      const { data } = (await supabase.auth.getSession()) as { data: { session: Session | null } }
      userIdRef.current = data.session?.user?.id ?? null
    } catch {
      // Leave null — the write goes unstamped and any 409 fails safe to "report".
    }
    return userIdRef.current
  }, [])
  // Populate eagerly and track auth changes so even the very first write is
  // stamped (a user editing walls is authenticated, so getSession resolves an id
  // without a network round-trip).
  useEffect(() => {
    let active = true
    ;(supabase.auth.getSession() as Promise<{ data: { session: Session | null } }>)
      .then(({ data }) => {
        if (active) userIdRef.current = data.session?.user?.id ?? null
      })
      .catch(() => {})
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        userIdRef.current = session?.user?.id ?? null
      }
    )
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const stateFor = useCallback((roomId: string): RoomVersionState => {
    let state = roomsRef.current.get(roomId)
    if (!state) {
      // Unseen room: version unknown, and no baseline to justify a write. The
      // page's load calls setVersion (or markVersionUnknown with a baseline)
      // before the room is editable.
      state = { version: null, baseline: undefined }
      roomsRef.current.set(roomId, state)
    }
    return state
  }, [])

  // Held in a ref so `write` stays referentially stable across renders — the
  // queue must survive re-renders or it isn't a queue.
  const onConflictRef = useRef(onConflict)
  useEffect(() => {
    onConflictRef.current = onConflict
  }, [onConflict])

  const setVersion = useCallback(
    (roomId: string, version: number) => {
      if (!Number.isFinite(version)) return
      const state = stateFor(roomId)
      state.version = version
      state.baseline = undefined // known version — nothing to reconcile
    },
    [stateFor]
  )

  const markVersionUnknown = useCallback(
    (roomId: string, baseline?: unknown) => {
      const state = stateFor(roomId)
      state.version = null
      state.baseline = baseline
    },
    [stateFor]
  )

  const setCurrentRoom = useCallback((roomId: string | null) => {
    currentRoomRef.current = roomId
  }, [])

  const getVersion = useCallback((roomId: string) => stateFor(roomId).version, [stateFor])

  /**
   * GET the room's stored blob. Returns null when it can't be read — we keep the
   * config, not just the version, because deciding whether a re-learned version
   * is safe to adopt requires knowing WHAT is stored, not only how new it is.
   */
  const fetchLatest = useCallback(
    async (
      p: WallConfigWriteParams
    ): Promise<{ version: number; config: unknown; exists: boolean } | null> => {
      try {
        const res = await fetch(configUrl(p.wsKey, p.roomId), {
          cache: 'no-store',
          signal: p.signal,
        })
        if (!res.ok) return null
        const data = (await res.json().catch(() => null)) as
          | { version?: unknown; config?: unknown; exists?: unknown; readError?: unknown }
          | null
        // The route couldn't determine what's stored. `exists:false` here means
        // "don't know", NOT "nothing there" — and the caller reads !exists as
        // "nothing to destroy", so letting this through would license the very
        // clobber the rebase guard exists to prevent. Unreadable == unknown.
        if (data?.readError === true) return null
        const v = data?.version
        if (typeof v !== 'number' || !Number.isFinite(v)) return null
        return { version: v, config: data?.config ?? null, exists: data?.exists === true }
      } catch {
        return null
      }
    },
    []
  )

  const sendOnce = useCallback(async (p: WallConfigWriteParams, baseVersion: number): Promise<Attempt> => {
    let res: Response
    try {
      res = await fetch(configUrl(p.wsKey, p.roomId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(p.keepalive ? { keepalive: true } : {}),
        ...(p.signal ? { signal: p.signal } : {}),
        // Built fresh per attempt from the base this write read once it held the
        // queue — never from a string captured before that. The config is stamped
        // with this session's user id so a later 409 against the blob can tell
        // whether it was us (rebase) or a different editor (report). userIdRef is
        // populated by doWrite before any send.
        body: JSON.stringify({ baseVersion, config: withLastWriter(p.config, userIdRef.current) }),
      })
    } catch (err) {
      return { kind: 'unreachable', error: toError(err) }
    }
    if (res.status === 409) {
      const data = await res
        .json()
        .catch(() => ({} as { latest?: WallConfigLatest }))
      return { kind: 'conflict', latest: data.latest }
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({} as { error?: string }))
      return { kind: 'rejected', error: new Error(data?.error || `HTTP ${res.status}`) }
    }
    const data = await res.json().catch(() => ({} as { version?: number }))
    return { kind: 'ok', version: typeof data.version === 'number' ? data.version : null }
  }, [])

  /**
   * Resolve a real conflict: adopt the server's version for that room, and report
   * it so the page reloads + toasts — but only when the conflict belongs to the
   * room on screen. For a room we've navigated away from, the version is still
   * worth keeping (we may come back) while the UI must not be touched.
   */
  const settleConflict = useCallback(
    (p: WallConfigWriteParams, latest: WallConfigLatest | undefined): WallConfigWriteResult => {
      if (latest && typeof latest.version === 'number') {
        const state = stateFor(p.roomId)
        state.version = latest.version
        state.baseline = undefined // the page adopts `latest` as its new state
      }
      const onScreen = currentRoomRef.current === p.roomId
      if (latest && onScreen && !p.silentConflict) onConflictRef.current(latest)
      return { status: 'conflict', latest }
    },
    [stateFor]
  )

  /**
   * Runs only at the front of the queue, so the room state read here already
   * carries the version the previous write adopted — never a value captured
   * before this write had the lock.
   */
  const doWrite = useCallback(
    async (p: WallConfigWriteParams): Promise<WallConfigWriteResult> => {
      // Keyed by the room THIS write targets, not by whatever is on screen — a
      // trailing flush of the room we just left must still use that room's
      // version, which is exactly the case a shared version got wrong.
      const state = stateFor(p.roomId)
      // Make sure the writer id is known before any send stamps it, and capture it
      // once so every attempt in this write (transport retries + rebases) and the
      // conflict attribution below all agree on the same value.
      const userId = await resolveUserId()
      /**
       * A null version leaves us without a base, so record what we just wrote as
       * the new baseline — the server is now known to hold exactly that.
       */
      const adopt = (v: number | null, baselineWhenUnknown?: unknown) => {
        state.version = v
        state.baseline = v === null ? baselineWhenUnknown : undefined
      }

      // Version-unknown rebase. Reachable ONLY when the load never learned a
      // version (its GET failed), which means the config we hold came from stale
      // localStorage or from defaults — NOT from the server. Adopting the stored
      // version and writing anyway would silently overwrite a layout we never
      // saw, which is worse than the false 409 this whole change exists to fix.
      // So rebase only when the stored config still equals the baseline our edits
      // were built on; otherwise the server has moved and this is a REAL conflict.
      // Never reached for an ordinary 409.
      let base = state.version
      if (base === null) {
        const latest = await fetchLatest(p)
        if (latest === null) {
          // Writing blind here could clobber whatever the server holds, so don't.
          return {
            status: 'error',
            error: new Error('Could not reach the server to check the current layout version.'),
          }
        }
        const baseline = state.baseline
        const storedMatchesBaseline =
          baseline !== undefined && sameStoredConfig(latest.config, baseline)
        // `!exists` = no blob at all, so there is nothing to destroy.
        if (latest.exists && !storedMatchesBaseline) {
          return settleConflict(p, {
            ...(latest.config as Record<string, unknown>),
            version: latest.version,
          })
        }
        base = latest.version
        adopt(base)
      }

      // One logical send at a given base: the POST, plus exactly one retry if the
      // transport died. Folded into a helper so the rebase loop below can treat a
      // send as a single outcome — and so the exactly-once check (our own write
      // coming back as a 409) stays attached to the transport retry that causes
      // it, rather than being confused with a genuine version conflict.
      const sendAt = async (baseVersion: number): Promise<Attempt> => {
        const first = await sendOnce(p, baseVersion)
        if (first.kind !== 'unreachable') return first
        // The transport failed, so the write MAY have committed. Retry with a
        // freshly built payload.
        if (p.signal?.aborted) return first
        const second = await sendOnce(p, baseVersion)
        if (second.kind === 'conflict') {
          // Our first attempt died at the transport layer but may have landed. If
          // what's stored is identical to what we just tried to write, this 409 is
          // our own write coming back at us — not a conflict.
          const stored = second.latest
          if (stored && typeof stored.version === 'number' && sameStoredConfig(stored, p.config)) {
            return { kind: 'ok', version: stored.version }
          }
        }
        return second
      }

      // Rebase loop. A 409 here means the stored version moved after we read our
      // base. Whether that is safe to rebase over depends on WHO moved it (checked
      // per-iteration below via lastWriterId): the same user overlapping with
      // themselves may re-post their pending config, but a different editor must
      // not be clobbered. When we do rebase, it is bounded — if the version keeps
      // moving out from under us we stop guessing and fall back to reload-and-toast,
      // which is loud but never loses work silently.
      const allowRebase = p.rebaseOnConflict !== false
      for (let rebases = 0; ; rebases++) {
        // Adopt straight from the response rather than re-reading state — a null
        // version means the server accepted but didn't tell us the new one, so we
        // go UNKNOWN and the next write re-learns instead of reusing a base we can
        // no longer justify.
        const attempt = await sendAt(base)
        if (attempt.kind === 'ok') {
          adopt(attempt.version, p.config)
          return { status: 'ok', version: attempt.version }
        }
        if (attempt.kind === 'rejected' || attempt.kind === 'unreachable') {
          return { status: 'error', error: attempt.error }
        }

        // attempt.kind === 'conflict'
        // Attribute the 409 by who wrote the stored blob last. Rebase only when
        // that was THIS user (same human, two tabs / in-flight overlap) — re-posting
        // their newest intent loses nothing. A different writer, or a legacy blob
        // with no lastWriterId, is a genuine second editor: fall through to
        // settleConflict so their layout is not silently clobbered. Absent id →
        // lastWriterOf is null → not us → reports. Fails safe.
        const storedWriter = lastWriterOf(attempt.latest)
        const sameWriter = storedWriter !== null && storedWriter === userId
        const nextBase = attempt.latest?.version
        const canRebase =
          allowRebase &&
          sameWriter &&
          rebases < MAX_REBASE_RETRIES &&
          typeof nextBase === 'number' &&
          Number.isFinite(nextBase) &&
          !p.signal?.aborted
        if (!canRebase) return settleConflict(p, attempt.latest)

        // Take the server's version as our new base and re-post OUR config on it.
        // No onConflict here: nothing is being discarded, so there is nothing to
        // warn about — the toast is reserved for work actually lost.
        base = nextBase as number
        adopt(base)
      }
    },
    [fetchLatest, sendOnce, settleConflict, stateFor, resolveUserId]
  )

  const write = useCallback(
    (params: WallConfigWriteParams): Promise<WallConfigWriteResult> => {
      // Link onto the chain on BOTH settle paths so a rejection upstream can't
      // strand this write forever. The trailing catch makes `write` total: some
      // callers fire it without awaiting, and a rejection there would surface as
      // an unhandled rejection rather than a result they can act on.
      const run = chainRef.current
        .then(
          () => doWrite(params),
          () => doWrite(params)
        )
        .catch((err): WallConfigWriteResult => ({ status: 'error', error: toError(err) }))
      chainRef.current = run.then(
        () => undefined,
        () => undefined
      )
      return run
    },
    [doWrite]
  )

  // Stable identity. Every callback above closes over refs only and has empty
  // (or transitively empty) deps, so this object is created once — consumers put
  // it in effect deps and thread it through props, and the queue must not be
  // rebuilt on re-render. `onConflict` is the only changing input and it is
  // funnelled through onConflictRef rather than a dep.
  return useMemo(
    () => ({ write, setVersion, markVersionUnknown, setCurrentRoom, getVersion }),
    [write, setVersion, markVersionUnknown, setCurrentRoom, getVersion]
  )
}
