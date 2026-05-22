-- Migration 008: Tighten board-images INSERT policy
-- Replace loose "any authenticated user can upload anywhere" with
-- strict "authenticated user can only upload under their own {uid}/ folder".
-- Service-role writes (wall-configs via /api/studios/.../wall-config) bypass RLS, unaffected.
-- Existing /api/upload (user session, paths start with {userId}/) continues to work.

BEGIN;

DROP POLICY IF EXISTS "Authenticated users can upload board images" ON storage.objects;

CREATE POLICY "Users can upload to own folder in board-images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'board-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

COMMIT;

-- Verification queries (run separately after applying):
-- SELECT policyname, cmd, with_check FROM pg_policies
--   WHERE schemaname='storage' AND tablename='objects'
--   AND policyname LIKE '%board-images%';
-- Expect: one INSERT policy with the new WITH CHECK expression.
