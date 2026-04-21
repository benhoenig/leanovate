-- Ceiling lighting fixtures — Phase A
--
-- Seeds two ceiling-fixture styles in `finish_materials` with type='lighting'.
-- The renderer (`src/lib/roomScene.ts` → `fixtureKindFromMaterial`) picks the
-- luminaire mesh by matching the filename in `thumbnail_path`:
--   path contains 'pendant' → pendant globe
--   anything else           → recessed downlight
--
-- The richer per-room settings (enabled/preset/temperature_k/intensity) live
-- inside `rooms.finishes.lighting` (JSONB) — no column migration needed.
--
-- `texture_url` stays null: the fixture is rendered procedurally, the
-- thumbnail is only used as the picker swatch.

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'lighting', 'Recessed Downlight', '/textures/lighting/recessed.svg', NULL, NULL, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.finish_materials
  WHERE type = 'lighting' AND name = 'Recessed Downlight' AND is_custom = false
);

INSERT INTO public.finish_materials (type, name, thumbnail_path, texture_url, tile_size_cm, is_custom)
SELECT 'lighting', 'Pendant Sphere', '/textures/lighting/pendant.svg', NULL, NULL, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.finish_materials
  WHERE type = 'lighting' AND name = 'Pendant Sphere' AND is_custom = false
);
