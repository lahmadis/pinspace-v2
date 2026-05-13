-- Seed org_domains for known institutions.
-- Migration 002 attempted to populate this table from the legacy
-- allowed_email_domains column, but that column was never populated in the
-- seed script, so org_domains remained empty. This migration fills the gap
-- for fresh DB setup; prod was fixed manually via Supabase SQL Editor.

INSERT INTO org_domains (org_id, domain)
SELECT id, 'wit.edu' FROM organizations WHERE slug = 'wit'
ON CONFLICT (domain) DO NOTHING;

INSERT INTO org_domains (org_id, domain)
SELECT id, 'northeastern.edu' FROM organizations WHERE slug = 'northeastern'
ON CONFLICT (domain) DO NOTHING;
