-- ============================================================
-- LEANOVATE — Full Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================


-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE public.user_role AS ENUM ('admin', 'designer');
CREATE TYPE public.item_status AS ENUM ('draft', 'pending', 'approved', 'rejected');
CREATE TYPE public.image_status AS ENUM ('processing', 'pending_approval', 'approved', 'rejected');
CREATE TYPE public.render_status AS ENUM ('waiting', 'processing', 'completed', 'failed');
CREATE TYPE public.direction AS ENUM ('front_left', 'front_right', 'back_left', 'back_right');
CREATE TYPE public.link_status AS ENUM ('active', 'inactive', 'unchecked');
CREATE TYPE public.project_status AS ENUM ('draft', 'completed');
CREATE TYPE public.finish_type AS ENUM ('wall', 'floor', 'door', 'window', 'lighting');


-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Checks if current user is admin (SECURITY DEFINER bypasses RLS on the profiles table)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Auto-sets updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- TABLE: profiles
-- Extends auth.users. Auto-created on sign-up via trigger.
-- ============================================================

CREATE TABLE public.profiles (
  id           uuid       PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role         user_role  NOT NULL DEFAULT 'designer',
  display_name text       NOT NULL,
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Trigger: auto-create profile row when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'designer'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: create profiles for any users who signed up before this migration
INSERT INTO public.profiles (id, display_name, role)
SELECT
  au.id,
  COALESCE(au.raw_user_meta_data->>'display_name', split_part(au.email, '@', 1)),
  'designer'
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = au.id
);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ============================================================
-- TABLE: furniture_categories
-- ============================================================

CREATE TABLE public.furniture_categories (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text    NOT NULL UNIQUE,
  icon       text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_furniture_categories_sort ON public.furniture_categories(sort_order);

ALTER TABLE public.furniture_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read categories"
  ON public.furniture_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage categories"
  ON public.furniture_categories FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: styles
-- ============================================================

CREATE TABLE public.styles (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text    NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_styles_sort ON public.styles(sort_order);

ALTER TABLE public.styles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read styles"
  ON public.styles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage styles"
  ON public.styles FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: finish_materials
-- ============================================================

CREATE TABLE public.finish_materials (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type           finish_type NOT NULL,
  name           text        NOT NULL,
  thumbnail_path text        NOT NULL,
  is_custom      boolean     NOT NULL DEFAULT false,
  uploaded_by    uuid        REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_finish_materials_type ON public.finish_materials(type);
CREATE INDEX idx_finish_materials_is_custom ON public.finish_materials(is_custom);

ALTER TABLE public.finish_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read finish materials"
  ON public.finish_materials FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Designers can upload custom finish materials"
  ON public.finish_materials FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = uploaded_by AND is_custom = true);

CREATE POLICY "Admins can manage all finish materials"
  ON public.finish_materials FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: projects
-- ============================================================

CREATE TABLE public.projects (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid           NOT NULL REFERENCES public.profiles(id),
  name           text           NOT NULL,
  description    text,
  status         project_status NOT NULL DEFAULT 'draft',
  unit_width_cm  integer        NOT NULL,
  unit_height_cm integer        NOT NULL,
  manual_costs   jsonb          NOT NULL DEFAULT '{}',
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_owner_id ON public.projects(owner_id);
CREATE INDEX idx_projects_status ON public.projects(status);

CREATE TRIGGER set_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage own projects"
  ON public.projects FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Admins can manage all projects"
  ON public.projects FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: rooms
-- ============================================================

CREATE TABLE public.rooms (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  x                 float       NOT NULL,
  y                 float       NOT NULL,
  width_cm          integer     NOT NULL,
  height_cm         integer     NOT NULL,
  geometry          jsonb       NOT NULL DEFAULT '{}',
  finishes          jsonb       NOT NULL DEFAULT '{}',
  sort_order        integer     NOT NULL DEFAULT 0,
  preview_image_url text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rooms_project_id ON public.rooms(project_id);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage rooms in own projects"
  ON public.rooms FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = rooms.project_id AND owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = rooms.project_id AND owner_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage all rooms"
  ON public.rooms FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: furniture_items
-- ============================================================

CREATE TABLE public.furniture_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  category_id   uuid        NOT NULL REFERENCES public.furniture_categories(id),
  source_url    text        NOT NULL,
  source_domain text        NOT NULL,
  width_cm      integer,
  depth_cm      integer,
  height_cm     integer,
  description   text,
  status        item_status NOT NULL DEFAULT 'draft',
  submitted_by  uuid        NOT NULL REFERENCES public.profiles(id),
  reviewed_by   uuid        REFERENCES public.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_furniture_items_category_id ON public.furniture_items(category_id);
CREATE INDEX idx_furniture_items_submitted_by ON public.furniture_items(submitted_by);
CREATE INDEX idx_furniture_items_status ON public.furniture_items(status);

CREATE TRIGGER set_furniture_items_updated_at
  BEFORE UPDATE ON public.furniture_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.furniture_items ENABLE ROW LEVEL SECURITY;

-- Designers see: their own items (any status) + approved items from others
CREATE POLICY "Designers see own items and all approved items"
  ON public.furniture_items FOR SELECT
  USING (
    auth.uid() = submitted_by
    OR status = 'approved'
    OR public.is_admin()
  );

CREATE POLICY "Designers can create furniture items"
  ON public.furniture_items FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = submitted_by);

CREATE POLICY "Designers can update own draft/rejected items"
  ON public.furniture_items FOR UPDATE
  USING (auth.uid() = submitted_by AND status IN ('draft', 'rejected'))
  WITH CHECK (auth.uid() = submitted_by);

CREATE POLICY "Admins can manage all furniture items"
  ON public.furniture_items FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: furniture_item_styles (many-to-many join)
-- ============================================================

CREATE TABLE public.furniture_item_styles (
  furniture_item_id uuid NOT NULL REFERENCES public.furniture_items(id) ON DELETE CASCADE,
  style_id          uuid NOT NULL REFERENCES public.styles(id) ON DELETE CASCADE,
  PRIMARY KEY (furniture_item_id, style_id)
);

ALTER TABLE public.furniture_item_styles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read item styles"
  ON public.furniture_item_styles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Designers can tag own items"
  ON public.furniture_item_styles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.furniture_items
      WHERE id = furniture_item_id AND submitted_by = auth.uid()
    )
  );

CREATE POLICY "Designers can remove tags from own items"
  ON public.furniture_item_styles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.furniture_items
      WHERE id = furniture_item_id AND submitted_by = auth.uid()
    )
  );

CREATE POLICY "Admins can manage all style tags"
  ON public.furniture_item_styles FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: furniture_variants
-- ============================================================

CREATE TABLE public.furniture_variants (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  furniture_item_id  uuid          NOT NULL REFERENCES public.furniture_items(id) ON DELETE CASCADE,
  color_name         text          NOT NULL,
  price_thb          decimal,
  source_url         text,
  width_cm           integer,
  depth_cm           integer,
  height_cm          integer,
  original_image_url text          NOT NULL,
  clean_image_url    text,
  image_status       image_status  NOT NULL DEFAULT 'processing',
  glb_path           text,
  render_status      render_status NOT NULL DEFAULT 'waiting',
  link_status        link_status   NOT NULL DEFAULT 'unchecked',
  last_checked_at    timestamptz,
  price_changed      boolean       NOT NULL DEFAULT false,
  sort_order         integer       NOT NULL DEFAULT 0,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_furniture_variants_item_id ON public.furniture_variants(furniture_item_id);
CREATE INDEX idx_furniture_variants_image_status ON public.furniture_variants(image_status);
CREATE INDEX idx_furniture_variants_render_status ON public.furniture_variants(render_status);
CREATE INDEX idx_furniture_variants_link_status ON public.furniture_variants(link_status);

CREATE TRIGGER set_furniture_variants_updated_at
  BEFORE UPDATE ON public.furniture_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.furniture_variants ENABLE ROW LEVEL SECURITY;

-- Variants visible if the parent item is visible to this user
CREATE POLICY "Variants visible if parent item is visible"
  ON public.furniture_variants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.furniture_items fi
      WHERE fi.id = furniture_item_id
        AND (fi.submitted_by = auth.uid() OR fi.status = 'approved' OR public.is_admin())
    )
  );

CREATE POLICY "Designers can create variants for own items"
  ON public.furniture_variants FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.furniture_items
      WHERE id = furniture_item_id AND submitted_by = auth.uid()
    )
  );

CREATE POLICY "Designers can update variants for own items"
  ON public.furniture_variants FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.furniture_items
      WHERE id = furniture_item_id AND submitted_by = auth.uid()
    )
  );

CREATE POLICY "Admins can manage all variants"
  ON public.furniture_variants FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: furniture_sprites
-- ============================================================

CREATE TABLE public.furniture_sprites (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid        NOT NULL REFERENCES public.furniture_variants(id) ON DELETE CASCADE,
  direction  direction   NOT NULL,
  image_path text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, direction)
);

CREATE INDEX idx_furniture_sprites_variant_id ON public.furniture_sprites(variant_id);

ALTER TABLE public.furniture_sprites ENABLE ROW LEVEL SECURITY;

-- Sprites visible if parent variant's parent item is visible
CREATE POLICY "Sprites visible if parent item is visible"
  ON public.furniture_sprites FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.furniture_variants fv
      JOIN public.furniture_items fi ON fi.id = fv.furniture_item_id
      WHERE fv.id = variant_id
        AND (fi.submitted_by = auth.uid() OR fi.status = 'approved' OR public.is_admin())
    )
  );

CREATE POLICY "Admins can manage all sprites"
  ON public.furniture_sprites FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: placed_furniture
-- ============================================================

CREATE TABLE public.placed_furniture (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             uuid        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  furniture_item_id   uuid        NOT NULL REFERENCES public.furniture_items(id),
  selected_variant_id uuid        NOT NULL REFERENCES public.furniture_variants(id),
  x                   float       NOT NULL,
  y                   float       NOT NULL,
  direction           direction   NOT NULL DEFAULT 'front_left',
  price_at_placement  decimal,
  sort_order          integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_placed_furniture_room_id ON public.placed_furniture(room_id);
CREATE INDEX idx_placed_furniture_item_id ON public.placed_furniture(furniture_item_id);

ALTER TABLE public.placed_furniture ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage placed furniture in own projects"
  ON public.placed_furniture FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      JOIN public.projects p ON p.id = r.project_id
      WHERE r.id = placed_furniture.room_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rooms r
      JOIN public.projects p ON p.id = r.project_id
      WHERE r.id = placed_furniture.room_id AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage all placed furniture"
  ON public.placed_furniture FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: unit_layout_templates
-- ============================================================

CREATE TABLE public.unit_layout_templates (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  created_by     uuid        NOT NULL REFERENCES public.profiles(id),
  is_global      boolean     NOT NULL DEFAULT false,
  promoted_by    uuid        REFERENCES public.profiles(id),
  unit_width_cm  integer     NOT NULL,
  unit_height_cm integer     NOT NULL,
  rooms_data     jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_unit_layout_templates_created_by ON public.unit_layout_templates(created_by);
CREATE INDEX idx_unit_layout_templates_is_global ON public.unit_layout_templates(is_global);

ALTER TABLE public.unit_layout_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own and global unit templates"
  ON public.unit_layout_templates FOR SELECT
  USING (auth.uid() = created_by OR is_global = true OR public.is_admin());

CREATE POLICY "Users can create own unit templates"
  ON public.unit_layout_templates FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by AND is_global = false);

CREATE POLICY "Users can update own non-global unit templates"
  ON public.unit_layout_templates FOR UPDATE
  USING (auth.uid() = created_by AND is_global = false)
  WITH CHECK (auth.uid() = created_by AND is_global = false);

CREATE POLICY "Users can delete own non-global unit templates"
  ON public.unit_layout_templates FOR DELETE
  USING (auth.uid() = created_by AND is_global = false);

CREATE POLICY "Admins can manage all unit templates"
  ON public.unit_layout_templates FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: furniture_layout_templates
-- ============================================================

CREATE TABLE public.furniture_layout_templates (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL,
  created_by            uuid        NOT NULL REFERENCES public.profiles(id),
  is_global             boolean     NOT NULL DEFAULT false,
  promoted_by           uuid        REFERENCES public.profiles(id),
  layout_data           jsonb       NOT NULL,
  compatible_unit_types text[],
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_furniture_layout_templates_created_by ON public.furniture_layout_templates(created_by);
CREATE INDEX idx_furniture_layout_templates_is_global ON public.furniture_layout_templates(is_global);

ALTER TABLE public.furniture_layout_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own and global furniture templates"
  ON public.furniture_layout_templates FOR SELECT
  USING (auth.uid() = created_by OR is_global = true OR public.is_admin());

CREATE POLICY "Users can create own furniture templates"
  ON public.furniture_layout_templates FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by AND is_global = false);

CREATE POLICY "Users can update own non-global furniture templates"
  ON public.furniture_layout_templates FOR UPDATE
  USING (auth.uid() = created_by AND is_global = false)
  WITH CHECK (auth.uid() = created_by AND is_global = false);

CREATE POLICY "Users can delete own non-global furniture templates"
  ON public.furniture_layout_templates FOR DELETE
  USING (auth.uid() = created_by AND is_global = false);

CREATE POLICY "Admins can manage all furniture templates"
  ON public.furniture_layout_templates FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- TABLE: design_style_templates
-- ============================================================

CREATE TABLE public.design_style_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  style_id    uuid        NOT NULL REFERENCES public.styles(id),
  created_by  uuid        NOT NULL REFERENCES public.profiles(id),
  is_global   boolean     NOT NULL DEFAULT false,
  promoted_by uuid        REFERENCES public.profiles(id),
  items_data  jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_design_style_templates_created_by ON public.design_style_templates(created_by);
CREATE INDEX idx_design_style_templates_is_global ON public.design_style_templates(is_global);
CREATE INDEX idx_design_style_templates_style_id ON public.design_style_templates(style_id);

ALTER TABLE public.design_style_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own and global style templates"
  ON public.design_style_templates FOR SELECT
  USING (auth.uid() = created_by OR is_global = true OR public.is_admin());

CREATE POLICY "Users can create own style templates"
  ON public.design_style_templates FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by AND is_global = false);

CREATE POLICY "Users can update own non-global style templates"
  ON public.design_style_templates FOR UPDATE
  USING (auth.uid() = created_by AND is_global = false)
  WITH CHECK (auth.uid() = created_by AND is_global = false);

CREATE POLICY "Users can delete own non-global style templates"
  ON public.design_style_templates FOR DELETE
  USING (auth.uid() = created_by AND is_global = false);

CREATE POLICY "Admins can manage all style templates"
  ON public.design_style_templates FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- STORAGE BUCKETS
-- file_size_limit is in bytes: 10MB=10485760, 100MB=104857600, 5MB=5242880
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('original-images', 'original-images', false, 10485760,   ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('clean-images',    'clean-images',    false, 10485760,   ARRAY['image/png']),
  ('glb-models',      'glb-models',      false, 104857600,  ARRAY['model/gltf-binary']),
  ('sprites',         'sprites',         true,  5242880,    ARRAY['image/png']),
  ('textures',        'textures',        false, 10485760,   ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('thumbnails',      'thumbnails',      false, 5242880,    ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- STORAGE RLS POLICIES
-- Note: Edge Functions run with service_role (bypasses RLS).
-- These policies cover browser-side uploads and reads.
-- ============================================================

-- original-images: authenticated users upload; authenticated users read
CREATE POLICY "Authenticated users can upload original images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'original-images');

CREATE POLICY "Authenticated users can read original images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'original-images');

-- clean-images: written by Edge Functions (service_role); authenticated users read
CREATE POLICY "Authenticated users can read clean images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'clean-images');

-- glb-models: written by Edge Functions (service_role); authenticated users read
CREATE POLICY "Authenticated users can read glb models"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'glb-models');

-- sprites: public bucket — anyone can read (for canvas rendering)
CREATE POLICY "Public can read sprites"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'sprites');

-- textures: authenticated users upload and read
CREATE POLICY "Authenticated users can upload textures"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'textures');

CREATE POLICY "Authenticated users can read textures"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'textures');

-- thumbnails: written by Edge Functions (service_role); authenticated users read
CREATE POLICY "Authenticated users can read thumbnails"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'thumbnails');
