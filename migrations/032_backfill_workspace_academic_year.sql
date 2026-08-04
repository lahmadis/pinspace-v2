-- 032: Backfill workspaces.academic_year for rows created before the write path
-- stamped it.
--
-- WHY: academic_year was only ever written by the publish/network-metadata
-- flow, never at creation, so any workspace whose owner had not opened the
-- publish modal kept a NULL year. Explore filters on the year with a strict
-- match, so those rows were silently dropped from the network view. As of this
-- migration, POST /api/workspaces stamps the year at creation, so this is a
-- one-time repair of the existing rows rather than an ongoing need.
--
-- ROLLOVER RULE: July (month >= 7), mirroring ACADEMIC_YEAR_ROLLOVER_MONTH in
-- lib/academicYear.ts. A workspace created in late July is being set up for the
-- Fall term and belongs to the coming year; one created in May belongs to the
-- year that is ending. This SQL duplicates the TS rule because a migration
-- cannot import it -- if you change the cutoff in lib/academicYear.ts, this
-- file is now historical and must NOT be edited to match; write a new migration.
--
-- UTC: created_at is timestamptz, and EXTRACT on a timestamptz uses the session
-- timezone. Pinning to UTC makes the result independent of whoever runs this,
-- and matches the write path (Vercel runs UTC), so a row created just after the
-- July boundary gets the same answer from both.
--
-- Each row derives from its OWN created_at -- no single value is assumed for
-- the whole set.
--
-- EXPECTED: 31 rows updated (all NULL rows, created 2026-05-09 .. 2026-07-29).
-- Under the July cutoff, May/June creations become '2025-2026' and July
-- creations become '2026-2027'.
--
-- Blank is treated as unset alongside NULL: '' (and '   ') fails the explore
-- year match exactly as NULL does, so checking only IS NULL would report
-- success while those rows stayed invisible. Hence btrim.
--
-- NOTE: the Supabase SQL Editor shows only the LAST statement's result set. To
-- see the before-query and the zero-remaining check, paste and run them
-- separately rather than expecting all four outputs from one run.

BEGIN;

-- Before: how many rows this will touch, and how they will split.
SELECT
  CASE
    WHEN EXTRACT(MONTH FROM (created_at AT TIME ZONE 'UTC')) >= 7
      THEN EXTRACT(YEAR FROM (created_at AT TIME ZONE 'UTC'))::int
    ELSE EXTRACT(YEAR FROM (created_at AT TIME ZONE 'UTC'))::int - 1
  END AS start_year,
  COUNT(*) AS rows_to_update
FROM workspaces
WHERE (academic_year IS NULL OR btrim(academic_year) = '')
GROUP BY 1
ORDER BY 1;

UPDATE workspaces
SET academic_year =
  CASE
    WHEN EXTRACT(MONTH FROM (created_at AT TIME ZONE 'UTC')) >= 7
      THEN EXTRACT(YEAR FROM (created_at AT TIME ZONE 'UTC'))::int::text
           || '-' ||
           (EXTRACT(YEAR FROM (created_at AT TIME ZONE 'UTC'))::int + 1)::text
    ELSE (EXTRACT(YEAR FROM (created_at AT TIME ZONE 'UTC'))::int - 1)::text
           || '-' ||
           EXTRACT(YEAR FROM (created_at AT TIME ZONE 'UTC'))::int::text
  END
WHERE (academic_year IS NULL OR btrim(academic_year) = '')
  -- Defensive: a NULL created_at would produce a NULL academic_year and leave
  -- the row exactly as broken as before, so skip it and let the check below
  -- report it rather than silently "succeeding".
  AND created_at IS NOT NULL;

COMMIT;

-- VERIFY: must return 0. Anything else means rows were missed (most likely a
-- NULL created_at) and the explore year filter will still drop them.
SELECT COUNT(*) AS remaining_unset_academic_year
FROM workspaces
WHERE academic_year IS NULL OR btrim(academic_year) = '';

-- VERIFY: the resulting distribution, for eyeballing against the expectation
-- above. Should show 2025-2026 (14 pre-existing + May/June backfilled) and
-- 2026-2027 (July backfilled).
SELECT academic_year, COUNT(*) AS workspaces
FROM workspaces
GROUP BY academic_year
ORDER BY academic_year;
