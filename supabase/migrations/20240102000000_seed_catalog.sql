-- ============================================================
-- LEANOVATE — Seed: furniture_categories + styles
-- Run after: 20240101000000_full_schema.sql
-- ============================================================


-- ============================================================
-- FURNITURE CATEGORIES
-- ============================================================

INSERT INTO public.furniture_categories (id, name, icon, sort_order) VALUES
  (gen_random_uuid(), 'Sofa',          'sofa',         1),
  (gen_random_uuid(), 'Bed',           'bed',          2),
  (gen_random_uuid(), 'Dining Table',  'dining-table', 3),
  (gen_random_uuid(), 'Chair',         'chair',        4),
  (gen_random_uuid(), 'TV Stand',      'tv-stand',     5),
  (gen_random_uuid(), 'Coffee Table',  'coffee-table', 6),
  (gen_random_uuid(), 'Wardrobe',      'wardrobe',     7),
  (gen_random_uuid(), 'Shelf',         'shelf',        8),
  (gen_random_uuid(), 'Desk',          'desk',         9),
  (gen_random_uuid(), 'Lamp',          'lamp',         10),
  (gen_random_uuid(), 'Rug',           'rug',          11),
  (gen_random_uuid(), 'Side Table',    'side-table',   12)
ON CONFLICT DO NOTHING;


-- ============================================================
-- STYLES
-- ============================================================

INSERT INTO public.styles (id, name, sort_order) VALUES
  (gen_random_uuid(), 'Modern',       1),
  (gen_random_uuid(), 'Minimal',      2),
  (gen_random_uuid(), 'Japandi',      3),
  (gen_random_uuid(), 'Scandinavian', 4),
  (gen_random_uuid(), 'Luxury',       5),
  (gen_random_uuid(), 'Mid-Century',  6),
  (gen_random_uuid(), 'Industrial',   7),
  (gen_random_uuid(), 'Bohemian',     8)
ON CONFLICT DO NOTHING;
