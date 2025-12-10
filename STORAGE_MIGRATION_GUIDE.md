# 📦 Supabase Storage Migration Guide

## What Changed

The image upload system has been migrated from local filesystem (`public/uploads/`) to **Supabase Storage**. This makes the app production-ready!

## Setup Steps

### 1. Create Storage Bucket in Supabase

**Option A: Using SQL (Recommended)**
1. Go to Supabase Dashboard → SQL Editor
2. Run the `setup_supabase_storage.sql` file
3. This creates the bucket and sets up RLS policies

**Option B: Using Dashboard**
1. Go to Supabase Dashboard → Storage
2. Click "New bucket"
3. Name: `board-images`
4. **Make it public** (toggle "Public bucket" ON)
5. Click "Create bucket"

### 2. Set Up Storage Policies (if using Dashboard method)

If you created the bucket via dashboard, you still need to run the RLS policies from `setup_supabase_storage.sql` (just the policy parts, skip the bucket creation).

Or manually create these policies in **Storage → Policies**:

**Policy 1: Public Access (SELECT)**
- Policy name: "Anyone can view board images"
- Allowed operation: SELECT
- Policy definition:
```sql
bucket_id = 'board-images'
```

**Policy 2: Authenticated Upload (INSERT)**
- Policy name: "Authenticated users can upload board images"
- Allowed operation: INSERT
- Policy definition:
```sql
bucket_id = 'board-images' AND auth.role() = 'authenticated'
```

**Policy 3: Update Own Images (UPDATE)**
- Policy name: "Users can update own images"
- Allowed operation: UPDATE
- Policy definition:
```sql
bucket_id = 'board-images' AND (storage.foldername(name))[1] = auth.uid()::text
```

**Policy 4: Delete Own Images (DELETE)**
- Policy name: "Users can delete own images"
- Allowed operation: DELETE
- Policy definition:
```sql
bucket_id = 'board-images' AND (storage.foldername(name))[1] = auth.uid()::text
```

### 3. Test the Upload

1. Start your dev server: `npm run dev`
2. Go to `/upload` page
3. Upload a test image
4. Check Supabase Dashboard → Storage → `board-images` bucket
5. You should see your image in a folder named with your user ID

## How It Works Now

### File Structure in Storage
```
board-images/
  └── {user-id}/
      ├── {timestamp}-{random}.jpg
      ├── {timestamp}-{random}.png
      └── ...
```

### Image URLs
- **Before:** `/uploads/board-123.jpg` (local file)
- **After:** `https://{project}.supabase.co/storage/v1/object/public/board-images/{user-id}/{timestamp}-{random}.jpg` (Supabase CDN URL)

### Benefits
✅ **Production-ready** - Works on Vercel, Netlify, etc.
✅ **CDN** - Fast image loading worldwide
✅ **Scalable** - No filesystem limits
✅ **Secure** - RLS policies control access
✅ **Free tier** - 1GB storage included

## Migration of Existing Images

If you have existing images in `public/uploads/`, you can:

1. **Option 1: Keep them** (they'll still work, but new uploads go to Supabase)
2. **Option 2: Migrate them** (upload to Supabase Storage manually or via script)

For now, the app will work with both:
- Old images: `/uploads/...` (local)
- New images: Supabase Storage URLs

## File Size & Type Limits

The upload API now enforces:
- **Max file size:** 10MB
- **Allowed types:** JPEG, PNG, WebP, PDF

You can adjust these in `app/api/upload/route.ts` if needed.

## Troubleshooting

### Error: "Bucket not found"
- Make sure you created the `board-images` bucket
- Check the bucket name matches exactly

### Error: "new row violates row-level security policy"
- Make sure you ran the RLS policies from `setup_supabase_storage.sql`
- Check that the bucket is set to **public**

### Images not loading
- Check the image URL in the database (should be a Supabase Storage URL)
- Verify the bucket is public
- Check browser console for CORS errors

### Upload fails with 401
- Make sure user is authenticated
- Check that the INSERT policy allows authenticated users

## Next Steps

Once storage is set up:
1. ✅ Test upload functionality
2. ✅ Verify images appear in 3D studio
3. ✅ Deploy to production!

The app is now **fully production-ready**! 🚀

