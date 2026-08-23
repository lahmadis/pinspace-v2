-- Migration 038: canvases that belong to a PERSON, not a room.
--
-- A desk crit is one canvas. You make a new one per crit, from the dashboard,
-- and it is yours — it does not live inside a 3D space. That is a different
-- anchor from the one 036 built, which scoped every canvas to a room so the
-- existing owner/member/org resolution could be reused wholesale.
--
--
-- WHY NOT JUST PUT THEM IN A ROOM ANYWAY
--
-- Because a desk crit is not a space. Forcing one would mean either inventing
-- a hidden per-user room (a row nobody asked for, that shows up in every place
-- that lists rooms) or making the user pick an unrelated studio before they
-- can take notes. Both are worse than a nullable anchor.
--
--
-- WHAT THIS COSTS, STATED PLAINLY
--
-- room_id was the access anchor for EVERYTHING in 036: app-code resolution in
-- lib/canvas/access.ts, and the four SELECT policies that let realtime deliver.
-- A canvas with no room satisfies none of them. So this migration adds a
-- second anchor and the one policy pair that makes it work, and app code gains
-- a branch. Existing room canvases are untouched and keep every guarantee they
-- had — the branch is additive.
--
-- Sharing is deliberately NOT part of this. A personal canvas is visible to
-- its owner and to nobody else: no members, no org, no guest tokens, no public
-- path. That is the whole permission model, and it is small on purpose — the
-- room canvases already demonstrate how much surface the alternative carries.
--
--
-- THE RLS SUBQUERY TRAP, AGAIN
--
-- The new canvas_nodes policy has to ask "does this node's canvas belong to
-- me", which is a subquery against `canvases`. Subqueries inside a policy run
-- under the CALLER's RLS, and 036 left `canvases` with RLS enabled and no
-- policies at all — so that subquery would return zero rows for every real
-- user and the policy would never match. Silently: no error, just a canvas
-- that never receives a realtime event.
--
-- This is the same shape as the bug 030 fixed for board_comments/board_traces
-- and the same one 036's own header warns about for workspace_members. The fix
-- is the canvases SELECT policy below, and it exists FOR the subquery — not
-- because anything subscribes to `canvases`.
--
-- Idempotent: every CREATE POLICY is preceded by DROP POLICY IF EXISTS, and
-- the column adds use IF NOT EXISTS.

BEGIN;

-- ---------------------------------------------------------------------------
-- canvases: a second anchor.
-- ---------------------------------------------------------------------------

-- Supabase uid, TEXT to match created_by and workspaces.owner_id. NULL for
-- every canvas that lives in a room.
ALTER TABLE canvases ADD COLUMN IF NOT EXISTS owner_id TEXT;

ALTER TABLE canvases ALTER COLUMN room_id DROP NOT NULL;

-- EXACTLY one anchor, not "at least one".
--
-- Deliberately not backfilling owner_id from created_by on existing rows: a
-- room canvas's creator is not its owner in any sense the access check uses,
-- and setting both would make every existing canvas violate this constraint
-- while quietly implying a personal-ownership claim that isn't true.
--
-- Two anchors would also be genuinely ambiguous rather than merely untidy —
-- resolveCanvasAccess would have to decide which one wins, and the safe answer
-- (the most permissive) is the wrong default for private crit notes.
ALTER TABLE canvases DROP CONSTRAINT IF EXISTS canvases_one_anchor_chk;
ALTER TABLE canvases ADD CONSTRAINT canvases_one_anchor_chk
  CHECK (num_nonnulls(room_id, owner_id) = 1);

-- The dashboard list is "my canvases, newest first", so the index carries the
-- sort key too and the listing never sorts a heap.
CREATE INDEX IF NOT EXISTS canvases_owner_created_idx
  ON canvases(owner_id, created_at DESC) WHERE owner_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- canvas_nodes: room_id becomes optional.
--
-- It stays NOT NULL in spirit for room canvases — the API derives it from the
-- parent canvas and always writes it for those — but a personal canvas has no
-- room to derive, and a sentinel value would be worse than a NULL: the four
-- existing policies all pivot on this column, and `NULL IN (SELECT ...)` is
-- NULL rather than true, so personal nodes correctly match none of them. A
-- fake room id would have had to match one.
-- ---------------------------------------------------------------------------
ALTER TABLE canvas_nodes ALTER COLUMN room_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- The policy pair. Read the RLS-subquery note in the header before touching
-- either of these — they only work together.
-- ---------------------------------------------------------------------------

-- Exists so the canvas_nodes policy below can see `canvases` at all. Grants a
-- user read access to the rows describing their own personal canvases: their
-- own titles and timestamps, nothing else, and no write of any kind. Room
-- canvases have owner_id NULL and so remain invisible here, exactly as before.
DROP POLICY IF EXISTS "Owners can view their own personal canvases" ON canvases;
CREATE POLICY "Owners can view their own personal canvases"
ON canvases FOR SELECT
USING (owner_id = auth.uid()::text);

-- Realtime delivery for a personal canvas. Without it the owner's second tab
-- never learns about the first tab's edits — the exact silent starvation
-- migration 030 was written to repair.
DROP POLICY IF EXISTS "Owners can view nodes on their personal canvases" ON canvas_nodes;
CREATE POLICY "Owners can view nodes on their personal canvases"
ON canvas_nodes FOR SELECT
USING (
  canvas_id IN (
    SELECT c.id FROM canvases c WHERE c.owner_id = auth.uid()::text
  )
);

-- canvas_nodes is already in supabase_realtime with REPLICA IDENTITY FULL from
-- 036; no publication change is needed here. `canvases` is still deliberately
-- unpublished — the dashboard list refetches, it does not subscribe.

COMMIT;
