-- First, drop the problematic policy
DROP POLICY IF EXISTS "Users can view members of their workspaces" ON workspace_members;

-- Create a simpler policy that avoids recursion
-- Users can see members if:
-- 1. They own the workspace (check workspaces table only)
-- 2. They are a member themselves (check their own user_id directly)
CREATE POLICY "Users can view members of their workspaces"
ON workspace_members FOR SELECT
USING (
  -- User owns the workspace (no recursion - only checks workspaces table)
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
  OR
  -- User is a member (direct check, no subquery to workspace_members)
  user_id = auth.uid()::text
);

