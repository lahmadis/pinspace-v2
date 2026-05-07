-- Migration 011: track upload lifecycle on the boards table.
--
-- Why: the upload API previously wrote the storage object first, then inserted the
-- DB row. A client disconnect (refresh, network drop, function timeout) between
-- those steps leaked the storage object. With this column, the API can insert a
-- 'pending' row first, upload to storage, then flip the row to 'complete'. If
-- storage fails, the placeholder row is deleted; if the function dies mid-flight,
-- the orphan is just a 'pending' row (cheap, easy to sweep).

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'complete'
  CHECK (upload_status IN ('pending', 'complete'));

-- Optional convenience index for the listing API to filter pending out cheaply.
CREATE INDEX IF NOT EXISTS boards_upload_status_idx ON boards (upload_status)
  WHERE upload_status <> 'complete';
