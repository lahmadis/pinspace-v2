-- Setup Supabase Storage for board images
-- Run this in Supabase SQL Editor

-- Step 1: Create a storage bucket for board images (public bucket)
INSERT INTO storage.buckets (id, name, public)
VALUES ('board-images', 'board-images', true)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Drop existing policies if they exist (for safe re-running)
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view board images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload board images" ON storage.objects;

-- Step 3: Create RLS policies for storage.objects
-- Policy 1: Anyone can view images (public bucket)
CREATE POLICY "Anyone can view board images"
ON storage.objects FOR SELECT
USING (bucket_id = 'board-images');

-- Policy 2: Authenticated users can upload images
CREATE POLICY "Authenticated users can upload board images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'board-images'
  AND auth.role() = 'authenticated'
);

-- Policy 3: Users can update their own images (files in their user_id folder)
CREATE POLICY "Users can update own images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'board-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'board-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy 4: Users can delete their own images
CREATE POLICY "Users can delete own images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'board-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

