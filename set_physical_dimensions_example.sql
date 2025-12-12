-- Set physical dimensions for boards in Supabase
-- Replace 'your-board-id' with actual board IDs from your database

-- First, see all your boards and check which ones need physical dimensions
SELECT 
  id, 
  title, 
  student_name,
  physical_width, 
  physical_height,
  position_width,
  position_height
FROM boards 
WHERE workspace_id = 'your-workspace-id-here'
ORDER BY uploaded_at DESC;

-- Example: Set physical dimensions for a specific board
-- If a board is 36 inches wide by 72 inches tall:
UPDATE boards 
SET physical_width = 36, physical_height = 72 
WHERE id = 'board-id-here';

-- Example: Set for multiple boards at once
-- UPDATE boards 
-- SET physical_width = 36, physical_height = 72 
-- WHERE title LIKE '%Tuft Uni%';

-- After setting physical dimensions, refresh your page
-- The boards should now render at their correct physical size!




