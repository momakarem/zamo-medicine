-- ZAMO-LIC-017 :: rollback licensing
DROP POLICY IF EXISTS ca_tenant_read ON compliance_alerts;
DROP POLICY IF EXISTS ca_admin_all ON compliance_alerts;
DROP POLICY IF EXISTS vr_tenant_read ON verification_reviews;
DROP POLICY IF EXISTS vr_admin_all ON verification_reviews;
DROP POLICY IF EXISTS lic_tenant_insert ON licenses;
DROP POLICY IF EXISTS lic_tenant_read ON licenses;
DROP POLICY IF EXISTS lic_admin_all ON licenses;
DROP TRIGGER IF EXISTS licenses_touch ON licenses;
DROP TABLE IF EXISTS compliance_alerts;
DROP TABLE IF EXISTS verification_reviews;
DROP TABLE IF EXISTS licenses;
