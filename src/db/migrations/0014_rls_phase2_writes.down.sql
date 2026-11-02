-- ZAMO-RBAC-018 :: rollback Phase 2 write policies
DROP POLICY IF EXISTS user_roles_facility_write ON user_roles;
DROP POLICY IF EXISTS users_facility_manager_write ON users;
DROP POLICY IF EXISTS users_admin_write ON users;
