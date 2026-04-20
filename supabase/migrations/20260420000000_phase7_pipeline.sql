-- ============================================================
-- Phase 7 — Pipeline Improvements
--
-- Changes:
--   1. Drop rembg entirely → remove clean_image_url + image_status from variants
--   2. Multi-image upload per variant → original_image_url → original_image_urls[]
--   3. Post-TRELLIS approval gate → render_approval_status enum + column
--   4. Flat-item bypass → furniture_categories.is_flat + furniture_items.is_flat_override
--
-- Clean slate: truncate test catalog data (no paying users yet).
--   Keeps: categories, styles, profiles, finish_materials
--   Drops: all furniture_items, variants, sprites, and all projects/rooms/placed/templates
--   that depend on them.
-- ============================================================


-- ============================================================
-- 0. CLEAN SLATE — truncate dependent test data
-- ============================================================

-- Cascade removes placed_furniture, variants, sprites, item_styles
TRUNCATE TABLE public.furniture_items CASCADE;

-- Template snapshots reference item/variant IDs that no longer exist → wipe
TRUNCATE TABLE public.design_style_templates;
TRUNCATE TABLE public.furniture_layout_templates;


-- ============================================================
-- 1. NEW ENUM: render_approval_status
-- ============================================================

CREATE TYPE public.render_approval_status AS ENUM ('pending', 'approved', 'rejected');


-- ============================================================
-- 2. furniture_variants schema updates
-- ============================================================

-- Drop rembg columns — TRELLIS does its own background removal
ALTER TABLE public.furniture_variants DROP COLUMN clean_image_url;
ALTER TABLE public.furniture_variants DROP COLUMN image_status;
DROP INDEX IF EXISTS idx_furniture_variants_image_status;

-- Replace single original_image_url with array (1–N images per variant)
ALTER TABLE public.furniture_variants DROP COLUMN original_image_url;
ALTER TABLE public.furniture_variants
  ADD COLUMN original_image_urls text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Post-TRELLIS approval gate
ALTER TABLE public.furniture_variants
  ADD COLUMN render_approval_status render_approval_status NOT NULL DEFAULT 'pending';

CREATE INDEX idx_furniture_variants_render_approval
  ON public.furniture_variants(render_approval_status);

-- Drop image_status enum (no longer referenced)
DROP TYPE public.image_status;


-- ============================================================
-- 3. Flat-item bypass
-- ============================================================

ALTER TABLE public.furniture_categories
  ADD COLUMN is_flat boolean NOT NULL DEFAULT false;

ALTER TABLE public.furniture_items
  ADD COLUMN is_flat_override boolean;

-- Seed flat categories (rug, plus any thin/flat preset categories)
-- Note: curtains, wall art, bedding, mirrors are not in the seed
-- category list — designers can use is_flat_override per item.
UPDATE public.furniture_categories
SET is_flat = true
WHERE name IN ('Rug');
