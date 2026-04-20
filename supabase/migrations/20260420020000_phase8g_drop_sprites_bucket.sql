-- ============================================================
-- Phase 8g — drop RLS policies for the retired sprites bucket
--
-- Phase 8 retired 4-angle sprite rendering; .glb models are rendered
-- directly in the Three.js canvas. The `sprites` bucket was emptied
-- and deleted on the remote via the Supabase Storage API.
--
-- This migration drops the matching RLS policies (created in the V1
-- schema + 20240103 policy migration) so remote and local migration
-- history converge. `IF EXISTS` makes it idempotent.
--
-- Note: Supabase blocks direct DELETE on `storage.buckets`. Buckets
-- must be removed via the Storage API (CLI / Dashboard). On fresh
-- installs, the V1 migration still creates an empty `sprites` bucket
-- which is harmless (no code writes to it).
-- ============================================================

DROP POLICY IF EXISTS "Public can read sprites" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload sprites" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update sprites" ON storage.objects;
