-- Phase 4.3: Drop legacy allowed_email_domains column
-- All readers have been migrated to org_domains. Safe to drop.

BEGIN;

-- Drop the view (CREATE OR REPLACE can't remove columns)
DROP VIEW public.institutions;

-- Recreate without allowed_email_domains
CREATE VIEW public.institutions AS
SELECT id, name, slug, network_label, created_at, type, logo_url
FROM organizations;

-- Restore the grants Supabase had on the original view
GRANT ALL PRIVILEGES ON public.institutions TO anon, authenticated, service_role;

-- Drop the legacy column (now unblocked)
ALTER TABLE public.organizations DROP COLUMN allowed_email_domains;

COMMIT;
