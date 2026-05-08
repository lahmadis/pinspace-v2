-- Migration 014: Add rooms table between workspaces and boards (Phase 6.0)
--
-- Today, boards.workspace_id points directly at workspaces. We're inserting a
-- rooms layer so a single workspace can hold multiple 3D rooms (pin-up,
-- milestone, review, etc). This phase adds the rooms table, backfills one
-- "Main Room" per existing workspace, and adds boards.room_id alongside
-- boards.workspace_id.
--
-- Both columns coexist in this phase. Reads/writes still go through
-- boards.workspace_id; later phases switch to room_id and eventually drop
-- workspace_id. That makes this migration reversible while we cut over.
--
-- (Filename uses 014 because 008 is taken by 008_add_organization_id_columns.sql.)

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Defensive refresh of get_my_institution_id().
--
-- The function was defined in archive/add_org_logo_and_rls.sql to read
-- user_profiles.institution_id. Migration 009 dropped that column. If the
-- function still references the dropped column it errors on call, which would
-- break every rooms RLS read once the org-member policy below uses it. Redefine
-- against organization_id; idempotent if it was already corrected out-of-band.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_institution_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM user_profiles WHERE user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 1. rooms table
-- ---------------------------------------------------------------------------
CREATE TABLE rooms (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                TEXT         NOT NULL,
  display_order       INTEGER      NOT NULL DEFAULT 0,
  is_published        BOOLEAN      NOT NULL DEFAULT false,
  is_globally_public  BOOLEAN      NOT NULL DEFAULT false,
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX rooms_workspace_id_idx ON rooms(workspace_id);

-- update_updated_at_column() already exists from the boards table setup.
CREATE TRIGGER update_rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2. RLS on rooms — mirrors the boards policy shape, scoped through workspace.
--    Owners can CRUD; members read; public-workspace read; org-member read.
-- ---------------------------------------------------------------------------
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- SELECT: workspace owners
CREATE POLICY "Users can view rooms in their own workspaces"
ON rooms FOR SELECT
USING (
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
);

-- SELECT: workspace members
CREATE POLICY "Members can view rooms in member workspaces"
ON rooms FOR SELECT
USING (
  workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid()::text
  )
);

-- SELECT: anyone, when the parent workspace is published & public
CREATE POLICY "Anyone can view rooms in public workspaces"
ON rooms FOR SELECT
USING (
  workspace_id IN (
    SELECT id FROM workspaces
    WHERE is_public = true AND published_at IS NOT NULL
  )
);

-- SELECT: org members
CREATE POLICY "Org members can view rooms in org workspaces"
ON rooms FOR SELECT
USING (
  workspace_id IN (
    SELECT id FROM workspaces
    WHERE organization_id IS NOT NULL
      AND organization_id = get_my_institution_id()
  )
);

-- INSERT: workspace owners only (members read; they don't add rooms)
CREATE POLICY "Workspace owners can create rooms"
ON rooms FOR INSERT
WITH CHECK (
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
);

-- UPDATE: workspace owners only
CREATE POLICY "Workspace owners can update rooms"
ON rooms FOR UPDATE
USING (
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
)
WITH CHECK (
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
);

-- DELETE: workspace owners only
CREATE POLICY "Workspace owners can delete rooms"
ON rooms FOR DELETE
USING (
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
);

-- ---------------------------------------------------------------------------
-- 3. Backfill: one default "Main Room" per existing workspace.
--
-- The user spec says: "for workspaces where is_published=true, mirror that to
-- the new room (is_published=true, published_at copied)." The actual
-- workspaces schema has no is_published column — the codebase's "published"
-- condition is is_public = true AND published_at IS NOT NULL. We mirror that
-- conjunction onto rooms.is_published and copy published_at as-is. We also
-- carry is_globally_public so a globally-public workspace's content stays
-- globally public when later phases switch reads to the rooms layer.
-- ---------------------------------------------------------------------------
INSERT INTO rooms (workspace_id, name, display_order, is_published, is_globally_public, published_at)
SELECT
  w.id                                                              AS workspace_id,
  'Main Room'                                                       AS name,
  0                                                                 AS display_order,
  COALESCE(w.is_public, false) AND w.published_at IS NOT NULL       AS is_published,
  COALESCE(w.is_globally_public, false)                             AS is_globally_public,
  CASE WHEN COALESCE(w.is_public, false) THEN w.published_at END    AS published_at
FROM workspaces w;

-- ---------------------------------------------------------------------------
-- 4. boards.room_id (nullable for now — not flipped to NOT NULL until later
--    phases drop boards.workspace_id). FK CASCADE so deleting a room takes its
--    boards with it, mirroring how workspace deletion already cascades.
-- ---------------------------------------------------------------------------
ALTER TABLE boards
  ADD COLUMN room_id UUID REFERENCES rooms(id) ON DELETE CASCADE;

CREATE INDEX boards_room_id_idx ON boards(room_id);

-- ---------------------------------------------------------------------------
-- 5. Backfill boards.room_id by joining each board to its workspace's
--    default Main Room.
-- ---------------------------------------------------------------------------
UPDATE boards b
SET room_id = r.id
FROM rooms r
WHERE r.workspace_id = b.workspace_id
  AND r.display_order = 0
  AND r.name = 'Main Room';

-- ---------------------------------------------------------------------------
-- 6. Verification. Step 3 created exactly one Main Room per workspace and
--    step 5 joined every board to it, so every board should now have a
--    non-null room_id and every workspace should have exactly one Main Room.
--    Fail loud (rolls back the txn) if any invariant is violated so we don't
--    silently ship an inconsistent dataset.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_null_room_boards         INTEGER;
  v_workspaces_without_room  INTEGER;
  v_workspaces_multi_room    INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_null_room_boards
  FROM boards
  WHERE room_id IS NULL;
  IF v_null_room_boards > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % board(s) still have NULL room_id after step 5', v_null_room_boards;
  END IF;

  SELECT COUNT(*) INTO v_workspaces_without_room
  FROM workspaces w
  WHERE NOT EXISTS (
    SELECT 1 FROM rooms r
    WHERE r.workspace_id = w.id AND r.name = 'Main Room'
  );
  IF v_workspaces_without_room > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % workspace(s) missing a Main Room', v_workspaces_without_room;
  END IF;

  SELECT COUNT(*) INTO v_workspaces_multi_room
  FROM (
    SELECT workspace_id
    FROM rooms
    WHERE name = 'Main Room'
    GROUP BY workspace_id
    HAVING COUNT(*) > 1
  ) s;
  IF v_workspaces_multi_room > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % workspace(s) have more than one Main Room', v_workspaces_multi_room;
  END IF;
END;
$$;

COMMIT;
