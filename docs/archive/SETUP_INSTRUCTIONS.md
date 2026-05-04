# Setup Instructions - Complete Backend Migration

## ⚠️ Important: Run SQL Files in This Order

The tables have dependencies, so you must run them in this specific order:

### Step 1: Create Boards Table
1. Go to Supabase Dashboard → SQL Editor
2. Open `FIXED_create_boards_table.sql` (or use the updated `create_boards_table.sql`)
3. **Run it** - This creates the boards table with UUID foreign key to workspaces

### Step 2: Create Comments Table  
1. Still in SQL Editor
2. Open `create_comments_table.sql`
3. **Run it** - This creates the comments table (depends on boards table existing)

### Step 3: Add Type Column (if not done)
1. Open `add_type_column.sql`
2. **Run it** - Adds type column to workspaces table

## ✅ What's Fixed

- **Type Mismatch Fixed**: `workspace_id` in boards table is now `UUID` to match `workspaces.id`
- **Foreign Key**: Now properly references workspaces table
- **RLS Policies**: All security policies are set up

## 🧪 After Running SQL

1. **Test creating a workspace/room** → Should work
2. **Test uploading a board** → Should save to Supabase
3. **Test viewing boards** → Should load from Supabase
4. **Test updating board position** → Should save to Supabase

## 📝 Notes

- The `workspace_id` in the API code will automatically convert to UUID when inserting
- All board data is now stored in Supabase, not JSON files
- Multiple users can now use the app simultaneously!

