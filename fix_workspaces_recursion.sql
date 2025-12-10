-- Drop the problematic workspaces policy
DROP POLICY IF EXISTS "Users can view their own workspaces" ON workspaces;

-- Create a simpler policy that avoids recursion
-- The key is to NOT query workspace_members in the workspaces policy
-- Instead, we'll allow users to see workspaces they own
-- For member workspaces, we'll handle that in the API code or use a different approach

-- Option 1: Simple policy - only show owned workspaces via RLS
-- Member workspaces will be fetched separately in the API
CREATE POLICY "Users can view their own workspaces"
ON workspaces FOR SELECT
USING (owner_id = auth.uid()::text);

-- OR Option 2: Use a security definer function (more complex but allows member check)
-- This requires creating a function first, which we can do if needed

