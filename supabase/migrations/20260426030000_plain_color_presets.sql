-- Re-introduce a curated set of plain-color wall + floor presets.
--
-- Flat paint walls + painted/epoxy floors are a legitimate interior choice,
-- especially for contemporary/minimal styles. The previous cleanup
-- migration (20260426020000) dropped ALL non-custom hex presets because the
-- old dashboard-seeded palette was messy (13+ arbitrary colors, many
-- duplicated the texture names). This migration re-seeds a tight curated
-- palette alongside the existing texture presets — 6 walls, 3 floors.
--
-- Selection criteria: warm Sims-y palette, usable across common interior
-- styles (Japandi, modern, minimal), and distinct enough from each other to
-- justify being separate swatches.
--
-- The UI shows plain colors and textures in separate groups under each
-- finish type (the swatch checks `thumbnail_path.startsWith('#')`).

-- ── Wall plain colors ────────────────────────────────────────────────────────
INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Warm White', '#F5F1EA', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Warm White' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Warm Beige', '#E8DFD2', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Warm Beige' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Soft Grey', '#D8D5D0', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Soft Grey' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Sage Green', '#B8C5B0', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Sage Green' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Dusty Blue', '#B8C4CE', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Dusty Blue' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'wall', 'Terracotta', '#C4785A', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'wall' AND name = 'Terracotta' AND is_custom = false);

-- ── Floor plain colors ───────────────────────────────────────────────────────
-- Intentionally short — most real floor materials want a texture. These
-- cover the painted / resin / epoxy finish cases.

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'Light Epoxy', '#E0DCD4', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'Light Epoxy' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'Mid Grey Epoxy', '#A8A5A0', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'Mid Grey Epoxy' AND is_custom = false);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'floor', 'Charcoal Epoxy', '#4A4844', NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.finish_materials WHERE type = 'floor' AND name = 'Charcoal Epoxy' AND is_custom = false);
