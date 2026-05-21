-- Migration 018: Add room_share_tokens table for token-based room sharing.
--
-- One active (non-revoked) token per room, enforced by a partial unique index.
-- All access is via the service-role client; no RLS policies are set.

BEGIN;

CREATE TABLE room_share_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL UNIQUE,
  created_by  UUID        NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked     BOOLEAN     NOT NULL DEFAULT false
);

-- Enforce one active token per room (partial index, only counts non-revoked rows)
CREATE UNIQUE INDEX room_share_tokens_one_active_per_room
  ON room_share_tokens(room_id)
  WHERE revoked = false;

CREATE INDEX room_share_tokens_token_idx ON room_share_tokens(token);

ALTER TABLE room_share_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: all reads/writes go through the service-role client.

COMMIT;
