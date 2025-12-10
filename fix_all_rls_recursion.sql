-- Fix infinite recursion in RLS policies
-- The issue: workspaces policy queries workspace_members, which queries workspaces again

-- Step 1: Drop the recursive workspaces policy
DROP POLICY IF EXISTS "Users can view their own workspaces" ON workspaces;

-- Step 2: Create a simple policy that only checks ownership
-- Member workspaces will be fetched separately in the API code (which already does this)
CREATE POLICY "Users can view their own workspaces"
ON workspaces FOR SELECT
USING (owner_id = auth.uid()::text);

-- The API code already handles fetching member workspaces separately:
-- 1. Fetches owned workspaces (now handled by RLS)
-- 2. Fetches workspace_members for user
-- 3. Fetches workspaces where user is a member
-- So we don't need RLS to handle member workspaces - the API does it

-- Note: The workspace_members policy is fine as-is because:
-- - It checks workspaces table (which only checks ownership, no recursion)
-- - It checks user_id directly (no recursion)

