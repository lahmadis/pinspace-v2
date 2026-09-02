-- 046: workspaces.academic_year stops holding an academic year and starts
-- holding a SEMESTER — '2025-2026' becomes 'Fall 2025' / 'Spring 2026' /
-- 'Summer 2026'.
--
-- WHY: an academic year is three semesters wide, so one explore bubble held
-- Fall's reviews and the following Summer's together — fourteen months of
-- unrelated work behind one label, and no way to ask for "this semester" at
-- all. The network drills by semester now, and every form that writes this
-- column writes a term.
--
-- THE COLUMN KEEPS ITS NAME. Renaming it is a schema change plus a sweep of
-- every payload field and prop called academicYear, none of which carries
-- information the value doesn't. Read `academic_year` as "the term this ran
-- in"; lib/term.ts is the whole definition and says the same thing.
--
-- TERM RULE (mirrors termFor in lib/term.ts, which a migration cannot import):
--   Jan-Apr -> Spring Y   May-Jun -> Summer Y   Jul-Dec -> Fall Y
-- July is FALL, inherited from the July academic-year rollover this replaces:
-- a class created in late July is being set up for the coming Fall. That
-- boundary is what makes Fall Y, Spring Y+1 and Summer Y+1 exactly the three
-- terms of academic year 'Y-(Y+1)' -- so NO ROW MOVES INTO A DIFFERENT
-- ACADEMIC YEAR here. If you change the cutoff in lib/term.ts, this file is
-- historical and must NOT be edited to match; write a new migration.
--
-- UTC: created_at is timestamptz and EXTRACT on one uses the session timezone,
-- so it is pinned. Same reason migration 032 pinned it, and it matches the
-- write path (Vercel runs UTC).
--
-- TWO POPULATIONS, deliberately handled differently:
--
--   1. NULL/blank academic_year (30 rows as of writing, created 2026-05-09 ..
--      2026-08-30). Migration 032 was written to repair exactly this and was
--      never applied, so these are still unset -- and an unset value is
--      dropped by the explore term filter, which is how 31 workspaces went
--      missing unnoticed once already. Derived purely from created_at.
--
--   2. 'YYYY-YYYY' academic_year (28 rows: 11 at '2025-2026', 17 at
--      '2026-2027'). Derived from created_at too, but CLAMPED INTO THE STORED
--      YEAR. An instructor who picked a year by hand may have picked one their
--      created_at does not fall in -- a room made 2026-07-08 and filed as
--      '2025-2026' is a real row here -- and the explicit pick is better
--      evidence than the timestamp. Falling outside the stored year clamps to
--      that year's nearest term: Fall Y1 if created before it, Summer Y2 if
--      after. So 2026-07-08 + '2025-2026' lands on 'Summer 2026', not on the
--      'Fall 2026' its date alone would give, which would have silently moved
--      the row into the next academic year.
--
-- IDEMPOTENT: rows already holding a term match neither WHERE clause, so
-- re-running is a no-op rather than a second rewrite.
--
-- EXPECTED (dry-run against the live table, 58 workspaces, 2026-09-01):
--   (null)     -> Summer 2026   27 rows   created 2026-05-09 .. 2026-06-25
--   (null)     -> Fall   2026    3 rows   created 2026-07-18 .. 2026-08-30
--   2025-2026  -> Fall   2025    3 rows   created 2025-12-10 .. 2025-12-14
--   2025-2026  -> Spring 2026    6 rows   created 2026-02-10 .. 2026-04-10
--   2025-2026  -> Summer 2026    2 rows   created 2026-06-01 .. 2026-07-08
--   2026-2027  -> Fall   2026   17 rows   created 2026-07-23 .. 2026-08-31
-- The last row of the '2025-2026' group is the clamp doing its job: created
-- 2026-07-08, which on date alone would be Fall 2026 and in the NEXT academic
-- year, held inside the year the instructor picked as Summer 2026.
--
-- Those counts are a SNAPSHOT, not a checksum. Any workspace created after the
-- dry-run was stamped by the new write path and already holds a term, so it
-- matches neither UPDATE and lands in the before-query's 'already a term
-- (skipped)' bucket. Expect the totals to have grown; what must hold is the
-- VERIFY below returning 0.
--
-- NOTE: the Supabase SQL Editor shows only the LAST statement's result set.
-- Paste and run the before-query and the two VERIFY queries separately.

BEGIN;

-- Before: what is about to be rewritten, and from which shape.
SELECT
  CASE
    WHEN academic_year IS NULL OR btrim(academic_year) = '' THEN 'unset'
    WHEN academic_year ~ '^\d{4}-\d{4}$' THEN 'academic year'
    ELSE 'already a term (skipped)'
  END AS current_shape,
  COUNT(*) AS rows
FROM workspaces
GROUP BY 1
ORDER BY 1;

-- 1. Unset: derive straight from created_at.
UPDATE workspaces
SET academic_year =
  CASE
    WHEN EXTRACT(MONTH FROM (created_at AT TIME ZONE 'UTC')) <= 4 THEN 'Spring '
    WHEN EXTRACT(MONTH FROM (created_at AT TIME ZONE 'UTC')) <= 6 THEN 'Summer '
    ELSE 'Fall '
  END
  || EXTRACT(YEAR FROM (created_at AT TIME ZONE 'UTC'))::int::text
WHERE (academic_year IS NULL OR btrim(academic_year) = '')
  -- Defensive: a NULL created_at would produce a NULL term and leave the row
  -- exactly as broken as before, so skip it and let the VERIFY below report it
  -- rather than silently "succeeding".
  AND created_at IS NOT NULL;

-- 2. 'YYYY-YYYY': derive from created_at, then clamp into the stored year.
UPDATE workspaces w
SET academic_year = d.term
FROM (
  SELECT
    id,
    CASE
      -- Before the stored year's Fall -> its first term. The pair is
      -- (year, month) in that order: row comparison goes left to right, and
      -- (m, y) would sort every August ahead of every July regardless of year.
      WHEN (y, m) < (y1, 7) THEN 'Fall ' || y1::text
      -- After the stored year's Summer -> its last term.
      WHEN (y, m) > (y2, 6) THEN 'Summer ' || y2::text
      WHEN m <= 4 THEN 'Spring ' || y::text
      WHEN m <= 6 THEN 'Summer ' || y::text
      ELSE 'Fall ' || y::text
    END AS term
  FROM (
    SELECT
      id,
      EXTRACT(MONTH FROM (created_at AT TIME ZONE 'UTC'))::int AS m,
      EXTRACT(YEAR  FROM (created_at AT TIME ZONE 'UTC'))::int AS y,
      split_part(academic_year, '-', 1)::int AS y1,
      split_part(academic_year, '-', 2)::int AS y2
    FROM workspaces
    WHERE academic_year ~ '^\d{4}-\d{4}$'
      AND created_at IS NOT NULL
  ) parsed
) d
WHERE w.id = d.id;

COMMIT;

-- VERIFY: must return 0. Anything else is a row the explore term filter will
-- keep dropping -- most likely a NULL created_at, which neither UPDATE touches.
SELECT COUNT(*) AS rows_not_a_term
FROM workspaces
WHERE academic_year IS NULL
   OR btrim(academic_year) = ''
   OR academic_year !~ '^(Spring|Summer|Fall) \d{4}$';

-- VERIFY: the resulting distribution. Expect Fall 2025 / Spring 2026 /
-- Summer 2026 (the old '2025-2026' plus the May-Jun unset rows) and Fall 2026
-- (the old '2026-2027' plus the Jul-Aug unset rows), and nothing else.
SELECT academic_year AS term, COUNT(*) AS workspaces
FROM workspaces
GROUP BY 1
ORDER BY 1;
