-- Phase 1, Migration 3: Create org_requests table
-- Run AFTER 002_create_org_domains.sql has succeeded.
--
-- What this does:
--   Creates org_requests for "Request your organization" lead capture.
--   Intentionally has no FK to organizations — these are prospective orgs we don't have yet.
--   Anyone (including unauthenticated visitors) can INSERT.
--   Only service role can SELECT (you'll review these manually or via an admin query).

-- Step 1: Create the table
CREATE TABLE IF NOT EXISTS org_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL,
  domain       TEXT        NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT        NOT NULL DEFAULT 'pending',
  CONSTRAINT org_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- Step 2: Index on domain so you can group requests by domain
CREATE INDEX IF NOT EXISTS org_requests_domain_idx ON org_requests (domain);

-- Step 3: Index on status for filtering pending requests
CREATE INDEX IF NOT EXISTS org_requests_status_idx ON org_requests (status);

-- Step 4: Enable RLS
ALTER TABLE org_requests ENABLE ROW LEVEL SECURITY;

-- Step 5: Anyone can insert (lead capture — works before auth)
CREATE POLICY "Anyone can submit org requests"
  ON org_requests FOR INSERT
  WITH CHECK (true);

-- No SELECT policy for anon or authenticated roles.
-- Service role (used in API routes) bypasses RLS and can read all rows.
-- To review leads manually in the Supabase dashboard, use the Table Editor (runs as service role).
