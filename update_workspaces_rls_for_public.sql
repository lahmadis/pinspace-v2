-- Update RLS policy to allow viewing public workspaces
-- This allows anyone to see workspaces that are published to the public network
-- We create SEPARATE policies to avoid infinite recursion

-- Drop the existing SELECT policy
DROP POLICY IF EXISTS "Users can view their own workspaces" ON workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces or public workspaces" ON workspaces;
DROP POLICY IF EXISTS "Anyone can view public workspaces" ON workspaces;

-- Policy 1: Public workspaces (simple, no subqueries to avoid recursion)
CREATE POLICY "Anyone can view public workspaces"
ON workspaces FOR SELECT
USING (is_public = true AND published_at IS NOT NULL);

-- Policy 2: Users can view workspaces they own
CREATE POLICY "Users can view their own workspaces"
ON workspaces FOR SELECT
USING (owner_id = auth.uid()::text);

-- Policy 3: Users can view workspaces they are members of
-- Note: This uses a direct check on workspace_members without querying workspaces again
CREATE POLICY "Users can view workspaces they are members of"
ON workspaces FOR SELECT
USING (
  EXISTS (
    SELECT 1 
    FROM workspace_members 
    WHERE workspace_members.workspace_id = workspaces.id 
    AND workspace_members.user_id = auth.uid()::text
  )
);

