-- Multi-tenant institutions (Option A): institutions table + workspaces.institution_id
-- Run once. Safe to re-run: uses IF NOT EXISTS and existence checks.

-- 1. Create institutions table
CREATE TABLE IF NOT EXISTS institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  network_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add institution_id to workspaces (nullable FK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'institution_id'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN institution_id UUID REFERENCES institutions(id);
  END IF;
END $$;

-- 3. Seed Wentworth and Northeastern if not present
INSERT INTO institutions (name, slug, network_label)
VALUES
  ('Wentworth Institute of Technology', 'wit', 'WIT Design Network'),
  ('Northeastern University', 'northeastern', 'Northeastern')
ON CONFLICT (slug) DO NOTHING;

-- 4. Backfill existing workspaces to Wentworth (so e.g. "test studio" shows under WIT)
UPDATE workspaces
SET institution_id = (SELECT id FROM institutions WHERE slug = 'wit' LIMIT 1)
WHERE institution_id IS NULL;
