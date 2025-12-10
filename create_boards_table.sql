-- Create boards table in Supabase
-- This will store all board data that was previously in JSON files

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, -- Supabase user ID
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

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_boards_workspace_id ON boards(workspace_id);
CREATE INDEX IF NOT EXISTS idx_boards_owner_id ON boards(owner_id);
CREATE INDEX IF NOT EXISTS idx_boards_uploaded_at ON boards(uploaded_at DESC);

-- Enable Row-Level Security
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;

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

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_boards_updated_at BEFORE UPDATE ON boards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

