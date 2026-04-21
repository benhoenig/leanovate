-- ============================================================
-- Disable TRELLIS pipeline for wall-mount fixtures (doors/windows).
--
-- Rationale: architectural fixtures are rendered as room-shell
-- primitives (cutout + textured panel for doors, glass + frame for
-- windows, procedural pleated cloth for curtains). TRELLIS-generated
-- .glb files produced heavy distortion for transparent / thin / framed
-- geometry (real-world example: a window .glb rendered as a warped
-- box with black framing artefacts).
--
-- Going forward the client-side catalog store gates createVariant and
-- retryRender on the parent category's mount_type='wall'. This
-- migration cleans up any rows that already went through the pipeline
-- before the gate was added, so the admin approval queue and the room
-- shell renderer stop referencing the bad .glb files.
--
-- Storage cleanup: the .glb files themselves are left orphaned in
-- the `glb-models` bucket. Safe to sweep manually later if needed.
-- ============================================================

UPDATE public.furniture_variants v
SET
  glb_path = NULL,
  render_status = 'completed',
  render_approval_status = 'approved'
WHERE v.furniture_item_id IN (
  SELECT i.id
  FROM public.furniture_items i
  JOIN public.furniture_categories c ON c.id = i.category_id
  WHERE c.mount_type = 'wall'
)
AND (v.glb_path IS NOT NULL OR v.render_approval_status = 'pending');
