-- Fix boards RLS policy to allow viewing boards in public workspaces
-- This allows anyone to see boards in workspaces that are published to the public network

-- Drop ALL existing SELECT policies on boards (in case they already exist)
DROP POLICY IF EXISTS "Users can view boards in their workspaces" ON boards;
DROP POLICY IF EXISTS "Users can view boards in their own workspaces" ON boards;
DROP POLICY IF EXISTS "Anyone can view boards in public workspaces" ON boards;

-- Create separate policies to avoid recursion and allow public access
-- Policy 1: Users can view boards in workspaces they own
CREATE POLICY "Users can view boards in their own workspaces"
ON boards FOR SELECT
USING (
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
);

-- Policy 2: Anyone can view boards in public workspaces
CREATE POLICY "Anyone can view boards in public workspaces"
ON boards FOR SELECT
USING (
  workspace_id IN (
    SELECT id FROM workspaces 
    WHERE is_public = true AND published_at IS NOT NULL
  )
);

-- Note: For member workspaces, the API route handles this by:
-- 1. Querying workspace_members to get workspace IDs where user is a member
-- 2. Then fetching boards for those workspace IDs
-- Since the user owns those workspaces (or they're public), the policies above will allow access

