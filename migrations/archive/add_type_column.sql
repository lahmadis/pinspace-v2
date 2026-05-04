-- Add type column to workspaces table if it doesn't exist
-- This allows distinguishing between 'class' workspaces and 'personal' rooms

-- Check if column exists, if not add it
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'workspaces' 
        AND column_name = 'type'
    ) THEN
        ALTER TABLE workspaces ADD COLUMN type TEXT DEFAULT 'class';
        -- Update existing rows to be 'class' type
        UPDATE workspaces SET type = 'class' WHERE type IS NULL;
    END IF;
END $$;

-- Optional: Add a check constraint to ensure type is either 'class' or 'personal'
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_type_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_type_check 
    CHECK (type IN ('class', 'personal'));

