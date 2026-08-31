-- 045 — Pinspaces: the boards a person kept from the archive.
--
-- WHY. The archive is ~142 studios organised by department, year and studio —
-- the right shape for FINDING something and a bad one for returning to it a
-- week later. You go looking for the bell-tower section you saw once, and the
-- only route back is to remember which department, which year, and whose it
-- was. A pin is the answer: keep the sheet, and it is on your dashboard.
--
-- WHAT A ROW IS. One person pinning one BOARD — not a space. That is the unit
-- the dashboard shows (a thumbnail you recognise) and the unit the lightbox
-- opens; the space is still one press away, because the card's lightbox carries
-- an "Open 3D space" button that goes to the room the board is pinned up in.
-- The shelf is called Pinspaces in the UI; the table is named for what it
-- actually stores.
--
-- A JOIN TABLE, not a column on boards. A pin is a fact about one person's
-- relationship to a board, not about the board — the same sheet can be pinned
-- by twenty people or none, and boards is read by nearly every surface in the
-- app. Nothing else has to learn these columns.
--
-- board_id is TEXT because boards.id is text (see 042, same reasoning).
-- user_id is text for the same reason workspace_members.user_id is: it holds
-- the auth uuid, and pre-Supabase rows can hold ids that are not uuids.
--
-- ON DELETE CASCADE: deleting a board takes its pins with it. A pin to a sheet
-- whose bytes are gone is a broken tile on someone's dashboard with no way to
-- clear it — see the board-delete path, which already destroys storage.
--
-- RLS: ON, with NO POLICIES — this project's pattern. Reads and writes go
-- through supabaseServiceRole() with access enforced in app code (see
-- app/api/pinspaces/route.ts, which checks you can actually see a board before
-- it will let you pin it). Deliberately NOT added to supabase_realtime:
-- postgres_changes filters per-subscriber RLS, so a table with no SELECT policy
-- delivers no events at all. The dashboard refetches instead.

BEGIN;

CREATE TABLE IF NOT EXISTS pinned_boards (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text        NOT NULL,
  board_id   text        NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Pinning twice is the same pin. The API upserts against this rather than
  -- reading first, so a double-click cannot make two tiles of one sheet.
  CONSTRAINT pinned_boards_user_board_unique UNIQUE (user_id, board_id)
);

-- The one read the dashboard makes: this person's pins, newest first.
CREATE INDEX IF NOT EXISTS pinned_boards_user_created_idx
  ON pinned_boards (user_id, created_at DESC);

-- And the one the lightbox makes: is THIS board pinned by me?
CREATE INDEX IF NOT EXISTS pinned_boards_board_idx
  ON pinned_boards (board_id);

ALTER TABLE pinned_boards ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Verify:
--   SELECT * FROM pinned_boards;  -- expect empty, table exists
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'pinned_boards';  -- expect t
