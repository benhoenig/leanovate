-- Migration: Allow authenticated users to upload sprites from the client
--
-- Previously, sprite uploads were done by the render-sprites Edge Function
-- using the service_role key (which bypasses RLS). Now that sprite rendering
-- runs client-side in the browser, we need INSERT/UPDATE policies on:
--   1. storage.objects (sprites bucket) — so the client can upload PNG files
--   2. furniture_sprites table — so the client can upsert sprite rows

-- 1. Storage: allow authenticated users to upload to sprites bucket
CREATE POLICY "Authenticated users can upload sprites"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'sprites');

CREATE POLICY "Authenticated users can update sprites"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'sprites');

-- 2. Table: allow designers to insert/update sprites for their own items
CREATE POLICY "Designers can insert sprites for own items"
  ON public.furniture_sprites FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.furniture_variants fv
      JOIN public.furniture_items fi ON fi.id = fv.furniture_item_id
      WHERE fv.id = variant_id
        AND fi.submitted_by = auth.uid()
    )
  );

CREATE POLICY "Designers can update sprites for own items"
  ON public.furniture_sprites FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.furniture_variants fv
      JOIN public.furniture_items fi ON fi.id = fv.furniture_item_id
      WHERE fv.id = variant_id
        AND fi.submitted_by = auth.uid()
    )
  );
