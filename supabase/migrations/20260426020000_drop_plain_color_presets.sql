-- Drop flat-color wall/floor presets + delete door/window finishes entirely.
--
-- Context 1 (wall/floor): pre-existing DB had ~13 hex-color wall/floor
-- presets seeded via the Supabase dashboard (Bamboo, Black Slate, Oak
-- Parquet, Warm White, etc.). The 20260426000000 texture migration used
-- WHERE NOT EXISTS, so some of its inserts collided with pre-existing hex
-- rows of the same name ("Warm Oak", "Dark Walnut", "Herringbone Oak",
-- "White Marble", "Warm Beige", "Warm White") and silently skipped —
-- leaving the flat-color versions as the active rows.
--
-- Context 2 (door/window): doors and windows are now individually placed
-- fixtures (see `placed_furniture` on wall-mount categories) — they render
-- as selected variant `.glb`s or a default fallback panel. A room-level
-- "door color" / "window color" finish concept no longer applies. Removing
-- both the presets and the picker UI simplifies the model.
--
-- This migration:
--   1. Deletes every non-custom hex-thumbnail wall/floor preset (clears the
--      flat paint swatches from the finishes tab).
--   2. Deletes every non-custom door and window finish_materials row
--      (door and window are dropped from the surfaces concept entirely).
--   3. Re-asserts the full 13-texture seed so the previously-blocked ones
--      land this time. WHERE NOT EXISTS keeps it idempotent.
--
-- Preserved:
--   - Custom designer uploads (`is_custom = true`) in any type.
--   - Lighting rows (deferred feature — the tab hides them for now but the
--     rows stay so we don't lose the seed when we rebuild the lighting UI).
--
-- Enum cleanup: the `finish_type` enum still has 'door' and 'window' values
-- since dropping enum values requires rebuilding every column using the
-- type. Not worth the churn for values nothing writes anymore. The
-- TypeScript `FinishType` union drops them, so the app layer won't create
-- new rows of those types.
--
-- Rooms with `finishes.wall|floor.material_id` or `finishes.door|window.*`
-- pointing at a deleted row will render with the default fallback color.
-- No FK cascade — material_id lives inside a JSONB column.

DELETE FROM public.finish_materials
WHERE is_custom = false
  AND (
    (type IN ('wall', 'floor') AND thumbnail_path LIKE '#%')
    OR type IN ('door', 'window')
  );

-- ── Re-assert floor textures ─────────────────────────────────────────────────
INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'Warm Oak', '/textures/floors/warm-oak.jpg', '/textures/floors/warm-oak.jpg', 200, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'Warm Oak' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'Light Laminate', '/textures/floors/light-laminate.jpg', '/textures/floors/light-laminate.jpg', 200, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'Light Laminate' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'Dark Walnut', '/textures/floors/dark-walnut.jpg', '/textures/floors/dark-walnut.jpg', 200, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'Dark Walnut' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'Herringbone Oak', '/textures/floors/herringbone-oak.jpg', '/textures/floors/herringbone-oak.jpg', 150, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'Herringbone Oak' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'White Marble', '/textures/floors/white-marble.jpg', '/textures/floors/white-marble.jpg', 200, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'White Marble' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'Neutral Tile', '/textures/floors/neutral-tile.jpg', '/textures/floors/neutral-tile.jpg', 120, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'Neutral Tile' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'Polished Concrete', '/textures/floors/polished-concrete.jpg', '/textures/floors/polished-concrete.jpg', 300, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'Polished Concrete' AND is_custom = false);

-- ── Re-assert wall textures ──────────────────────────────────────────────────
INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Warm Grey Plaster', '/textures/walls/warm-grey-plaster.jpg', '/textures/walls/warm-grey-plaster.jpg', 250, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Warm Grey Plaster' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Soft White Plaster', '/textures/walls/soft-white-plaster.jpg', '/textures/walls/soft-white-plaster.jpg', 250, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Soft White Plaster' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Oak Paneling', '/textures/walls/oak-paneling.jpg', '/textures/walls/oak-paneling.jpg', 200, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Oak Paneling' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Walnut Paneling', '/textures/walls/walnut-paneling.jpg', '/textures/walls/walnut-paneling.jpg', 200, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Walnut Paneling' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Red Brick', '/textures/walls/red-brick.jpg', '/textures/walls/red-brick.jpg', 200, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Red Brick' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Light Brick', '/textures/walls/light-brick.jpg', '/textures/walls/light-brick.jpg', 200, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Light Brick' AND is_custom = false);
