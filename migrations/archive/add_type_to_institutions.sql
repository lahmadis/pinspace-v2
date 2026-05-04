-- Add type to institutions: 'institution' (schools) or 'firm' (e.g. architecture firms).
-- Run once. Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'institutions' AND column_name = 'type'
  ) THEN
    ALTER TABLE institutions ADD COLUMN type TEXT NOT NULL DEFAULT 'institution'
      CHECK (type IN ('institution', 'firm'));
  END IF;
END $$;
