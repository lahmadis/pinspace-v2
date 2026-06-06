-- Migration 030: SELECT-only RLS so realtime postgres_changes reaches members.
--
-- WHY: Supabase Realtime evaluates each table's SELECT policies as the
-- subscribing authenticated user. A changed row with no matching SELECT policy
-- is silently dropped from that user's stream. boards/comments only had
-- owner + public + org SELECT policies (no workspace-membership policy), and
-- board_comments/board_traces had NO policies at all (service-role-only, per
-- migration 028). So a joined, non-owner member of a SHARED workspace received
-- no studio-boards:${roomId} events — the board only appeared on a refresh,
-- which goes through the service-role /api/boards route that bypasses RLS.
--
-- WHAT: add membership-aware SELECT policies, mirroring the existing rooms
-- policy set (migration 014). This is defense-in-depth ADDED for realtime
-- delivery — it does NOT replace the service-role + app-check pattern. Writes
-- stay API-enforced via the service role: we add SELECT policies ONLY, no
-- INSERT/UPDATE/DELETE.
--
-- SCOPE: boards/comments already grant owner/public/org SELECT (verified
-- against live pg_policies), so we add only the missing MEMBER policy there.
-- board_comments/board_traces have no policies, so they get the full
-- owner/member/public/org set, pivoted through room_id -> rooms -> workspace.
--
-- RLS-RESOLUTION NOTES (subqueries below run under the caller's RLS):
--   * The MEMBER branch references workspace_members DIRECTLY, never
--     `JOIN workspaces` — workspaces has no member SELECT policy, so a member
--     cannot read the workspaces row, but CAN read their own workspace_members
--     row (get_my_workspace_ids()) and the matching rooms row (rooms member
--     policy). This mirrors the live, working rooms member policy.
--   * The owner/public/org branches JOIN workspaces because those three
--     workspaces SELECT policies DO exist, so the rows resolve.
--   * No new table is created and nothing is added to supabase_realtime here,
--     so no ALTER PUBLICATION line is needed (the tables are already published).
--
-- Idempotent: every CREATE is preceded by DROP POLICY IF EXISTS.

BEGIN;

-- ===========================================================================
-- boards — add the missing membership SELECT (owner/public/org already exist).
-- ===========================================================================
DROP POLICY IF EXISTS "Members can view boards in member workspaces" ON boards;
CREATE POLICY "Members can view boards in member workspaces"
ON boards FOR SELECT
USING (
  workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid()::text
  )
);

-- ===========================================================================
-- comments — add the missing membership SELECT (owner/public/org already exist).
-- Resolves through board_id -> boards (boards member policy added above makes
-- the inner board rows visible to members).
-- ===========================================================================
DROP POLICY IF EXISTS "Members can view comments on member workspace boards" ON comments;
CREATE POLICY "Members can view comments on member workspace boards"
ON comments FOR SELECT
USING (
  board_id IN (
    SELECT id FROM boards
    WHERE workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()::text
    )
  )
);

-- ===========================================================================
-- board_comments — no policies today; add full owner/member/public/org SELECT.
-- room_id -> rooms -> workspace (board_comments has no workspace_id column).
-- ===========================================================================
DROP POLICY IF EXISTS "Users can view board_comments in their own workspaces" ON board_comments;
CREATE POLICY "Users can view board_comments in their own workspaces"
ON board_comments FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.owner_id = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Members can view board_comments in member workspaces" ON board_comments;
CREATE POLICY "Members can view board_comments in member workspaces"
ON board_comments FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    WHERE r.workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()::text
    )
  )
);

DROP POLICY IF EXISTS "Anyone can view board_comments in public workspaces" ON board_comments;
CREATE POLICY "Anyone can view board_comments in public workspaces"
ON board_comments FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.is_public = true AND w.published_at IS NOT NULL
  )
);

DROP POLICY IF EXISTS "Org members can view board_comments in org workspaces" ON board_comments;
CREATE POLICY "Org members can view board_comments in org workspaces"
ON board_comments FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.organization_id IS NOT NULL
      AND w.organization_id = get_my_institution_id()
  )
);

-- ===========================================================================
-- board_traces — no policies today; same full SELECT set as board_comments.
-- ===========================================================================
DROP POLICY IF EXISTS "Users can view board_traces in their own workspaces" ON board_traces;
CREATE POLICY "Users can view board_traces in their own workspaces"
ON board_traces FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.owner_id = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Members can view board_traces in member workspaces" ON board_traces;
CREATE POLICY "Members can view board_traces in member workspaces"
ON board_traces FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    WHERE r.workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()::text
    )
  )
);

DROP POLICY IF EXISTS "Anyone can view board_traces in public workspaces" ON board_traces;
CREATE POLICY "Anyone can view board_traces in public workspaces"
ON board_traces FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.is_public = true AND w.published_at IS NOT NULL
  )
);

DROP POLICY IF EXISTS "Org members can view board_traces in org workspaces" ON board_traces;
CREATE POLICY "Org members can view board_traces in org workspaces"
ON board_traces FOR SELECT
USING (
  room_id IN (
    SELECT r.id FROM rooms r
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.organization_id IS NOT NULL
      AND w.organization_id = get_my_institution_id()
  )
);

COMMIT;
