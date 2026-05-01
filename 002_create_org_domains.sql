-- Phase 1, Migration 2: Create org_domains table
-- Run AFTER 001_rename_institutions_to_organizations.sql has succeeded.
--
-- What this does:
--   1. Creates org_domains: normalized one-to-many mapping of domains → organizations
--      (replaces the comma-separated allowed_email_domains column as the source of truth)
--   2. Seeds from existing organizations.allowed_email_domains
--      (WIT → wit.edu, and any other orgs that have domains set)
--   3. Enables RLS with public SELECT so the domain-lookup API can query it safely
--      (the API also uses service role, so this is belt-and-suspenders)
--
-- The allowed_email_domains column on organizations is kept as legacy for now and removed in Phase 4.

-- Step 1: Create the table
CREATE TABLE IF NOT EXISTS org_domains (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT org_domains_domain_unique UNIQUE (domain)
);

-- Step 2: Index on org_id for reverse lookups (e.g. "give me all domains for org X")
CREATE INDEX IF NOT EXISTS org_domains_org_id_idx ON org_domains (org_id);

-- Step 3: Enable RLS
ALTER TABLE org_domains ENABLE ROW LEVEL SECURITY;

-- Step 4: Public read — domain lookup happens before a user is authenticated
CREATE POLICY "Public can read org_domains"
  ON org_domains FOR SELECT
  USING (true);

-- Step 5: Seed from existing allowed_email_domains column
-- Splits comma-separated strings, trims whitespace, skips empty values
INSERT INTO org_domains (org_id, domain)
SELECT
  o.id,
  trim(d.domain)
FROM organizations o
CROSS JOIN LATERAL unnest(string_to_array(o.allowed_email_domains, ',')) AS d(domain)
WHERE
  o.allowed_email_domains IS NOT NULL
  AND trim(o.allowed_email_domains) <> ''
  AND trim(d.domain) <> ''
ON CONFLICT (domain) DO NOTHING;
