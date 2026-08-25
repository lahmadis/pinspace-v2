-- Atomic, durable feedback submission with a per-submitter rate limit.

BEGIN;

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS submitter_hash text;

CREATE INDEX IF NOT EXISTS feedback_submitter_created_idx
  ON public.feedback (submitter_hash, created_at DESC)
  WHERE submitter_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.submit_feedback(
  p_message text,
  p_user_id text,
  p_user_email text,
  p_page_url text,
  p_submitter_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recent_count integer;
  feedback_id uuid;
BEGIN
  IF p_message IS NULL OR length(btrim(p_message)) = 0 OR length(btrim(p_message)) > 4000 THEN
    RAISE EXCEPTION 'invalid_feedback_message' USING ERRCODE = '22023';
  END IF;
  IF p_page_url IS NOT NULL AND length(p_page_url) > 2048 THEN
    RAISE EXCEPTION 'invalid_feedback_page_url' USING ERRCODE = '22023';
  END IF;
  IF p_submitter_hash IS NULL OR length(p_submitter_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_feedback_submitter' USING ERRCODE = '22023';
  END IF;

  -- Serialize submissions for this hash so parallel requests cannot race the
  -- count check and bypass the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_submitter_hash, 0));

  SELECT count(*)::integer
  INTO recent_count
  FROM public.feedback
  WHERE submitter_hash = p_submitter_hash
    AND created_at >= now() - interval '10 minutes';

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'feedback_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.feedback (message, user_id, user_email, page_url, submitter_hash)
  VALUES (btrim(p_message), p_user_id, p_user_email, p_page_url, p_submitter_hash)
  RETURNING id INTO feedback_id;

  RETURN feedback_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_feedback(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_feedback(text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.submit_feedback(text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_feedback(text, text, text, text, text) TO service_role;

COMMIT;

-- Verification (run after applying): five submissions for one hash inside ten
-- minutes succeed; the sixth fails with feedback_rate_limited / SQLSTATE P0001.
