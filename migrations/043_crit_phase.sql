-- 043 — a desk crit records which phase of the project it was about.
--
-- The card already showed a date and a status pill (Today / Planned /
-- Reviewed), and neither answers the question you actually ask looking back at
-- a term of crits: what stage was this? Two crits a week apart can sit either
-- side of a phase change, so the date cannot be made to imply it.
--
-- TEXT, not an enum and not a CHECK. The list lives in
-- lib/constants/critPhases.ts and the API validates against it, so the
-- constraint is real — it just lives where adding a phase is one line rather
-- than a migration. The brief that produced the list ended in "etc.", which is
-- the clearest possible signal that it will grow. Same call STUDIOS and
-- DEPARTMENTS already make.
--
-- NULLABLE, with no backfill. Existing crits genuinely have no phase — nobody
-- was ever asked — and writing a default into them would invent an answer that
-- reads exactly like one somebody chose. The UI shows "No phase" for null and
-- lets it be set; new crits get a default at creation instead.

BEGIN;

ALTER TABLE canvases ADD COLUMN IF NOT EXISTS phase text;

COMMIT;

-- Verify:
--   SELECT id, title, phase FROM canvases;   -- phase NULL on existing rows
