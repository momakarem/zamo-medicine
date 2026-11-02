-- ZAMO-RBAC-010 :: Row-Level Security policies for tenant isolation.
--
-- DEC-004 mandates a DUAL enforcement model:
--   Layer 1: Application-level RBAC (rbac.ts middleware)
--   Layer 2: Database-level RLS (this file) — safety net
--
-- If a code bug lets the wrong query through, RLS blocks it at the DB level.
-- This is the last line of defence.
--
-- Session variables set by the application (via testing.ts `asAppUser`):
--   zamo.user_id      — current user
--   zamo.facility_id  — current facility
--   zamo.branch_ids   — comma-separated branch UUIDs
--   zamo.role_code    — current role

-- ========================================================================
-- Enable RLS on all tenant-scoped tables
-- ========================================================================

ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities FORCE ROW LEVEL SECURITY;

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;

-- ========================================================================
-- Facility policies — users see only their own facility
-- ========================================================================

-- zamo_admin sees all facilities.
CREATE POLICY facilities_admin_all ON facilities
  FOR ALL
  TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'zamo_admin'
  );

-- Facility-scoped users see only their facility.
CREATE POLICY facilities_tenant_read ON facilities
  FOR SELECT
  TO zamo_app
  USING (
    id::text = current_setting('zamo.facility_id', true)
  );

-- ========================================================================
-- Branch policies — users see branches in their facility
-- ========================================================================

CREATE POLICY branches_admin_all ON branches
  FOR ALL
  TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'zamo_admin'
  );

CREATE POLICY branches_tenant_read ON branches
  FOR SELECT
  TO zamo_app
  USING (
    facility_id::text = current_setting('zamo.facility_id', true)
  );

-- Branch-scoped roles see only their assigned branches.
CREATE POLICY branches_branch_scoped ON branches
  FOR SELECT
  TO zamo_app
  USING (
    id::text = ANY(string_to_array(current_setting('zamo.branch_ids', true), ','))
  );

-- ========================================================================
-- User policies
-- ========================================================================

-- Users can see themselves.
CREATE POLICY users_self ON users
  FOR SELECT
  TO zamo_app
  USING (
    id::text = current_setting('zamo.user_id', true)
  );

-- Facility managers/admins can see users in their facility.
CREATE POLICY users_facility_staff ON users
  FOR SELECT
  TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'facility_manager')
    AND id IN (
      SELECT user_id FROM user_roles
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- Patients are visible to staff in their booking's facility
-- (handled at application level; RLS allows self-access only for patients).
CREATE POLICY users_patient_self ON users
  FOR SELECT
  TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'patient'
    AND id::text = current_setting('zamo.user_id', true)
  );

-- ========================================================================
-- User_roles policies
-- ========================================================================

CREATE POLICY user_roles_admin_all ON user_roles
  FOR ALL
  TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'zamo_admin'
  );

CREATE POLICY user_roles_facility_read ON user_roles
  FOR SELECT
  TO zamo_app
  USING (
    facility_id::text = current_setting('zamo.facility_id', true)
  );

CREATE POLICY user_roles_self ON user_roles
  FOR SELECT
  TO zamo_app
  USING (
    user_id::text = current_setting('zamo.user_id', true)
  );

-- ========================================================================
-- Grant minimum privileges to zamo_app
-- ========================================================================
-- (SELECTs are already granted in 0001; adding UPDATE/INSERT for session vars)

GRANT SELECT, INSERT, UPDATE, DELETE ON facilities TO zamo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON branches TO zamo_app;
GRANT SELECT, INSERT, UPDATE ON users TO zamo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles TO zamo_app;
