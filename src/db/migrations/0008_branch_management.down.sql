-- ZAMO-FAC-012 :: rollback branch management
DROP POLICY IF EXISTS ip_admin_write ON insurance_plans;
DROP POLICY IF EXISTS ip_read_all ON insurance_plans;
DROP POLICY IF EXISTS bp_tenant_write ON branch_policies;
DROP POLICY IF EXISTS bp_tenant ON branch_policies;
DROP POLICY IF EXISTS bp_admin_all ON branch_policies;
DROP POLICY IF EXISTS bi_tenant_write ON branch_insurance;
DROP POLICY IF EXISTS bi_tenant ON branch_insurance;
DROP POLICY IF EXISTS bi_admin_all ON branch_insurance;
DROP POLICY IF EXISTS wh_tenant_write ON working_hours;
DROP POLICY IF EXISTS wh_tenant ON working_hours;
DROP POLICY IF EXISTS wh_admin_all ON working_hours;
DROP TRIGGER IF EXISTS branch_policies_touch ON branch_policies;
DROP TABLE IF EXISTS branch_policies;
DROP TABLE IF EXISTS branch_insurance;
DROP TABLE IF EXISTS insurance_plans;
DROP TABLE IF EXISTS working_hours;
