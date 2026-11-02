-- ZAMO-DB-003 :: rollback for 0001_core_identity
-- Dropped in reverse dependency order.

DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS branches;
DROP TABLE IF EXISTS facilities;

DROP FUNCTION IF EXISTS zamo_touch_updated_at();

-- zamo_app is intentionally NOT dropped: other migrations may have granted it
-- privileges, and dropping a role that still owns grants fails.
