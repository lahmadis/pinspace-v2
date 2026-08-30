-- 042 — desk crits drop the canvas; their sheets become real boards.
--
-- WHY. A desk crit's sheets were canvas_nodes: a storage URL inside a JSON
-- `props`, floating at an x/y on a pan-and-zoom stage. That made them a
-- second, parallel kind of image — one that the lightbox could not open, and
-- so one you could not trace on or leave a callout on, because both of those
-- are keyed by boards.id (board_comments.board_id, /api/boards/[id]/traces).
-- A crit is the surface where marking up work matters most, and it was the one
-- surface that could not do it.
--
-- Sheets are boards now. The lightbox, its trace layer and its callouts work
-- verbatim, with no crit-local reimplementation of any of them.
--
-- THREE CHANGES:
--
-- 1. A home for those boards. boards.workspace_id is NOT NULL, and a desk crit
--    has no room and no workspace, so each person gets one workspace of the new
--    type 'deskcrit'. It is created lazily by the API on first upload, never
--    listed as a space, and exists only to satisfy that foreign key. The type
--    is what every list query filters on, so a crit sheet cannot leak into the
--    dashboard, /my-boards, the 2D archive or the network.
--
-- 2. crit_boards — which sheets are in which crit, and which are PINNED.
--    A join table rather than columns on boards: `pinned` is a fact about a
--    board's role in one crit, not about the board, and boards is read by
--    almost every surface in the app. Nothing else has to learn these columns.
--
-- 3. The old canvas content goes. Explicitly requested, and the sheets it held
--    have no path into the new model — a canvas_node has no owner_id, no title
--    and no thumbnail, so it cannot become a board without inventing all three.
--    12 canvases / 31 nodes at time of writing, all of it test data.
--
-- RLS: crit_boards gets RLS ON and NO POLICIES, which is this project's
-- pattern — reads and writes go through supabaseServiceRole() with access
-- enforced in app code. It is deliberately NOT added to supabase_realtime:
-- postgres_changes filters per-subscriber RLS, so a table with no SELECT policy
-- would deliver no events at all. The crit surface refetches instead.

BEGIN;

-- 1. A workspace type that is not a space.
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_type_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_type_check
  CHECK (type = ANY (ARRAY['class'::text, 'personal'::text, 'shared'::text, 'deskcrit'::text]));

-- 2. Which boards are in a crit, and which of them were pinned.
CREATE TABLE IF NOT EXISTS crit_boards (
  crit_id    uuid        NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  board_id   text        NOT NULL REFERENCES boards(id)   ON DELETE CASCADE,
  -- "We talked about this one." Set during the crit, read back afterwards
  -- against the recording, which is the whole point of the gesture.
  pinned     boolean     NOT NULL DEFAULT false,
  -- Display order within the crit. Sparse (10, 20, 30…) so a sheet can be
  -- moved between two others without renumbering the row either side.
  position   integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crit_id, board_id)
);

-- The two reads this table serves: a crit's sheets, and (for cleanup on board
-- delete) which crits a board is in.
CREATE INDEX IF NOT EXISTS crit_boards_crit_idx  ON crit_boards (crit_id, position);
CREATE INDEX IF NOT EXISTS crit_boards_board_idx ON crit_boards (board_id);

ALTER TABLE crit_boards ENABLE ROW LEVEL SECURITY;

-- 3. Start clean. canvas_nodes cascades from canvases, but it is deleted
--    explicitly so this reads as the intent it is rather than a side effect.
DELETE FROM canvas_nodes;
DELETE FROM canvases;

COMMIT;

-- Verify:
--   SELECT count(*) FROM canvases;        -- expect 0
--   SELECT count(*) FROM canvas_nodes;    -- expect 0
--   SELECT * FROM crit_boards;            -- expect empty, table exists
