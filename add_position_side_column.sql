-- Add position_side column to boards table
-- This column stores which side of the wall a board is placed on ('front' or 'back')

ALTER TABLE boards 
ADD COLUMN IF NOT EXISTS position_side TEXT CHECK (position_side IN ('front', 'back'));
