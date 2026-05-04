-- Add columns to workspaces table for publishing functionality
-- Run this if you get errors about missing columns

-- Add is_public column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'workspaces' AND column_name = 'is_public'
    ) THEN
        ALTER TABLE workspaces ADD COLUMN is_public BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Add published_at column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'workspaces' AND column_name = 'published_at'
    ) THEN
        ALTER TABLE workspaces ADD COLUMN published_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add network_metadata column (JSONB for flexible structure)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'workspaces' AND column_name = 'network_metadata'
    ) THEN
        ALTER TABLE workspaces ADD COLUMN network_metadata JSONB;
    END IF;
END $$;

-- Add instructor column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'workspaces' AND column_name = 'instructor'
    ) THEN
        ALTER TABLE workspaces ADD COLUMN instructor TEXT;
    END IF;
END $$;

-- Add invite_code column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'workspaces' AND column_name = 'invite_code'
    ) THEN
        ALTER TABLE workspaces ADD COLUMN invite_code TEXT;
    END IF;
END $$;

