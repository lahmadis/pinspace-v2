-- Check columns in workspaces table
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'workspaces' 
    AND column_name IN ('owner_id', 'owner_clerk_id', 'user_id', 'clerk_id')
ORDER BY column_name;

-- Check columns in workspace_members table
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'workspace_members' 
    AND column_name IN ('owner_id', 'owner_clerk_id', 'user_id', 'clerk_id')
ORDER BY column_name;

-- Show ALL columns in workspaces table (to see full structure)
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'workspaces'
ORDER BY ordinal_position;

-- Show ALL columns in workspace_members table (to see full structure)
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'workspace_members'
ORDER BY ordinal_position;

