-- ZAMO-CAT-015 :: branch services & doctor-service assignments.
--
-- [S1]: "ربط خدمة بفرع وطبيب + مدة + سعر"
-- Links the platform-level service catalog (0009) to specific branches and doctors.
--
-- Hard constraint (A-48, A-49, DEC-014): NO diagnostic / medical fields.

-- ---------------------------------------------------------------------------
-- branch_services — a facility's branch offers a subset of the catalog.
-- ---------------------------------------------------------------------------
CREATE TABLE branch_services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  service_id       uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  duration_minutes smallint NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_service_unique UNIQUE (branch_id, service_id)
);

CREATE INDEX branch_services_branch_idx ON branch_services (branch_id);

CREATE TRIGGER branch_services_touch BEFORE UPDATE ON branch_services
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- doctor_services — which doctors can perform which branch services.
-- ---------------------------------------------------------------------------
CREATE TABLE doctor_services (
  doctor_id         uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  branch_service_id uuid NOT NULL REFERENCES branch_services(id) ON DELETE CASCADE,
  is_active         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (doctor_id, branch_service_id)
);

-- ---------------------------------------------------------------------------
-- RLS — scoped through branch_id → facility_id.
-- ---------------------------------------------------------------------------
ALTER TABLE branch_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_services FORCE ROW LEVEL SECURITY;

CREATE POLICY bs_admin_all ON branch_services
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY bs_tenant_read ON branch_services
  FOR SELECT TO zamo_app
  USING (
    branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

CREATE POLICY bs_tenant_write ON branch_services
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'branch_manager')
    AND branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- doctor_services
ALTER TABLE doctor_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_services FORCE ROW LEVEL SECURITY;

CREATE POLICY dsvc_admin_all ON doctor_services
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY dsvc_tenant_read ON doctor_services
  FOR SELECT TO zamo_app
  USING (
    branch_service_id IN (
      SELECT bs.id FROM branch_services bs
      JOIN branches b ON bs.branch_id = b.id
      WHERE b.facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

CREATE POLICY dsvc_tenant_write ON doctor_services
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'branch_manager')
    AND branch_service_id IN (
      SELECT bs.id FROM branch_services bs
      JOIN branches b ON bs.branch_id = b.id
      WHERE b.facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON branch_services TO zamo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON doctor_services TO zamo_app;
