-- Allow workspace members to delete boards (not just board owner).
-- Run in Supabase SQL editor if you prefer RLS to allow member deletes.
-- The API already uses service role for delete after checking membership, so this is optional.

DROP POLICY IF EXISTS "Users can delete their own boards" ON boards;

CREATE POLICY "Users can delete their own boards"
ON boards FOR DELETE
USING (
  owner_id = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.workspace_id = boards.workspace_id AND wm.user_id = auth.uid()::text
  )
  OR EXISTS (
    SELECT 1 FROM workspaces w
    WHERE w.id = boards.workspace_id AND w.owner_id = auth.uid()::text
  )
);
