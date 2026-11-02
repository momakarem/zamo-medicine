-- ZAMO-CAT-014 :: rollback catalog
DROP POLICY IF EXISTS svc_admin_write ON services;
DROP POLICY IF EXISTS svc_read_all ON services;
DROP POLICY IF EXISTS spec_admin_write ON specialties;
DROP POLICY IF EXISTS spec_read_all ON specialties;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS specialties;
