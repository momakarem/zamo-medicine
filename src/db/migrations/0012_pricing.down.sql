-- ZAMO-CAT-016 :: rollback pricing
DROP POLICY IF EXISTS prices_tenant_write ON prices;
DROP POLICY IF EXISTS prices_tenant_read ON prices;
DROP POLICY IF EXISTS prices_admin_all ON prices;
DROP TABLE IF EXISTS prices;
