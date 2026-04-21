-- Backfill: variants with a valid .glb path but render_status still stuck at
-- 'processing' or 'waiting'. Caused by a prior edge-function bug where
-- generate-3d-model wrote glb_path but never flipped render_status to
-- 'completed' — the client patched local state, but the DB stayed stale, so
-- on reload the catalog tile showed "Generating 3D…" forever.
--
-- This query corrects the DB for all affected rows. The edge function has
-- been updated to set render_status in the same UPDATE, so this should be
-- a one-off cleanup.

UPDATE public.furniture_variants
SET render_status = 'completed'
WHERE glb_path IS NOT NULL
  AND render_status IN ('processing', 'waiting');
