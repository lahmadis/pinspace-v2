-- Migration 028: Critique layer (Phase A.1) — anchored comments, drawing traces,
-- and room-scoped expiring guest-critic tokens.
--
-- Three tables, all service-role-only (RLS enabled, NO policies — matching the
-- room_share_tokens pattern in migration 018). board_comments and board_traces
-- are added to the supabase_realtime publication with REPLICA IDENTITY FULL so
-- filtered DELETE events carry room_id (same rationale as migration 023 for boards).
--
-- ORDER NOTE: guest_tokens is created FIRST because board_comments and
-- board_traces both FK-reference it. (The diagnostic report listed it last; a
-- forward reference would be a syntax error, so it is hoisted here.)
--
-- Anchors (board_comments.anchor_x/y, and trace stroke points) are fractions
-- 0..1 of the image's intrinsic dimensions — resolution-independent, survive
-- board/wall resize.

-- ---------------------------------------------------------------------------
-- guest_tokens — room-scoped, expiring critic access (capability-bearing).
-- Multiple named, individually-expiring/revocable links per room.
-- ---------------------------------------------------------------------------
CREATE TABLE guest_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,                     -- base64url, like room_share_tokens
  label         TEXT,                                     -- "External critic — Jane"
  can_comment   BOOLEAN NOT NULL DEFAULT true,
  can_trace     BOOLEAN NOT NULL DEFAULT true,
  expires_at    TIMESTAMPTZ,                              -- NULL = no expiry; else enforced in app code
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX guest_tokens_room_idx  ON guest_tokens(room_id);
CREATE INDEX guest_tokens_token_idx ON guest_tokens(token);
ALTER TABLE guest_tokens ENABLE ROW LEVEL SECURITY;       -- no policies: service-role only
-- not subscribed via postgres_changes → no publication line needed

-- ---------------------------------------------------------------------------
-- board_comments — anchored, threaded callouts.
-- ---------------------------------------------------------------------------
CREATE TABLE board_comments (
  id                TEXT PRIMARY KEY,                    -- app-gen, matches comments convention
  board_id          TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  room_id           UUID NOT NULL REFERENCES rooms(id)  ON DELETE CASCADE, -- for realtime filter
  parent_id         TEXT REFERENCES board_comments(id)  ON DELETE CASCADE, -- NULL = root pin; set = reply
  anchor_x          REAL,   -- 0..1 fraction of image width;  NULL = unanchored/thread reply
  anchor_y          REAL,   -- 0..1 fraction of image height
  body              TEXT NOT NULL,
  -- author: exactly one identity path is populated
  author_id         TEXT,                                 -- Supabase uid (account user)
  guest_token_id    UUID REFERENCES guest_tokens(id) ON DELETE SET NULL, -- guest critic
  author_name       TEXT NOT NULL,                        -- display name (account or guest-entered)
  resolved          BOOLEAN NOT NULL DEFAULT false,       -- critique threads get resolved
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT board_comments_author_chk
    CHECK (author_id IS NOT NULL OR guest_token_id IS NOT NULL)
);
CREATE INDEX board_comments_board_idx  ON board_comments(board_id);
CREATE INDEX board_comments_parent_idx ON board_comments(parent_id);
CREATE INDEX board_comments_room_idx   ON board_comments(room_id);
ALTER TABLE board_comments ENABLE ROW LEVEL SECURITY;   -- no policies: service-role only

-- REQUIRED if subscribed via postgres_changes (CLAUDE.md hard rule):
ALTER PUBLICATION supabase_realtime ADD TABLE public.board_comments;
ALTER TABLE public.board_comments REPLICA IDENTITY FULL;  -- so filtered DELETE carries room_id

-- ---------------------------------------------------------------------------
-- board_traces — per-author drawing layer (JSON strokes, image-fraction coords).
-- ---------------------------------------------------------------------------
CREATE TABLE board_traces (
  id                TEXT PRIMARY KEY,
  board_id          TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  room_id           UUID NOT NULL REFERENCES rooms(id)  ON DELETE CASCADE,
  author_id         TEXT,
  guest_token_id    UUID REFERENCES guest_tokens(id) ON DELETE SET NULL,
  author_name       TEXT NOT NULL,
  author_color      TEXT,                                 -- per-critic ink color
  -- strokes: [{ color, width, points: [[x,y],...] }]  where x,y are 0..1 image fractions
  strokes           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT board_traces_author_chk
    CHECK (author_id IS NOT NULL OR guest_token_id IS NOT NULL)
);
-- one editable layer per author per board
CREATE UNIQUE INDEX board_traces_board_author_ux
  ON board_traces(board_id, COALESCE(author_id, guest_token_id::text));
CREATE INDEX board_traces_board_idx ON board_traces(board_id);
ALTER TABLE board_traces ENABLE ROW LEVEL SECURITY;       -- service-role only

ALTER PUBLICATION supabase_realtime ADD TABLE public.board_traces;  -- if live
ALTER TABLE public.board_traces REPLICA IDENTITY FULL;
