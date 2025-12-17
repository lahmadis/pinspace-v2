-- Add position_side column to boards table
-- This column stores which side of the wall ('front' or 'back') a board is placed on

ALTER TABLE boards 
ADD COLUMN IF NOT EXISTS position_side TEXT DEFAULT 'front';

-- Update existing boards to have 'front' as default (for backwards compatibility)
UPDATE boards 
SET position_side = 'front' 
WHERE position_side IS NULL AND position_wall_index IS NOT NULL;




