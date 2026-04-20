-- ============================================================
-- Wall-mounted fixtures (doors / windows)
--
-- Adds admin-curated door & window catalog that runs through the same
-- TRELLIS pipeline as regular furniture, but placement is constrained
-- to wall segments (not the X/Z floor grid).
--
-- Changes:
--   1. New enum: mount_type ('floor' | 'wall')
--   2. furniture_categories.mount_type + is_wall_fixture admin-only RLS
--   3. Seed new categories: Door, Window
--   4. furniture_items.source_url now nullable (wall fixtures have no purchase link)
--   5. Restrict designer INSERT on wall-mount categories (admin-only)
--   6. Seed a Default Door + Default Window item so legacy
--      room.geometry.doors[]/windows[] entries have something to render.
--      (variant_id references are stored in geometry JSON, not a FK.)
-- ============================================================


-- ============================================================
-- 1. ENUM: mount_type
-- ============================================================

CREATE TYPE public.mount_type AS ENUM ('floor', 'wall');


-- ============================================================
-- 2. furniture_categories.mount_type
-- Default 'floor' matches all existing seeded categories.
-- ============================================================

ALTER TABLE public.furniture_categories
  ADD COLUMN mount_type mount_type NOT NULL DEFAULT 'floor';

CREATE INDEX idx_furniture_categories_mount_type
  ON public.furniture_categories(mount_type);


-- ============================================================
-- 3. Seed Door + Window categories
-- ============================================================

INSERT INTO public.furniture_categories (id, name, icon, sort_order, mount_type)
VALUES
  (gen_random_uuid(), 'Door',   'door-open',   13, 'wall'),
  (gen_random_uuid(), 'Window', 'panel-top',   14, 'wall')
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- 4. furniture_items.source_url — drop NOT NULL
-- Wall fixtures have no purchase link. Floor items can still store one.
-- ============================================================

ALTER TABLE public.furniture_items
  ALTER COLUMN source_url DROP NOT NULL;


-- ============================================================
-- 5. Restrict designer INSERT on wall-mount categories (admin-only)
--
-- The existing "Designers can create furniture items" policy lets any
-- authenticated user insert. We add a second guard that denies wall
-- fixtures unless the caller is an admin. Admins already bypass via
-- "Admins can manage all furniture items".
-- ============================================================

DROP POLICY IF EXISTS "Designers can create furniture items" ON public.furniture_items;

CREATE POLICY "Designers can create floor items; admins can create wall fixtures"
  ON public.furniture_items FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = submitted_by
    AND (
      -- floor items: any authenticated user
      EXISTS (
        SELECT 1 FROM public.furniture_categories c
        WHERE c.id = category_id AND c.mount_type = 'floor'
      )
      OR
      -- wall fixtures: admin-only
      public.is_admin()
    )
  );


-- ============================================================
-- 6. Seed Default Door + Default Window
--
-- Creates a draft-status parent item per wall category so existing
-- room.geometry.doors[]/windows[] entries (which have no variant_id
-- yet) can fall back to rendering the generic panel.
--
-- variant_id wiring happens at runtime — the client looks for the
-- first approved variant when rendering a fixture that lacks one.
-- ============================================================

-- Find or create an admin profile to own the defaults. If no admin
-- exists yet, use the oldest profile. If no profiles exist at all,
-- skip seeding — the site is unused.
DO $$
DECLARE
  owner_id uuid;
  door_cat uuid;
  window_cat uuid;
BEGIN
  SELECT id INTO owner_id FROM public.profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1;
  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM public.profiles ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF owner_id IS NULL THEN
    RAISE NOTICE 'No profiles exist — skipping default fixture seeding';
    RETURN;
  END IF;

  SELECT id INTO door_cat FROM public.furniture_categories WHERE name = 'Door' LIMIT 1;
  SELECT id INTO window_cat FROM public.furniture_categories WHERE name = 'Window' LIMIT 1;

  IF door_cat IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.furniture_items WHERE category_id = door_cat
  ) THEN
    INSERT INTO public.furniture_items
      (name, category_id, source_url, source_domain, description,
       width_cm, height_cm, depth_cm, status, submitted_by)
    VALUES
      ('Default Door', door_cat, NULL, 'internal',
       'Generic door — used as fallback when a placed door has no variant_id',
       80, 210, 4, 'approved', owner_id);
  END IF;

  IF window_cat IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.furniture_items WHERE category_id = window_cat
  ) THEN
    INSERT INTO public.furniture_items
      (name, category_id, source_url, source_domain, description,
       width_cm, height_cm, depth_cm, status, submitted_by)
    VALUES
      ('Default Window', window_cat, NULL, 'internal',
       'Generic window — used as fallback when a placed window has no variant_id',
       100, 120, 4, 'approved', owner_id);
  END IF;
END $$;
