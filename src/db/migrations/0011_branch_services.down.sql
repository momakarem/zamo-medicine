-- ZAMO-CAT-015 :: rollback branch services
DROP POLICY IF EXISTS dsvc_tenant_write ON doctor_services;
DROP POLICY IF EXISTS dsvc_tenant_read ON doctor_services;
DROP POLICY IF EXISTS dsvc_admin_all ON doctor_services;
DROP POLICY IF EXISTS bs_tenant_write ON branch_services;
DROP POLICY IF EXISTS bs_tenant_read ON branch_services;
DROP POLICY IF EXISTS bs_admin_all ON branch_services;
DROP TRIGGER IF EXISTS branch_services_touch ON branch_services;
DROP TABLE IF EXISTS doctor_services;
DROP TABLE IF EXISTS branch_services;
