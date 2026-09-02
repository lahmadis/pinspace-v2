-- 047 — the suggested crit phases go Title Case, and the crits already filed
-- under the old spelling follow them.
--
-- WHY THIS IS A MIGRATION AND NOT A COPY CHANGE: canvases.phase stores the
-- label verbatim (043 chose free text over an enum deliberately), and the card
-- picker decides whether a value is "one of ours" by exact string match
-- against CRIT_PHASES. Six entries were sentence case:
--
--   Site analysis -> Site Analysis            Model making       -> Model Making
--   Massing studies -> Massing Studies        Design development -> Design Development
--   Schematic design -> Schematic Design      Final review       -> Final Review
--
-- Left alone, a crit stored as 'Schematic design' stops matching the renamed
-- list, so the picker renders it as a custom one-off ABOVE the suggestions —
-- two entries a keystroke apart, reading almost identically, and the header's
-- phase filter splits into two buckets for one phase.
--
-- 'Precedent', 'Concept', 'Sketching' and 'Detailing' are single words and were
-- already correct; they are absent here because nothing about them changes.
--
-- FREE TEXT IS NOT TOUCHED. A phase somebody typed themselves — 'Interim
-- pin-up', 'Thesis prep' — is their wording, not ours, and recapitalising it
-- would be this migration overreaching. Only the six exact strings that used to
-- be in CRIT_PHASES are rewritten.
--
-- CASE-INSENSITIVE match on purpose: normaliseCritPhase has always folded a
-- typed 'schematic design' onto the list's spelling, so rows written through
-- the Other box may hold any casing of these six. lower() catches them all and
-- lands them on the one spelling the list now uses.
--
-- EXPECTED: 1 row updated -- the single 'Schematic design' crit. The rest of
-- the table (Concept, Sketching, Precedent, and one NULL) is already Title
-- Case or is not a phase at all, and is left untouched. NULL is not a phase
-- and is not backfilled; 043 says why.
--
-- Only that ONE COUNT is the expectation. Crits created since this was written
-- are stamped from the renamed list and are already correct, so the other
-- buckets will have grown; what must hold is the VERIFY below returning 0.
--
-- IDEMPOTENT: after this runs, no row matches the old spellings in a way that
-- changes anything — re-running rewrites each value to itself.
--
-- NOTE: the Supabase SQL Editor shows only the LAST statement's result set.
-- Paste and run the before-query and the VERIFY separately.

BEGIN;

-- Before: which phases exist, and which of them this touches.
SELECT
  COALESCE(phase, '(null)') AS phase,
  COUNT(*) AS crits,
  lower(btrim(phase)) IN (
    'site analysis', 'massing studies', 'schematic design',
    'model making', 'design development', 'final review'
  ) AS will_be_rewritten
FROM canvases
GROUP BY 1, 3
ORDER BY 3 DESC, 1;

UPDATE canvases
SET phase = CASE lower(btrim(phase))
  WHEN 'site analysis'      THEN 'Site Analysis'
  WHEN 'massing studies'    THEN 'Massing Studies'
  WHEN 'schematic design'   THEN 'Schematic Design'
  WHEN 'model making'       THEN 'Model Making'
  WHEN 'design development' THEN 'Design Development'
  WHEN 'final review'       THEN 'Final Review'
END
WHERE lower(btrim(phase)) IN (
  'site analysis', 'massing studies', 'schematic design',
  'model making', 'design development', 'final review'
);

COMMIT;

-- VERIFY: must return 0. A row here is one the picker will show as a custom
-- value sitting beside the identical suggestion.
SELECT COUNT(*) AS rows_still_on_the_old_spelling
FROM canvases
WHERE phase IN (
  'Site analysis', 'Massing studies', 'Schematic design',
  'Model making', 'Design development', 'Final review'
);

-- VERIFY: the resulting spread, for eyeballing. Everything that is not free
-- text somebody typed should now be Title Case.
SELECT COALESCE(phase, '(null)') AS phase, COUNT(*) AS crits
FROM canvases
GROUP BY 1
ORDER BY 1;
