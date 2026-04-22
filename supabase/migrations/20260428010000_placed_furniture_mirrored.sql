-- Per-instance horizontal mirror for placed furniture.
--
-- Many real-world products ship as "left-hand" / "right-hand" SKUs:
-- L-shaped sectional sofas, writing desks with a fixed drawer side, beds
-- with an asymmetric headboard shelf. Today designers would need to
-- catalog both handednesses as separate items. The `mirrored` flag flips
-- the rendered group around its vertical axis at render time — one SKU
-- in the catalog, either handedness on the canvas.
--
-- Three.js handles the determinant-sign flip automatically, so face
-- culling + lighting stay correct for the common case. Caveat: any text
-- or logos baked into the product photo will read backwards. Designers
-- will learn which items flip cleanly.

ALTER TABLE public.placed_furniture
  ADD COLUMN IF NOT EXISTS mirrored boolean NOT NULL DEFAULT false;
