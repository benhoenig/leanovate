-- Dashboard: project card canvas thumbnails
-- Cached isometric snapshot of the project's primary room, rendered
-- client-side in the browser and stored in the `thumbnails` bucket at
-- `projects/{project_id}.png`. Null until the designer first saves the
-- project in the editor (or triggers a manual refresh from the dashboard).
--
-- The `thumbnails` bucket already allows authenticated uploads + public
-- reads (see 20260422000000_variant_thumbnails.sql), so no additional
-- storage policies are needed here.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS thumbnail_path text;
