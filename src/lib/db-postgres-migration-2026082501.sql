-- NexyFab commercial payment authority migration v2026082501.
--
-- Payment routes historically created these order columns lazily during a
-- request. Commercial startup preflight already requires them, so a fresh or
-- restored database could never become ready without first serving a mutating
-- request. Move the schema boundary into the versioned, checksum-bound runner.

ALTER TABLE nf_orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE nf_orders
  ADD COLUMN IF NOT EXISTS toss_order_id TEXT;

ALTER TABLE nf_orders
  ADD COLUMN IF NOT EXISTS updated_at BIGINT;

UPDATE nf_orders
  SET updated_at = created_at
  WHERE updated_at IS NULL;

ALTER TABLE nf_orders
  ALTER COLUMN updated_at SET DEFAULT (floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payment_status_updated
  ON nf_orders(payment_status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_toss_order_id
  ON nf_orders(toss_order_id)
  WHERE toss_order_id IS NOT NULL;
