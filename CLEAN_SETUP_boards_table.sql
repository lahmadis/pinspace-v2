-- Clean setup script for boards table
-- This will drop and recreate everything cleanly

-- Drop table if exists (WARNING: This will delete all board data!)
-- Uncomment the next line only if you want to start fresh
-- DROP TABLE IF EXISTS boards CASCADE;

-- Create boards table
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, -- Supabase user ID (text to match auth.uid()::text)
  owner_name TEXT,
  owner_color TEXT,
  student_name TEXT NOT NULL,
  student_email TEXT,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT NOT NULL,
  full_image_url TEXT NOT NULL,
  tags TEXT[], -- Array of tags
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Position data for 3D room
  position_wall_index INTEGER,
  position_x NUMERIC,
  position_y NUMERIC,
  position_width NUMERIC,
  position_height NUMERIC,
  -- Original dimensions for aspect ratio
  original_width INTEGER,
  original_height INTEGER,
  aspect_ratio NUMERIC
);

-- Drop existing indexes if they exist
DROP INDEX IF EXISTS idx_boards_workspace_id;
DROP INDEX IF EXISTS idx_boards_owner_id;
DROP INDEX IF EXISTS idx_boards_uploaded_at;

-- Create indexes for faster queries
CREATE INDEX idx_boards_workspace_id ON boards(workspace_id);
CREATE INDEX idx_boards_owner_id ON boards(owner_id);
CREATE INDEX idx_boards_uploaded_at ON boards(uploaded_at DESC);

-- Enable Row-Level Security
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view boards in their workspaces" ON boards;
DROP POLICY IF EXISTS "Users can create boards in their workspaces" ON boards;
DROP POLICY IF EXISTS "Users can update their own boards" ON boards;
DROP POLICY IF EXISTS "Users can delete their own boards" ON boards;

-- Policy: Users can view boards in workspaces they own or are members of
CREATE POLICY "Users can view boards in their workspaces"
ON boards FOR SELECT
USING (
  workspace_id IN (
    SELECT id FROM workspaces 
    WHERE owner_id = auth.uid()::text
    OR id IN (
      SELECT workspace_id FROM workspace_members 
      WHERE user_id = auth.uid()::text
    )
  )
);

-- Policy: Users can create boards in workspaces they own or are members of
CREATE POLICY "Users can create boards in their workspaces"
ON boards FOR INSERT
WITH CHECK (
  owner_id = auth.uid()::text
  AND workspace_id IN (
    SELECT id FROM workspaces 
    WHERE owner_id = auth.uid()::text
    OR id IN (
      SELECT workspace_id FROM workspace_members 
      WHERE user_id = auth.uid()::text
    )
  )
);

-- Policy: Users can update their own boards
CREATE POLICY "Users can update their own boards"
ON boards FOR UPDATE
USING (owner_id = auth.uid()::text)
WITH CHECK (owner_id = auth.uid()::text);

-- Policy: Users can delete their own boards
CREATE POLICY "Users can delete their own boards"
ON boards FOR DELETE
USING (owner_id = auth.uid()::text);

-- Add updated_at trigger function (create if doesn't exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS update_boards_updated_at ON boards;
CREATE TRIGGER update_boards_updated_at BEFORE UPDATE ON boards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

