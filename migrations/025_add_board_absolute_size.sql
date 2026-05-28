-- 025: absolute board size in inches (decouples board size from wall geometry)
--
-- Why: board size was stored only as a percentage of the wall (position_width /
-- position_height) and multiplied by the live wall dimensions at render time.
-- Resizing a wall therefore stretched every board on it (wrong aspect ratio).
-- These new columns hold the board's true size in inches, independent of any
-- wall, so resizing a wall no longer alters the boards.
--
-- position_width / position_height are intentionally LEFT IN PLACE as dead
-- columns (parked for post-pilot deprecated-column cleanup). Do not drop here.

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS board_width_in  REAL,
  ADD COLUMN IF NOT EXISTS board_height_in REAL;

-- Backfill existing rows, in priority order (matches getBoardSizeInches in
-- lib/boardDimensions.ts). physical_* and aspect_ratio are stored as text, so
-- cast to numeric. aspect_ratio = width / height (>= 1 landscape, < 1 portrait).
--   1. physical_width AND physical_height present -> use them directly (real inches).
--   2. else aspect_ratio present -> scale so the LARGER dimension = 36".
--   3. else -> 36 x 36 default.
UPDATE boards
SET
  board_width_in = CASE
    WHEN physical_width IS NOT NULL AND physical_height IS NOT NULL
         AND physical_width::numeric  > 0 AND physical_height::numeric > 0
      THEN physical_width::numeric
    WHEN aspect_ratio IS NOT NULL AND aspect_ratio::numeric > 0
      THEN CASE WHEN aspect_ratio::numeric >= 1 THEN 36 ELSE 36 * aspect_ratio::numeric END
    ELSE 36
  END,
  board_height_in = CASE
    WHEN physical_width IS NOT NULL AND physical_height IS NOT NULL
         AND physical_width::numeric  > 0 AND physical_height::numeric > 0
      THEN physical_height::numeric
    WHEN aspect_ratio IS NOT NULL AND aspect_ratio::numeric > 0
      THEN CASE WHEN aspect_ratio::numeric >= 1 THEN 36 / aspect_ratio::numeric ELSE 36 END
    ELSE 36
  END
WHERE board_width_in IS NULL OR board_height_in IS NULL;
