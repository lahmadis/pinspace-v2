-- Allow restricting workspace joins by email domain (e.g. only @wit.edu can join WIT workspaces).
-- Run once. Safe to re-run.

-- Add column: comma-separated list of allowed domains, e.g. "wit.edu" or "wit.edu,wentworth.edu"
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'institutions' AND column_name = 'allowed_email_domains'
  ) THEN
    ALTER TABLE institutions ADD COLUMN allowed_email_domains TEXT;
  END IF;
END $$;

-- Backfill WIT with allowed domain (optional)
UPDATE institutions
SET allowed_email_domains = 'wit.edu'
WHERE slug = 'wit' AND (allowed_email_domains IS NULL OR allowed_email_domains = '');
