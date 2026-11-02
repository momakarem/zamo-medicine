-- ZAMO-RBAC-018 :: extend RLS policies for Phase 2 write operations.
--
-- Phase 1 (0006) defined SELECT-only policies for users and user_roles.
-- Phase 2 needs write access for:
--   - zamo_admin: can INSERT/UPDATE users (facility onboarding creates users)
--   - facility_manager: can UPDATE users in their facility (deactivation, MFA)
--   - facility_manager: can INSERT/DELETE user_roles in their facility

-- ========================================================================
-- users — write policies
-- ========================================================================

-- Admin can INSERT new users (needed for facility onboarding approval)
CREATE POLICY users_admin_write ON users
  FOR ALL
  TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'zamo_admin'
  );

-- Facility manager can UPDATE users in their facility (deactivation, MFA)
CREATE POLICY users_facility_manager_write ON users
  FOR UPDATE
  TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'facility_manager'
    AND id IN (
      SELECT user_id FROM user_roles
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- ========================================================================
-- user_roles — write policies for facility management
-- ========================================================================

-- Facility manager can INSERT/DELETE roles within their facility
CREATE POLICY user_roles_facility_write ON user_roles
  FOR ALL
  TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );
