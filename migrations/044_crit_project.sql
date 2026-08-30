-- 044 — a desk crit records which project it was about.
--
-- Phase (043) says WHERE in a project a crit sat; this says WHICH project. A
-- term has more than one, and "show me every massing crit" is a different
-- question from "show me every crit on the Quincy Center building" — without
-- this, filtering by phase alone mixes projects together.
--
-- FREE TEXT, and deliberately not a foreign key to anything.
--
-- The obvious alternative was to hang a crit off a workspace — the student's
-- studio section — but a class is not a project: two projects inside one studio
-- would collapse into the same bucket, and a project that runs across a term
-- boundary would split into two. A project is a thing the student names, so it
-- is stored as the name they gave it.
--
-- Consistency comes from the UI, not the schema: the create dialog offers the
-- projects already used on this person's other crits, so the ordinary path is
-- picking an existing one and the typing path is for the first crit of a new
-- project. A lookup table would have bought referential integrity at the cost
-- of a second entity to create, name, own and clean up, for a field that is one
-- string.
--
-- NULLABLE, no backfill. Existing crits have no project — nobody was asked —
-- and inventing one would read exactly like an answer somebody chose.

BEGIN;

ALTER TABLE canvases ADD COLUMN IF NOT EXISTS project text;

COMMIT;

-- Verify:
--   SELECT id, title, phase, project FROM canvases;
