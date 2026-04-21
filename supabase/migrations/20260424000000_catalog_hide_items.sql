-- Catalog hide + delete from the editor surface.
--
-- Adds two nullable columns to furniture_items so the item can be removed from
-- the default catalog view without destroying data. Hidden items stay
-- referenceable (existing placed instances keep rendering) and can be
-- unhidden. Admins can hide anything via the existing "manage all" policy;
-- designers can hide their own draft/rejected items via the existing
-- "update own draft/rejected" policy.
--
-- Also adds a DELETE policy for designers on their own draft/rejected items
-- so the drawer's Delete button works without needing admin rights for
-- personal drafts. Hard delete is still blocked at the FK level when the
-- item is referenced by placed_furniture (NO ACTION).

ALTER TABLE public.furniture_items
  ADD COLUMN hidden_at timestamptz NULL,
  ADD COLUMN hidden_by uuid NULL REFERENCES public.profiles(id);

CREATE INDEX idx_furniture_items_hidden_at ON public.furniture_items(hidden_at);

CREATE POLICY "Designers can delete own draft/rejected items"
  ON public.furniture_items FOR DELETE
  USING (auth.uid() = submitted_by AND status IN ('draft', 'rejected'));
