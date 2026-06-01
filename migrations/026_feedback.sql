-- 026: feedback table — durable backup for "Report a bug / idea" submissions.
--
-- Why: feedback is emailed to Sarah via Resend (app/api/feedback/route.ts), but
-- email can bounce/fail. This table is the source of truth so no feedback is ever
-- lost — the row is inserted (via the service-role client) BEFORE the email send,
-- so it persists even if Resend errors.
--
-- NOTE: numbered 026 because 025 was already taken (025_add_board_absolute_size.sql).
--
-- RLS: enabled with NO policies. The service-role client bypasses RLS, so our
-- server insert still works; meanwhile the anon/authenticated PostgREST roles get
-- no access, so this table is not world-readable/writable. (Enabling RLS does not
-- block the service-role insert.)

BEGIN;

CREATE TABLE IF NOT EXISTS feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message    TEXT NOT NULL,
  user_id    TEXT,
  user_email TEXT,
  page_url   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

COMMIT;
