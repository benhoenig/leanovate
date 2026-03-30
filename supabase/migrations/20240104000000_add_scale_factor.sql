-- Add scale_factor to placed_furniture for custom furniture sizing
ALTER TABLE public.placed_furniture
ADD COLUMN scale_factor float NOT NULL DEFAULT 1.0;
