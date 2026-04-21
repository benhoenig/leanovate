-- Extend `mount_type` enum: + 'ceiling'. Kept in its own migration so the
-- value is committed before the seed in the next migration inserts a row
-- using it (PostgreSQL forbids using a new enum value in the same
-- transaction that added it).

ALTER TYPE public.mount_type ADD VALUE IF NOT EXISTS 'ceiling';
