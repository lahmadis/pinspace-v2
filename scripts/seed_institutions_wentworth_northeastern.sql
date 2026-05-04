-- Ensure Wentworth and Northeastern exist in institutions.
-- Safe to run anytime (ON CONFLICT DO NOTHING).
-- After this, workspaces linked to WIT (e.g. "test studio") will show under Wentworth.

INSERT INTO institutions (name, slug, network_label)
VALUES
  ('Wentworth Institute of Technology', 'wit', 'WIT Design Network'),
  ('Northeastern University', 'northeastern', 'Northeastern')
ON CONFLICT (slug) DO NOTHING;
