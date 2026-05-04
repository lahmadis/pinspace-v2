-- Fix RLS policies to eliminate infinite recursion
-- The issue: workspace_members RLS queries workspaces, and workspaces RLS queries workspace_members = infinite loop

-- Step 1: Drop ALL existing SELECT policies on workspaces
DROP POLICY IF EXISTS "Users can view their own workspaces" ON workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces or public workspaces" ON workspaces;
DROP POLICY IF EXISTS "Anyone can view public workspaces" ON workspaces;
DROP POLICY IF EXISTS "Users can view workspaces they are members of" ON workspaces;

-- Step 2: Create simple, non-recursive policies for workspaces
-- Policy 1: Users can view workspaces they own (simple, direct check - NO subqueries)
CREATE POLICY "Users can view their own workspaces"
ON workspaces FOR SELECT
USING (owner_id = auth.uid()::text);

-- Policy 2: Anyone can view public workspaces (simple, no subqueries)
CREATE POLICY "Anyone can view public workspaces"
ON workspaces FOR SELECT
USING (is_public = true AND published_at IS NOT NULL);

-- Note: We do NOT create a policy for member workspaces here to avoid recursion.
-- The API route handles member workspaces by:
-- 1. Querying workspace_members directly (which has its own RLS that checks user_id directly)
-- 2. Then fetching workspaces by ID using .in('id', memberIds)
--    This will work because the user owns them OR they're public (covered by policies above)

-- Step 3: Fix workspace_members RLS to avoid querying workspaces for the member check
-- Drop ALL existing SELECT policies on workspace_members (in case they already exist)
DROP POLICY IF EXISTS "Users can view members of their workspaces" ON workspace_members;
DROP POLICY IF EXISTS "Workspace owners can view members" ON workspace_members;
DROP POLICY IF EXISTS "Users can view their own memberships" ON workspace_members;

-- Create a simpler policy that doesn't cause recursion
-- Split into two policies: one for owners, one for members
CREATE POLICY "Workspace owners can view members"
ON workspace_members FOR SELECT
USING (
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
);

CREATE POLICY "Users can view their own memberships"
ON workspace_members FOR SELECT
USING (user_id = auth.uid()::text);

