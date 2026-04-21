-- ============================================================
-- Picture Frames + Custom Art Library
--
-- Adds a "Picture Frame" flat-item category where the frame itself is
-- a real purchasable product (tracked in furniture_items/variants like
-- any other piece) but the art *inside* the frame is designer-supplied.
-- Art is stored in a new `art_library` table — uploaders keep it private
-- by default or flip a per-row `scope` to 'team' to make it visible to
-- the whole team (open share, no approval gate for v1).
--
-- Rendering (handled in roomScene.ts):
--   1. Frames render as a *vertical* flat plane (new `flat_orientation`
--      enum on categories — 'horizontal' for rugs, 'vertical' for frames).
--   2. If placed_furniture.art_id is set, a second plane overlays the
--      frame mat area, sized to furniture_items.mat_opening_cm.
--
-- Schema changes:
--   1. Enums: flat_orientation, art_scope
--   2. furniture_categories: + flat_orientation, + accepts_art
--   3. furniture_items: + mat_opening_cm (jsonb {w, h})
--   4. art_library table (+ RLS)
--   5. placed_furniture: + art_id FK → art_library (ON DELETE SET NULL)
--   6. frame-art storage bucket (public read like `thumbnails`)
--   7. Seed Picture Frame category
-- ============================================================


-- ============================================================
-- 1. Enums
-- ============================================================

CREATE TYPE public.flat_orientation AS ENUM ('horizontal', 'vertical');

CREATE TYPE public.art_scope AS ENUM ('private', 'team');


-- ============================================================
-- 2. furniture_categories: flat_orientation, accepts_art
-- ============================================================

ALTER TABLE public.furniture_categories
  ADD COLUMN flat_orientation public.flat_orientation NOT NULL DEFAULT 'horizontal',
  ADD COLUMN accepts_art boolean NOT NULL DEFAULT false;


-- ============================================================
-- 3. furniture_items.mat_opening_cm
--
-- Inner mat rectangle (the visible art area) in cm. Shape:
--   { "w": number, "h": number }
-- Null for non-frame items. Required at the application layer when the
-- item's category has accepts_art = true.
-- ============================================================

ALTER TABLE public.furniture_items
  ADD COLUMN mat_opening_cm jsonb;


-- ============================================================
-- 4. art_library
--
-- Designer-uploaded art images that can be placed inside picture frames.
-- scope = 'private': only the uploader (and admins) can see it.
-- scope = 'team':    everyone on the team can see it.
--
-- Aspect ratio is stored as w/h (float) so the frame picker can filter
-- art that fits a given mat opening without recomputing from pixels.
-- ============================================================

CREATE TABLE public.art_library (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          text NOT NULL,
  image_path    text NOT NULL,   -- path within the `frame-art` bucket
  aspect_ratio  float NOT NULL,  -- width / height
  scope         public.art_scope NOT NULL DEFAULT 'private',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_art_library_uploaded_by ON public.art_library(uploaded_by);
CREATE INDEX idx_art_library_scope        ON public.art_library(scope);

CREATE TRIGGER set_art_library_updated_at
  BEFORE UPDATE ON public.art_library
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.art_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own private art, all team art, admins read all"
  ON public.art_library FOR SELECT
  TO authenticated
  USING (
    scope = 'team'
    OR uploaded_by = auth.uid()
    OR public.is_admin()
  );

CREATE POLICY "Users insert their own art"
  ON public.art_library FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Users update own art; admins can update any"
  ON public.art_library FOR UPDATE
  TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_admin())
  WITH CHECK (uploaded_by = auth.uid() OR public.is_admin());

CREATE POLICY "Users delete own art; admins can delete any"
  ON public.art_library FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_admin());


-- ============================================================
-- 5. placed_furniture.art_id
--
-- When a placed item is a picture frame, this optionally references
-- the art_library row whose image fills the mat. Null = empty frame
-- (renders just the frame's product photo — mat area visible but empty).
--
-- ON DELETE SET NULL: if the art is deleted or the uploader's account
-- is removed, the frame silently falls back to empty rather than
-- orphaning the placement or blowing up the FK.
-- ============================================================

ALTER TABLE public.placed_furniture
  ADD COLUMN art_id uuid REFERENCES public.art_library(id) ON DELETE SET NULL;

CREATE INDEX idx_placed_furniture_art_id ON public.placed_furniture(art_id);


-- ============================================================
-- 6. frame-art storage bucket
--
-- Public read (so plain <img src={publicUrl}> works in the scene without
-- auth headers, same pattern as the `thumbnails` bucket since the
-- variant-thumbnail migration). DB-level RLS on art_library is the
-- primary privacy control — the bucket paths use UUIDs so they're not
-- easily guessable even for private art.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('frame-art', 'frame-art', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload frame art"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'frame-art');

CREATE POLICY "Authenticated users can delete frame art"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'frame-art');

CREATE POLICY "Public can read frame art"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'frame-art');


-- ============================================================
-- 7. Seed: Picture Frame category
--
-- is_flat=true         → bypasses TRELLIS (no .glb needed)
-- flat_orientation='vertical' → renders upright, not on the floor
-- accepts_art=true     → UI shows the art picker for items in this category
-- mount_type='floor'   → designers can create frame items (wall mount is
--                         admin-only and reserved for architectural fixtures)
-- default_block_size='small' → 25cm grid snap (frames are accent pieces)
-- ============================================================

INSERT INTO public.furniture_categories
  (id, name, icon, sort_order, is_flat, flat_orientation, accepts_art, mount_type, default_block_size)
VALUES
  (gen_random_uuid(), 'Picture Frame', 'image', 15, true, 'vertical', true, 'floor', 'small')
ON CONFLICT (name) DO NOTHING;
