-- ZAMO-RBAC-010 :: rollback for 0006_rls_policies
--
-- Policies must be dropped before RLS is disabled, otherwise
-- the cascading DROP leaves orphan policy references.

-- Facility policies
DROP POLICY IF EXISTS facilities_admin_all ON facilities;
DROP POLICY IF EXISTS facilities_tenant_read ON facilities;

-- Branch policies
DROP POLICY IF EXISTS branches_admin_all ON branches;
DROP POLICY IF EXISTS branches_tenant_read ON branches;
DROP POLICY IF EXISTS branches_branch_scoped ON branches;

-- User policies
DROP POLICY IF EXISTS users_self ON users;
DROP POLICY IF EXISTS users_facility_staff ON users;
DROP POLICY IF EXISTS users_patient_self ON users;

-- User_roles policies
DROP POLICY IF EXISTS user_roles_admin_all ON user_roles;
DROP POLICY IF EXISTS user_roles_facility_read ON user_roles;
DROP POLICY IF EXISTS user_roles_self ON user_roles;

-- Disable RLS
ALTER TABLE facilities DISABLE ROW LEVEL SECURITY;
ALTER TABLE branches DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;
