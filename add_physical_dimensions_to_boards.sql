-- Add physical dimensions columns to boards table
-- This migration adds support for physical board dimensions in inches
-- Run this in Supabase SQL Editor

-- Add physical_width column (in inches, e.g., 36 for a 3ft wide board)
ALTER TABLE boards 
ADD COLUMN IF NOT EXISTS physical_width NUMERIC;

-- Add physical_height column (in inches, e.g., 72 for a 6ft tall board)
ALTER TABLE boards 
ADD COLUMN IF NOT EXISTS physical_height NUMERIC;

-- Add a comment to document these columns
COMMENT ON COLUMN boards.physical_width IS 'Physical width of the board in inches (e.g., 36 for 3ft)';
COMMENT ON COLUMN boards.physical_height IS 'Physical height of the board in inches (e.g., 72 for 6ft)';

-- Example: If you want to set dimensions for an existing board:
-- UPDATE boards SET physical_width = 36, physical_height = 72 WHERE id = 'board-id-here';




