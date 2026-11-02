-- ZAMO-DOC-013 :: rollback practitioners
DROP POLICY IF EXISTS dl_tenant_write ON doctor_leaves;
DROP POLICY IF EXISTS dl_tenant ON doctor_leaves;
DROP POLICY IF EXISTS dl_admin_all ON doctor_leaves;
DROP POLICY IF EXISTS dsch_tenant_write ON doctor_schedules;
DROP POLICY IF EXISTS dsch_tenant ON doctor_schedules;
DROP POLICY IF EXISTS dsch_admin_all ON doctor_schedules;
DROP POLICY IF EXISTS db_tenant_write ON doctor_branches;
DROP POLICY IF EXISTS db_tenant ON doctor_branches;
DROP POLICY IF EXISTS db_admin_all ON doctor_branches;
DROP POLICY IF EXISTS doc_tenant_write ON doctors;
DROP POLICY IF EXISTS doc_tenant_read ON doctors;
DROP POLICY IF EXISTS doc_admin_all ON doctors;
DROP TRIGGER IF EXISTS doctors_touch ON doctors;
DROP TABLE IF EXISTS doctor_leaves;
DROP TABLE IF EXISTS doctor_schedules;
DROP TABLE IF EXISTS doctor_branches;
DROP TABLE IF EXISTS doctors;
