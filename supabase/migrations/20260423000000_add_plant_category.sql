-- Add Plant category to furniture catalog.
-- Small block size (tracks with Chair/Lamp/Side Table/Coffee Table).
-- Not flat — plants have real 3D volume, route through TRELLIS like other furniture.

INSERT INTO public.furniture_categories (id, name, icon, sort_order, default_block_size, is_flat)
VALUES (gen_random_uuid(), 'Plant', 'plant', 13, 'small', false)
ON CONFLICT (name) DO NOTHING;
