-- Fix comments RLS policy to allow viewing and creating comments on public boards
-- This allows anyone to see and create comments on boards in public workspaces

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view comments on accessible boards" ON comments;
DROP POLICY IF EXISTS "Users can create comments on accessible boards" ON comments;

-- SELECT Policies: Allow viewing comments
-- Policy 1: Users can view comments on boards in their own workspaces
CREATE POLICY "Users can view comments on their own workspace boards"
ON comments FOR SELECT
USING (
  board_id IN (
    SELECT id FROM boards
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
    )
  )
);

-- Policy 2: Anyone can view comments on boards in public workspaces
CREATE POLICY "Anyone can view comments on public workspace boards"
ON comments FOR SELECT
USING (
  board_id IN (
    SELECT id FROM boards
    WHERE workspace_id IN (
      SELECT id FROM workspaces 
      WHERE is_public = true AND published_at IS NOT NULL
    )
  )
);

-- INSERT Policies: Allow creating comments
-- Policy 1: Users can create comments on boards in their own workspaces
CREATE POLICY "Users can create comments on their own workspace boards"
ON comments FOR INSERT
WITH CHECK (
  author_id = auth.uid()::text
  AND board_id IN (
    SELECT id FROM boards
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
    )
  )
);

-- Policy 2: Anyone can create comments on boards in public workspaces
CREATE POLICY "Anyone can create comments on public workspace boards"
ON comments FOR INSERT
WITH CHECK (
  author_id = auth.uid()::text
  AND board_id IN (
    SELECT id FROM boards
    WHERE workspace_id IN (
      SELECT id FROM workspaces 
      WHERE is_public = true AND published_at IS NOT NULL
    )
  )
);

-- Note: For member workspaces, the API route handles this by:
-- 1. Querying workspace_members to get workspace IDs where user is a member
-- 2. Then fetching/creating comments for boards in those workspaces
-- Since the user owns those workspaces (or they're public), the policies above will allow access

