-- Catalog UI: Sims-style tile thumbnails
-- Stores a cached isometric snapshot rendered from the variant's .glb,
-- shown in CatalogPanel so the left sidebar feels like a buy-mode catalog
-- instead of a text/metadata list.
--
-- Path format: "variants/{variant_id}.png" in the `thumbnails` bucket.
-- Null for flat items (they reuse original_image_urls[0] as the tile image)
-- and for approved-but-not-yet-rendered legacy variants — a client-side
-- backfill helper (`ensureVariantThumbnail`) fills those lazily.

ALTER TABLE public.furniture_variants
  ADD COLUMN IF NOT EXISTS thumbnail_path text;


-- ────────────────────────────────────────────────────────────────────────────
-- Thumbnails bucket: browser-side uploads + public read
--
-- The `thumbnails` bucket was originally written only from Edge Functions
-- (service_role) with an authenticated-read policy. Variant tile thumbnails
-- need two changes:
--   1. Authenticated INSERT (rendered client-side from the browser, not an
--      Edge Function).
--   2. Public SELECT, so `<img src={publicUrl}>` works without an auth
--      header. These thumbnails are non-sensitive — they render the same
--      product the designer uploaded and mirror how `sprites` used to work.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE storage.buckets
   SET public = true
 WHERE id = 'thumbnails';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'Authenticated users can upload thumbnails'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Authenticated users can upload thumbnails"
        ON storage.objects FOR INSERT
        TO authenticated
        WITH CHECK (bucket_id = 'thumbnails')
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'Authenticated users can update thumbnails'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Authenticated users can update thumbnails"
        ON storage.objects FOR UPDATE
        TO authenticated
        USING (bucket_id = 'thumbnails')
        WITH CHECK (bucket_id = 'thumbnails')
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'Public can read thumbnails'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Public can read thumbnails"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'thumbnails')
    $pol$;
  END IF;
END
$$;
