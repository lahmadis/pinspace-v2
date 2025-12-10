# Migration to Supabase - Complete Backend Integration

This guide will help you migrate all frontend data to Supabase so your app is fully production-ready.

## ✅ What's Already Done

- ✅ Authentication (Supabase Auth)
- ✅ Workspaces/Classes (Supabase database)
- ✅ Personal Rooms (Supabase database)
- ✅ RLS Policies (Row-Level Security)

## 📋 What Needs to Be Done

### Step 1: Create Database Tables

Run these SQL files in your Supabase Dashboard → SQL Editor:

1. **`create_boards_table.sql`** - Creates the boards table
2. **`create_comments_table.sql`** - Creates the comments table
3. **`add_type_column.sql`** - Adds type column to workspaces (if not done already)

### Step 2: Update Frontend to Use Workspace IDs

The frontend currently uses `studioId` in some places. Update these:

- **`app/studio/[id]/page.tsx`** - Change `studioId` to `workspaceId` when fetching boards
- **`app/upload/page.tsx`** - Update to use `workspaceId` instead of `studioId`
- Any other components that reference `studioId`

### Step 3: Test the Flow

1. **Create a workspace/room** → Should save to Supabase
2. **Upload a board** → Should save to Supabase
3. **View boards in 3D room** → Should load from Supabase
4. **Update board position** → Should save to Supabase
5. **Delete board** → Should delete from Supabase

### Step 4: Migrate Existing Data (Optional)

If you have existing boards in `lib/data/boards.json`, you can migrate them:

```sql
-- Example migration script (adjust as needed)
INSERT INTO boards (id, workspace_id, owner_id, student_name, title, ...)
SELECT ... FROM your_json_data;
```

## 🎯 Current Status

- ✅ Boards API updated to use Supabase
- ✅ Upload API updated to use Supabase
- ✅ Comments API needs update (if you have one)
- ⚠️ Frontend still uses `studioId` in some places (needs update)

## 🚀 Next Steps

1. Run the SQL files to create tables
2. Test creating a board
3. Update frontend to use `workspaceId` consistently
4. Test the full flow end-to-end

