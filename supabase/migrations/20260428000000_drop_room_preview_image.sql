-- Drop rooms.preview_image_url
--
-- The per-wall "Preview Room" modal (and its companion renderer) were
-- deleted in favor of a simple "Export View" button on the live 3D canvas
-- that downloads the current camera angle as a 4K PNG directly to the
-- designer's machine. No image is stored on the room anymore — the live
-- canvas IS the source of truth, and exports are ephemeral files, not
-- attached to project data.
--
-- Safe clean-slate drop: no paying users; the column was populated only
-- by the old "Save to Project" action which no longer exists.

ALTER TABLE public.rooms DROP COLUMN IF EXISTS preview_image_url;
