# Alternative Storage Setup (If SQL Editor Fails)

If you're getting "Failed to fetch" errors in the SQL Editor, you can set up the storage bucket using the Supabase Dashboard UI instead.

## Option 1: Create Bucket via Dashboard

1. **Go to Storage in Supabase Dashboard:**
   - Click "Storage" in the left sidebar
   - Click "New bucket"

2. **Create the bucket:**
   - **Name:** `board-images`
   - **Public bucket:** ✅ **Toggle ON** (this is important!)
   - Click "Create bucket"

3. **Set up Policies via Dashboard:**
   - Go to Storage → `board-images` bucket
   - Click "Policies" tab
   - Click "New Policy"

   **Policy 1: Public View (SELECT)**
   - Policy name: "Anyone can view board images"
   - Allowed operation: `SELECT`
   - Policy definition:
   ```sql
   bucket_id = 'board-images'
   ```
   - Click "Review" then "Save policy"

   **Policy 2: Authenticated Upload (INSERT)**
   - Policy name: "Authenticated users can upload board images"
   - Allowed operation: `INSERT`
   - Policy definition:
   ```sql
   bucket_id = 'board-images' AND auth.role() = 'authenticated'
   ```
   - Click "Review" then "Save policy"

   **Policy 3: Update Own Images (UPDATE)**
   - Policy name: "Users can update own images"
   - Allowed operation: `UPDATE`
   - Policy definition:
   ```sql
   bucket_id = 'board-images' AND (storage.foldername(name))[1] = auth.uid()::text
   ```
   - Click "Review" then "Save policy"

   **Policy 4: Delete Own Images (DELETE)**
   - Policy name: "Users can delete own images"
   - Allowed operation: `DELETE`
   - Policy definition:
   ```sql
   bucket_id = 'board-images' AND (storage.foldername(name))[1] = auth.uid()::text
   ```
   - Click "Review" then "Save policy"

## Option 2: Troubleshoot SQL Editor

If you want to use the SQL Editor instead:

1. **Refresh the page** (Ctrl+R or Cmd+R)
2. **Click "Retry"** button in the error message
3. **Check your internet connection**
4. **Try a different browser** (Chrome, Firefox, Edge)
5. **Clear browser cache** and try again
6. **Wait a few minutes** - might be a temporary Supabase API issue

## Verify Setup

After setting up (either method), verify:

1. Go to Storage → `board-images`
2. Bucket should show as **"Public"**
3. Policies tab should show 4 policies:
   - Anyone can view board images (SELECT)
   - Authenticated users can upload board images (INSERT)
   - Users can update own images (UPDATE)
   - Users can delete own images (DELETE)

## Test Upload

Once set up, test the upload:
1. Go to your app: `http://localhost:3000/upload`
2. Upload a test image
3. Check Storage → `board-images` → you should see a folder with your user ID
4. Your image should be inside that folder

---

**Note:** The Dashboard method is often more reliable if the SQL Editor is having issues!

