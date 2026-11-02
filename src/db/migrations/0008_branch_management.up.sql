-- ZAMO-FAC-012 :: branch management — working hours, insurance, policies.
--
-- [S1]: "إضافة/تعديل/إيقاف فرع + موقع + ساعات"
-- [S2]: Branch has working hours, insurance plans, and policies.
--
-- Hard constraint (A-48, A-49, DEC-014): NO diagnostic / medical fields.

-- ---------------------------------------------------------------------------
-- working_hours — weekly schedule per branch.
-- ---------------------------------------------------------------------------
CREATE TABLE working_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun
  open_time   time NOT NULL,
  close_time  time NOT NULL,
  is_closed   boolean NOT NULL DEFAULT false,
  CONSTRAINT working_hours_unique UNIQUE (branch_id, day_of_week),
  CONSTRAINT working_hours_valid_range CHECK (is_closed OR open_time < close_time)
);

-- ---------------------------------------------------------------------------
-- insurance_plans — platform-level insurance directory.
-- ---------------------------------------------------------------------------
CREATE TABLE insurance_plans (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar   text NOT NULL CHECK (length(btrim(name_ar)) > 0),
  name_en   text NOT NULL CHECK (length(btrim(name_en)) > 0),
  provider  text NOT NULL CHECK (length(btrim(provider)) > 0),
  is_active boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- branch_insurance — which plans a branch accepts.
-- ---------------------------------------------------------------------------
CREATE TABLE branch_insurance (
  branch_id         uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  insurance_plan_id uuid NOT NULL REFERENCES insurance_plans(id) ON DELETE CASCADE,
  PRIMARY KEY (branch_id, insurance_plan_id)
);

-- ---------------------------------------------------------------------------
-- branch_policies — cancellation, rescheduling, no-show, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE branch_policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  policy_type    text NOT NULL CHECK (policy_type IN (
    'cancellation', 'rescheduling', 'no_show', 'late_arrival', 'general'
  )),
  policy_text_ar text NOT NULL CHECK (length(btrim(policy_text_ar)) > 0),
  policy_text_en text NOT NULL CHECK (length(btrim(policy_text_en)) > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_policies_unique_type UNIQUE (branch_id, policy_type)
);

CREATE TRIGGER branch_policies_touch BEFORE UPDATE ON branch_policies
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS on new tables — all scoped through branch_id → facility_id.
-- ---------------------------------------------------------------------------

-- working_hours
ALTER TABLE working_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE working_hours FORCE ROW LEVEL SECURITY;

CREATE POLICY wh_admin_all ON working_hours
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY wh_tenant ON working_hours
  FOR SELECT TO zamo_app
  USING (
    branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

CREATE POLICY wh_tenant_write ON working_hours
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'branch_manager')
    AND branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- branch_insurance
ALTER TABLE branch_insurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_insurance FORCE ROW LEVEL SECURITY;

CREATE POLICY bi_admin_all ON branch_insurance
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY bi_tenant ON branch_insurance
  FOR SELECT TO zamo_app
  USING (
    branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

CREATE POLICY bi_tenant_write ON branch_insurance
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager')
    AND branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- branch_policies
ALTER TABLE branch_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY bp_admin_all ON branch_policies
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY bp_tenant ON branch_policies
  FOR SELECT TO zamo_app
  USING (
    branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

CREATE POLICY bp_tenant_write ON branch_policies
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'branch_manager')
    AND branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- insurance_plans: platform-level, readable by all, writable by admin only.
ALTER TABLE insurance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_plans FORCE ROW LEVEL SECURITY;

CREATE POLICY ip_read_all ON insurance_plans
  FOR SELECT TO zamo_app
  USING (true);

CREATE POLICY ip_admin_write ON insurance_plans
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON working_hours TO zamo_app;
GRANT SELECT, INSERT, UPDATE ON insurance_plans TO zamo_app;
GRANT SELECT, INSERT, DELETE ON branch_insurance TO zamo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON branch_policies TO zamo_app;
