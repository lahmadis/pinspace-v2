-- Migration 039: spoken record of a desk crit.
--
-- One row per RECORDING SEGMENT, not one per canvas.
--
--
-- WHY SEGMENTS
--
-- The obvious shape is one transcript row per canvas that recording appends
-- to. That makes every stop a read-modify-write on a growing text column: two
-- overlapping writes and a chunk of speech is silently overwritten. Losing
-- part of the record of a crit is exactly the failure this table exists to
-- prevent.
--
-- Insert-only segments cannot overwrite. "The transcript" is the segments in
-- recorded_at order, joined — which the summary step in a later phase wants
-- anyway — and a bad segment can be deleted without rewriting the rest.
--
-- What this does NOT prevent is DUPLICATION. There is no idempotency key, so a
-- POST that commits but loses its response is retried by the client and lands
-- twice. That trade is deliberate: a duplicated paragraph is visible in the
-- panel and can be deleted, whereas a silently overwritten one is gone. If
-- duplicates ever become common, the fix is a client-supplied id and an upsert,
-- not a return to the single-row shape.
--
--
-- WHY NO POLICIES AND NO PUBLICATION
--
-- Nothing subscribes to this table. Transcription is a local act: the browser
-- that is recording already holds every word before the row exists, so a
-- realtime echo would tell it only what it just said. That is why there is no
-- ALTER PUBLICATION here and no SELECT policy — RLS on with zero policies means
-- service-role only, and every read goes through the API behind the same
-- resolveCanvasAccess check the nodes use.
--
-- Contrast canvas_nodes, which genuinely needs both (036, 038): a second person
-- — or a second tab — draws, and you must see it. Nobody speaks into your crit
-- from another machine.
--
-- If a later phase ever shows a live transcript on a shared surface, that is
-- the moment to add a SELECT policy, and the moment it will silently deliver
-- nothing if forgotten. See migration 030 for how that goes.
--
-- Idempotent: IF NOT EXISTS throughout.

BEGIN;

-- ---------------------------------------------------------------------------
-- canvas_transcripts — one span of speech, transcribed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canvas_transcripts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id    UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  -- Which transcriber produced this. Recorded per ROW rather than assumed,
  -- because the provider is meant to change: the browser's Web Speech API now,
  -- a server-side model later, and a crit recorded across that switch will hold
  -- segments from both. A summary that cites the transcript should be able to
  -- tell how it was made.
  source       TEXT NOT NULL DEFAULT 'web-speech',
  -- When the speech happened, not when the row was written. They differ by the
  -- length of the segment, and ordering by created_at would be wrong for any
  -- segment saved out of order after a retry.
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT NOT NULL,                     -- Supabase uid, TEXT like created_by elsewhere
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bounded so one runaway segment cannot become the whole payload. Roughly
  -- an hour of continuous speech at speaking pace; the client splits on
  -- silence long before this, so reaching it means something has gone wrong.
  CONSTRAINT canvas_transcripts_text_len_chk CHECK (char_length(text) <= 100000),
  -- An empty segment is a recording that captured nothing. Storing it would put
  -- blank runs through the middle of the joined transcript.
  CONSTRAINT canvas_transcripts_text_present_chk CHECK (char_length(btrim(text)) > 0)
);

-- The only read this table has: every segment of one canvas, in spoken order.
CREATE INDEX IF NOT EXISTS canvas_transcripts_canvas_time_idx
  ON canvas_transcripts(canvas_id, recorded_at);

ALTER TABLE canvas_transcripts ENABLE ROW LEVEL SECURITY;  -- no policies: service-role only

COMMIT;
