-- Tileable textures for wall + floor finishes
--
-- Previously `finish_materials.thumbnail_path` held either a hex color
-- (for presets) or a Supabase Storage URL (for designer uploads), and the
-- renderer used it only as a flat color. Walls and floors as flat blocks
-- of color read as fake — wood floors looked like brown rectangles.
--
-- This migration adds two optional columns:
--   texture_url   — path or URL to a seamless tileable image. If set, the
--                   renderer applies it as a `MeshStandardMaterial.map`
--                   with world-space UVs so the texture tiles at a real
--                   physical scale instead of stretching to fit the surface.
--   tile_size_cm  — real-world size of one texture repeat (e.g. 200cm of
--                   wall maps to one full texture tile). Null defaults to
--                   200cm in the renderer.
--
-- `thumbnail_path` keeps its dual-meaning contract (hex OR URL) as the UI
-- swatch source — for textured finishes we set it to the same texture URL
-- so the swatch in the picker is the texture itself.
--
-- Seeds a curated library of 13 Poly Haven CC0 textures (7 floors, 6 walls)
-- committed to `public/textures/`. WHERE NOT EXISTS makes the seed idempotent.

ALTER TABLE public.finish_materials
  ADD COLUMN IF NOT EXISTS texture_url   text,
  ADD COLUMN IF NOT EXISTS tile_size_cm  integer;

-- ── Floors ───────────────────────────────────────────────────────────────────
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

-- ── Walls ────────────────────────────────────────────────────────────────────
-- Warm white / warm beige flat paints still make sense as hex presets —
-- flat paint on a wall actually reads correctly as a solid color. Textured
-- options below are for the cases where flat color clearly falls short
-- (brick, wood paneling, plastered texture).

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Warm White', '#F5F1EA', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Warm White' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Warm Beige', '#E8DFD2', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Warm Beige' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Sage Green', '#B8C5B0', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Sage Green' AND is_custom = false);

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
