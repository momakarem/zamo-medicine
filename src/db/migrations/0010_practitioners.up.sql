-- ZAMO-DOC-013 :: practitioners — doctors, assignments, schedules, leaves.
--
-- [S2]: "طبيب → منشأة واحدة + فروع + خدمات + جدول"
-- [S1]: "يُضاف بواسطة المنشأة مع رقم الترخيص والتخصص والخدمات والفروع والجدول"
--
-- Depends on: 0009_catalog (specialties table).
--
-- Hard constraint (A-48, A-49, DEC-014): NO diagnostic / medical fields.

-- ---------------------------------------------------------------------------
-- doctors — a doctor belongs to exactly one facility (M3 boundary).
-- ---------------------------------------------------------------------------
CREATE TABLE doctors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  user_id         uuid REFERENCES users(id),  -- nullable until doctor accepts invitation
  specialty_id    uuid NOT NULL REFERENCES specialties(id) ON DELETE RESTRICT,

  -- Bilingual names (D8)
  name_ar         text NOT NULL CHECK (length(btrim(name_ar)) > 0),
  name_en         text NOT NULL CHECK (length(btrim(name_en)) > 0),

  license_number  text NOT NULL,
  bio_ar          text,
  bio_en          text,
  photo_url       text,
  gender          text CHECK (gender IS NULL OR gender IN ('male', 'female')),

  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT doctors_unique_license UNIQUE (license_number)
);

CREATE INDEX doctors_facility_idx ON doctors (facility_id);
CREATE INDEX doctors_specialty_idx ON doctors (specialty_id);

CREATE TRIGGER doctors_touch BEFORE UPDATE ON doctors
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- doctor_branches — which branches a doctor works at.
-- ---------------------------------------------------------------------------
CREATE TABLE doctor_branches (
  doctor_id   uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  is_active   boolean NOT NULL DEFAULT true,
  PRIMARY KEY (doctor_id, branch_id)
);

-- ---------------------------------------------------------------------------
-- doctor_schedules — weekly recurring schedule per branch.
-- ---------------------------------------------------------------------------
CREATE TABLE doctor_schedules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id             uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  branch_id             uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  day_of_week           smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time            time NOT NULL,
  end_time              time NOT NULL,
  slot_duration_minutes smallint NOT NULL DEFAULT 30 CHECK (slot_duration_minutes > 0),
  is_active             boolean NOT NULL DEFAULT true,

  CONSTRAINT ds_valid_range CHECK (start_time < end_time),
  CONSTRAINT ds_unique UNIQUE (doctor_id, branch_id, day_of_week)
);

-- ---------------------------------------------------------------------------
-- doctor_leaves — absence periods.
-- ---------------------------------------------------------------------------
CREATE TABLE doctor_leaves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id   uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT leave_valid_range CHECK (start_date <= end_date)
);

-- ---------------------------------------------------------------------------
-- RLS — doctors are scoped to their facility.
-- ---------------------------------------------------------------------------
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors FORCE ROW LEVEL SECURITY;

CREATE POLICY doc_admin_all ON doctors
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY doc_tenant_read ON doctors
  FOR SELECT TO zamo_app
  USING (facility_id::text = current_setting('zamo.facility_id', true));

CREATE POLICY doc_tenant_write ON doctors
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'branch_manager')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- doctor_branches
ALTER TABLE doctor_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_branches FORCE ROW LEVEL SECURITY;

CREATE POLICY db_admin_all ON doctor_branches
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY db_tenant ON doctor_branches
  FOR SELECT TO zamo_app
  USING (
    branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

CREATE POLICY db_tenant_write ON doctor_branches
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'branch_manager')
    AND branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- doctor_schedules
ALTER TABLE doctor_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY dsch_admin_all ON doctor_schedules
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY dsch_tenant ON doctor_schedules
  FOR SELECT TO zamo_app
  USING (
    branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

CREATE POLICY dsch_tenant_write ON doctor_schedules
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'branch_manager')
    AND branch_id IN (
      SELECT id FROM branches
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- doctor_leaves
ALTER TABLE doctor_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_leaves FORCE ROW LEVEL SECURITY;

CREATE POLICY dl_admin_all ON doctor_leaves
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY dl_tenant ON doctor_leaves
  FOR SELECT TO zamo_app
  USING (
    doctor_id IN (
      SELECT id FROM doctors
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

CREATE POLICY dl_tenant_write ON doctor_leaves
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'branch_manager')
    AND doctor_id IN (
      SELECT id FROM doctors
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- Grants
GRANT SELECT, INSERT, UPDATE ON doctors TO zamo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON doctor_branches TO zamo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON doctor_schedules TO zamo_app;
GRANT SELECT, INSERT, DELETE ON doctor_leaves TO zamo_app;
