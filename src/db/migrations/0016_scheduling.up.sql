-- ZAMO-SCHED-027 / ZAMO-SCHED-028 :: scheduling — slot holds & branch holidays.
--
-- [S1]: "منع التضارب في التقويم" (A-20)
-- [S2]: "الإلغاء وإعادة الجدولة متاحان" (A-16)
--
-- B-30: Soft Reserve 30 minutes then auto-release.
-- B-28: Holidays are treated as closed days (SLA doesn't run).
--
-- Depends on: 0010_practitioners (doctors, doctor_schedules, doctor_leaves)
--             0008_branch_management (working_hours)
--
-- Hard constraint (A-48, A-49, DEC-014): NO diagnostic / medical fields.

-- ---------------------------------------------------------------------------
-- Enable btree_gist — required for EXCLUDE constraints combining uuid = and
-- tstzrange && operators. PGlite (WASM) does not support this extension,
-- so the CREATE is wrapped in a DO block with exception handling.
-- On real PostgreSQL (staging/production), the EXCLUDE constraint provides
-- the database-level guarantee. In PGlite tests, conflict prevention is
-- verified through the application layer (slot-hold.ts).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'btree_gist not available (PGlite?) — EXCLUDE constraint will be skipped';
END
$$;

-- ---------------------------------------------------------------------------
-- branch_holidays — official holidays per branch (B-28: treated as closed days).
-- Managed from Zamo admin panel.
-- ---------------------------------------------------------------------------
CREATE TABLE branch_holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name_ar     text NOT NULL CHECK (length(btrim(name_ar)) > 0),
  name_en     text NOT NULL CHECK (length(btrim(name_en)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT branch_holidays_unique UNIQUE (branch_id, holiday_date)
);

CREATE INDEX branch_holidays_branch_date_idx ON branch_holidays (branch_id, holiday_date);

-- ---------------------------------------------------------------------------
-- slot_holds — soft reservation for a time slot (B-30).
--
-- A slot hold reserves a doctor's time for 30 minutes while the booking
-- request is being processed. After 30 minutes without confirmation,
-- the hold is automatically released.
--
-- The EXCLUDE constraint (when btree_gist is available) guarantees at
-- the DB level that no two active holds can overlap for the same doctor.
-- ---------------------------------------------------------------------------
CREATE TABLE slot_holds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id    uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  slot_start   timestamptz NOT NULL,
  slot_end     timestamptz NOT NULL,
  held_by      uuid REFERENCES users(id),   -- patient user_id (nullable for guest flow per A-34)
  expires_at   timestamptz NOT NULL,         -- created_at + 30 min (B-30)
  released     boolean NOT NULL DEFAULT false,
  released_at  timestamptz,
  booking_id   uuid,                         -- set when the hold is converted to a booking
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT slot_holds_valid_range CHECK (slot_start < slot_end),
  CONSTRAINT slot_holds_valid_expiry CHECK (expires_at > created_at)
);

-- ❗ CORE CONSTRAINT (A-20): No overlapping active holds for the same doctor.
-- Uses btree_gist EXCLUDE constraint. Wrapped in DO block because PGlite
-- doesn't support btree_gist. On real PostgreSQL this constraint is enforced.
DO $$
BEGIN
  ALTER TABLE slot_holds ADD CONSTRAINT slot_holds_no_overlap
    EXCLUDE USING gist (
      doctor_id WITH =,
      tstzrange(slot_start, slot_end) WITH &&
    ) WHERE (released = false);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'EXCLUDE constraint skipped (btree_gist not available)';
END
$$;
-- Query pattern: find active holds for a doctor in a date range
CREATE INDEX slot_holds_doctor_time_idx ON slot_holds (doctor_id, slot_start, slot_end)
  WHERE (released = false);

-- Cron pattern: find expired holds to release
CREATE INDEX slot_holds_expiry_idx ON slot_holds (expires_at)
  WHERE (released = false);

-- Lookup by booking
CREATE INDEX slot_holds_booking_idx ON slot_holds (booking_id)
  WHERE (booking_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- RLS — slot_holds
--
-- Patients: can see their own holds only.
-- Facility staff: can see holds for their facility's doctors.
-- Zamo admin: all.
-- ---------------------------------------------------------------------------
ALTER TABLE slot_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_holds FORCE ROW LEVEL SECURITY;

CREATE POLICY sh_admin_all ON slot_holds
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

-- Patient sees their own holds
CREATE POLICY sh_patient_read ON slot_holds
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'patient'
    AND held_by::text = current_setting('zamo.user_id', true)
  );

-- Facility staff see holds for their facility's doctors
CREATE POLICY sh_tenant_read ON slot_holds
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN (
      'facility_manager', 'branch_manager', 'receptionist', 'doctor'
    )
    AND doctor_id IN (
      SELECT id FROM doctors
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- Staff can create/update holds for their facility
CREATE POLICY sh_tenant_write ON slot_holds
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN (
      'facility_manager', 'branch_manager', 'receptionist'
    )
    AND doctor_id IN (
      SELECT id FROM doctors
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- Patients can create holds (for booking flow)
CREATE POLICY sh_patient_write ON slot_holds
  FOR INSERT TO zamo_app
  WITH CHECK (
    current_setting('zamo.role_code', true) = 'patient'
    AND held_by::text = current_setting('zamo.user_id', true)
  );

-- ---------------------------------------------------------------------------
-- RLS — branch_holidays
-- ---------------------------------------------------------------------------
ALTER TABLE branch_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_holidays FORCE ROW LEVEL SECURITY;

-- Readable by everyone (public info for slot generation)
CREATE POLICY bh_read_all ON branch_holidays
  FOR SELECT TO zamo_app
  USING (true);

-- Only Zamo admin can manage holidays (B-28: managed from Zamo admin panel)
CREATE POLICY bh_admin_write ON branch_holidays
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON slot_holds TO zamo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON branch_holidays TO zamo_app;
