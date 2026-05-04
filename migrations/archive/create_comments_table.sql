-- Create comments table in Supabase
-- This will store comments on boards
-- NOTE: Run this AFTER creating the boards table

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL, -- Supabase user ID
  author_name TEXT NOT NULL,
  author_email TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Drop existing indexes if they exist
DROP INDEX IF EXISTS idx_comments_board_id;
DROP INDEX IF EXISTS idx_comments_author_id;
DROP INDEX IF EXISTS idx_comments_created_at;

-- Create index for faster queries
CREATE INDEX idx_comments_board_id ON comments(board_id);
CREATE INDEX idx_comments_author_id ON comments(author_id);
CREATE INDEX idx_comments_created_at ON comments(created_at DESC);

-- Enable Row-Level Security
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view comments on accessible boards" ON comments;
DROP POLICY IF EXISTS "Users can create comments on accessible boards" ON comments;
DROP POLICY IF EXISTS "Users can update their own comments" ON comments;
DROP POLICY IF EXISTS "Users can delete their own comments" ON comments;

-- Policy: Users can view comments on boards they can see
CREATE POLICY "Users can view comments on accessible boards"
ON comments FOR SELECT
USING (
  board_id IN (
    SELECT id FROM boards
    WHERE workspace_id IN (
      SELECT id FROM workspaces 
      WHERE owner_id = auth.uid()::text
      OR id IN (
        SELECT workspace_id FROM workspace_members 
        WHERE user_id = auth.uid()::text
      )
    )
  )
);

-- Policy: Users can create comments on boards they can see
CREATE POLICY "Users can create comments on accessible boards"
ON comments FOR INSERT
WITH CHECK (
  author_id = auth.uid()::text
  AND board_id IN (
    SELECT id FROM boards
    WHERE workspace_id IN (
      SELECT id FROM workspaces 
      WHERE owner_id = auth.uid()::text
      OR id IN (
        SELECT workspace_id FROM workspace_members 
        WHERE user_id = auth.uid()::text
      )
    )
  )
);

-- Policy: Users can update their own comments
CREATE POLICY "Users can update their own comments"
ON comments FOR UPDATE
USING (author_id = auth.uid()::text)
WITH CHECK (author_id = auth.uid()::text);

-- Policy: Users can delete their own comments
CREATE POLICY "Users can delete their own comments"
ON comments FOR DELETE
USING (author_id = auth.uid()::text);

-- Add updated_at trigger (function should already exist from boards table)
DROP TRIGGER IF EXISTS update_comments_updated_at ON comments;
CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
