-- 1. Enable RLS on shop_orders so purchase history isn't readable via anon key
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;

-- Users can only read their own orders
DROP POLICY IF EXISTS shop_orders_select_own ON public.shop_orders;

CREATE POLICY shop_orders_select_own ON public.shop_orders
  FOR SELECT TO authenticated
  USING ((select auth.uid())::text = user_id);

-- Service role (backend) can do everything
DROP POLICY IF EXISTS shop_orders_service ON public.shop_orders;

CREATE POLICY shop_orders_service ON public.shop_orders
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Index on user_entitlements(entitlement_id) for stats queries that filter by entitlement_id.
-- The existing PK is (user_id, entitlement_id) which can't serve WHERE entitlement_id = X efficiently.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_entitlements_entitlement_id
  ON public.user_entitlements (entitlement_id);

-- 3. Unique partial index to enforce one-time merch purchase limit at the DB level.
-- FOR UPDATE on non-existent rows is a no-op, so the application-level check alone
-- can't prevent concurrent inserts. This index makes the DB reject duplicates.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_shop_orders_one_time_active
  ON public.shop_orders (user_id, item_id)
  WHERE status NOT IN ('FAILED', 'REFUNDED', 'CANCELLED');
