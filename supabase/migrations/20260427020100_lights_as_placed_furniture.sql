-- ============================================================
-- Ceiling lights as placed furniture (replaces per-room ceiling fixture)
--
-- Phase A shipped a single ceiling fixture per room pinned to the polygon
-- centroid, configured via `rooms.finishes.lighting`. Designers need to
-- add multiple downlights, move them, and delete them — so lights become
-- placeable furniture like everything else.
--
-- Depends on 20260427020000_add_ceiling_mount_type.sql committing the
-- 'ceiling' enum value first.
--
-- Changes:
--   1. `furniture_categories.emits_light` boolean (TRELLIS bypass + render hook)
--   2. `placed_furniture.light_settings` jsonb — per-instance
--      { enabled, preset, temperature_k, intensity }. Null → warm defaults.
--   3. Clean up Phase A leftovers:
--      - DELETE finish_materials WHERE type='lighting' (the 2 seeded styles)
--      - UPDATE rooms SET finishes = finishes - 'lighting' (strip stale JSON)
--      Safe because no paying users — clean-slate policy per CLAUDE.md.
--   4. Seed "Ceiling Light" category (mount_type='ceiling', emits_light=true,
--      is_flat=false, default_block_size='small').
--   5. Seed Recessed Downlight + Pendant Sphere items + default variants
--      so designers can place immediately. Procedural mesh — no photos
--      or .glb needed; variants jump straight to render_status='completed'.
-- ============================================================


-- 1. furniture_categories.emits_light
ALTER TABLE public.furniture_categories
  ADD COLUMN IF NOT EXISTS emits_light boolean NOT NULL DEFAULT false;


-- 2. placed_furniture.light_settings
ALTER TABLE public.placed_furniture
  ADD COLUMN IF NOT EXISTS light_settings jsonb;


-- 3. Clean up Phase A leftovers
DELETE FROM public.finish_materials
  WHERE type = 'lighting' AND is_custom = false;

UPDATE public.rooms
  SET finishes = finishes - 'lighting'
  WHERE finishes ? 'lighting';


-- 4. Seed Ceiling Light category
INSERT INTO public.furniture_categories
  (id, name, icon, sort_order, is_flat, default_block_size, mount_type, emits_light)
VALUES
  (gen_random_uuid(), 'Ceiling Light', 'lightbulb', 16, false, 'small', 'ceiling', true)
ON CONFLICT (name) DO NOTHING;


-- 5. Seed Recessed Downlight + Pendant Sphere items
DO $$
DECLARE
  owner_id uuid;
  ceiling_cat uuid;
  item_id uuid;
BEGIN
  SELECT id INTO owner_id FROM public.profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1;
  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM public.profiles ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF owner_id IS NULL THEN
    RAISE NOTICE 'No profiles exist — skipping ceiling-light seeding';
    RETURN;
  END IF;

  SELECT id INTO ceiling_cat FROM public.furniture_categories WHERE name = 'Ceiling Light' LIMIT 1;
  IF ceiling_cat IS NULL THEN
    RAISE NOTICE 'Ceiling Light category not found — skipping seed';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.furniture_items WHERE category_id = ceiling_cat AND name = 'Recessed Downlight') THEN
    INSERT INTO public.furniture_items
      (name, category_id, source_url, source_domain, description,
       width_cm, depth_cm, height_cm, status, submitted_by)
    VALUES
      ('Recessed Downlight', ceiling_cat, NULL, 'internal',
       'Procedural flush-mount downlight. Rendered from code — no photos or TRELLIS pass.',
       20, 20, 4, 'approved', owner_id)
    RETURNING id INTO item_id;

    INSERT INTO public.furniture_variants
      (furniture_item_id, color_name, price_thb, original_image_urls,
       render_status, render_approval_status, sort_order)
    VALUES
      (item_id, 'White', NULL, ARRAY[]::text[], 'completed', 'approved', 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.furniture_items WHERE category_id = ceiling_cat AND name = 'Pendant Sphere') THEN
    INSERT INTO public.furniture_items
      (name, category_id, source_url, source_domain, description,
       width_cm, depth_cm, height_cm, status, submitted_by)
    VALUES
      ('Pendant Sphere', ceiling_cat, NULL, 'internal',
       'Procedural pendant globe on a short cord. Rendered from code — no photos or TRELLIS pass.',
       20, 20, 50, 'approved', owner_id)
    RETURNING id INTO item_id;

    INSERT INTO public.furniture_variants
      (furniture_item_id, color_name, price_thb, original_image_urls,
       render_status, render_approval_status, sort_order)
    VALUES
      (item_id, 'Warm White', NULL, ARRAY[]::text[], 'completed', 'approved', 0);
  END IF;
END $$;
