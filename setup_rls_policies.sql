-- Enable Row-Level Security on workspaces table
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- Enable Row-Level Security on workspace_members table
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view workspaces they own or are members of
CREATE POLICY "Users can view their own workspaces"
ON workspaces FOR SELECT
USING (
  owner_id = auth.uid()::text
  OR id IN (
    SELECT workspace_id 
    FROM workspace_members 
    WHERE user_id = auth.uid()::text
  )
);

-- Policy: Users can create workspaces (they become the owner)
CREATE POLICY "Users can create workspaces"
ON workspaces FOR INSERT
WITH CHECK (owner_id = auth.uid()::text);

-- Policy: Users can update workspaces they own
CREATE POLICY "Users can update their own workspaces"
ON workspaces FOR UPDATE
USING (owner_id = auth.uid()::text)
WITH CHECK (owner_id = auth.uid()::text);

-- Policy: Users can delete workspaces they own
CREATE POLICY "Users can delete their own workspaces"
ON workspaces FOR DELETE
USING (owner_id = auth.uid()::text);

-- Policy: Users can view workspace_members if they own the workspace OR are a member themselves
CREATE POLICY "Users can view members of their workspaces"
ON workspace_members FOR SELECT
USING (
  -- User owns the workspace
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
  OR
  -- User is a member of this workspace
  user_id = auth.uid()::text
);

-- Policy: Workspace owners can add members
CREATE POLICY "Workspace owners can add members"
ON workspace_members FOR INSERT
WITH CHECK (
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
);

-- Policy: Workspace owners can update members
CREATE POLICY "Workspace owners can update members"
ON workspace_members FOR UPDATE
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

-- Policy: Workspace owners can remove members
CREATE POLICY "Workspace owners can remove members"
ON workspace_members FOR DELETE
USING (
  workspace_id IN (
    SELECT id FROM workspaces WHERE owner_id = auth.uid()::text
  )
);

