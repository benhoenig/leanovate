-- ============================================================
-- Phase 8a — 3D canvas data model
--
-- Changes:
--   1. Truncate projects + all template tables (clean slate)
--   2. Drop furniture_sprites table entirely (sprite-based rendering retired)
--   3. Add block_size enum + furniture_categories.default_block_size + furniture_items.block_size_override
--   4. placed_furniture: rename x→x_cm, y→z_cm, add y_cm, replace direction enum → rotation_deg float
--   5. Drop direction enum (no longer referenced)
--
-- IMPORTANT: This is destructive. Truncates projects/rooms/placed_furniture
-- and all 3 template tables. Storage buckets (.glb, sprites for flat items)
-- are NOT touched.
-- ============================================================


-- ============================================================
-- 0. CLEAN SLATE — truncate dependent test data
-- ============================================================

TRUNCATE TABLE public.projects CASCADE;          -- cascades to rooms, placed_furniture
TRUNCATE TABLE public.design_style_templates;
TRUNCATE TABLE public.furniture_layout_templates;
TRUNCATE TABLE public.unit_layout_templates;


-- ============================================================
-- 1. DROP furniture_sprites table
-- 4-angle sprite rendering is replaced by direct .glb rendering in Three.js.
-- ============================================================

DROP TABLE public.furniture_sprites;


-- ============================================================
-- 2. NEW ENUM: block_size
-- ============================================================

CREATE TYPE public.block_size AS ENUM ('big', 'small');


-- ============================================================
-- 3. furniture_categories.default_block_size
-- big = 100 cm grid, small = 25 cm grid
-- ============================================================

ALTER TABLE public.furniture_categories
  ADD COLUMN default_block_size block_size NOT NULL DEFAULT 'big';

-- Small block defaults: accent / accessory pieces typically < 100 cm wide
UPDATE public.furniture_categories
SET default_block_size = 'small'
WHERE name IN ('Chair', 'Lamp', 'Side Table', 'Coffee Table');


-- ============================================================
-- 4. furniture_items.block_size_override
-- Per-item override of the category default. Null = inherit.
-- ============================================================

ALTER TABLE public.furniture_items
  ADD COLUMN block_size_override block_size;


-- ============================================================
-- 5. placed_furniture coordinate + rotation rework
--   x → x_cm     (horizontal, room-local)
--   y → z_cm     (depth, room-local — Three.js Y is up)
--   add y_cm     (vertical offset; 0 for floor items, non-zero for wall-mounted)
--   direction (enum) → rotation_deg (continuous float, 0–360)
-- Table is empty (truncate above), so column drops are safe.
-- ============================================================

ALTER TABLE public.placed_furniture RENAME COLUMN x TO x_cm;
ALTER TABLE public.placed_furniture RENAME COLUMN y TO z_cm;
ALTER TABLE public.placed_furniture ADD COLUMN y_cm float NOT NULL DEFAULT 0;
ALTER TABLE public.placed_furniture DROP COLUMN direction;
ALTER TABLE public.placed_furniture ADD COLUMN rotation_deg float NOT NULL DEFAULT 0;


-- ============================================================
-- 6. Drop direction enum
-- Was only used by placed_furniture.direction (now dropped) + JSONB fields
-- in templates (now truncated).
-- ============================================================

DROP TYPE public.direction;
