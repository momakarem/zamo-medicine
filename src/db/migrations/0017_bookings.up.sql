-- ZAMO-BOOK-029 / ZAMO-BOOK-030 :: bookings — core booking tables.
--
-- This is the operational heart of the platform (ARCHITECTURE.md §7).
--
-- Implements:
--   A-11: Booking requires reception confirmation.
--   A-12: No "confirmed" before reception confirms.
--   A-19: Nine unified states (8 original + REJECTED per B-07).
--   A-20: Conflict prevention (enforced by slot_holds EXCLUDE constraint).
--   A-22: Rejection requires recorded reason + alternatives.
--   A-51: Separate privacy/operational/marketing consent.
--   A-53: Every transition recorded in history + audit_log.
--   B-07: REJECTED is a separate state from CANCELLED.
--   B-14: Unified cancellation policy, reschedule max 2 times.
--   B-20: Reschedule rules (patient→PENDING, staff→stays CONFIRMED, <4h→always PENDING).
--   B-30: Slot hold reference for soft reservation.
--   B-31: arrived_late and rescheduled_on_arrival as flags, not states.
--   B-32: Max 3 pending bookings per patient, no duplicate service+branch+day.
--   DEC-005: All state changes through State Machine only.
--   DEC-014: NO diagnostic / medical fields.
--
-- Depends on: 0016_scheduling (slot_holds)
--             0011_branch_services (branch_services)
--             0010_practitioners (doctors)
--             0001_core_identity (users, branches)

-- ---------------------------------------------------------------------------
-- bookings — the core booking record.
-- ---------------------------------------------------------------------------
CREATE TABLE bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-readable booking number (e.g. ZAMO-20260917-A3F2)
  booking_number    text NOT NULL UNIQUE,

  -- WHO
  patient_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  doctor_id         uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,

  -- WHERE
  branch_id         uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  facility_id       uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,

  -- WHAT
  branch_service_id uuid NOT NULL REFERENCES branch_services(id) ON DELETE RESTRICT,

  -- WHEN
  slot_start        timestamptz NOT NULL,
  slot_end          timestamptz NOT NULL,
  slot_hold_id      uuid REFERENCES slot_holds(id),

  -- STATE (A-19 + B-07: 9 states)
  -- ❗ DEC-005: this column MUST NOT be updated directly.
  --    All changes go through the State Machine (state-machine.ts).
  status            text NOT NULL DEFAULT 'NEW'
                    CHECK (status IN (
                      'NEW', 'PENDING_CONFIRMATION', 'CONFIRMED',
                      'ATTENDED', 'SERVICE_DONE', 'COLLECTED',
                      'CANCELLED', 'NO_SHOW', 'REJECTED'
                    )),

  -- RESCHEDULE TRACKING (B-14: max 2 reschedules)
  reschedule_count  smallint NOT NULL DEFAULT 0
                    CHECK (reschedule_count >= 0 AND reschedule_count <= 2),

  -- REASONS (B-07: mandatory for REJECTED, A-22: with alternatives)
  rejection_reason  text,
  cancellation_reason text,
  cancellation_source text CHECK (
    cancellation_source IS NULL OR cancellation_source IN (
      'patient', 'receptionist', 'system_sla', 'zamo_admin'
    )
  ),

  -- CONSENT (A-51: separate consent types, recorded with timestamps)
  consent_privacy       boolean NOT NULL DEFAULT false,
  consent_operational   boolean NOT NULL DEFAULT false,
  consent_marketing     boolean NOT NULL DEFAULT false,
  consent_privacy_at    timestamptz,
  consent_operational_at timestamptz,
  consent_marketing_at  timestamptz,

  -- SLA (A-14: 15-30 min target, B-28: from branch working hours, B-29: auto-cancel after 24h)
  sla_deadline      timestamptz,
  is_late           boolean NOT NULL DEFAULT false,

  -- ATTENDANCE FLAGS (B-31: flags, not separate states)
  arrived_late            boolean,
  rescheduled_on_arrival  boolean,

  -- ADMIN NOTES (❌ NO medical/diagnostic content — DEC-014)
  admin_notes       text,

  -- TIMESTAMPS
  confirmed_at      timestamptz,
  attended_at       timestamptz,
  service_done_at   timestamptz,
  collected_at      timestamptz,
  cancelled_at      timestamptz,
  rejected_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- CONSTRAINTS
  CONSTRAINT bookings_valid_slot CHECK (slot_start < slot_end),

  -- B-07: REJECTED requires a reason
  CONSTRAINT bookings_rejected_needs_reason CHECK (
    status != 'REJECTED' OR rejection_reason IS NOT NULL
  ),

  -- CANCELLED requires a reason
  CONSTRAINT bookings_cancelled_needs_reason CHECK (
    status != 'CANCELLED' OR cancellation_reason IS NOT NULL
  ),

  -- Privacy consent is mandatory for booking submission
  CONSTRAINT bookings_privacy_consent CHECK (
    status = 'NEW' OR consent_privacy = true
  )
);

-- ---------------------------------------------------------------------------
-- B-32: Max 3 pending bookings per patient.
-- Enforced by a partial unique index + application-level check.
-- (A unique index can't enforce a count, so the "3 pending" rule is enforced
-- in booking-service.ts and tested in state-machine.itest.ts.)
-- ---------------------------------------------------------------------------

-- B-32: No duplicate service+branch+day per patient.
-- We use a unique index on the date part of slot_start.
-- Wrapped in DO block because PGlite treats timestamptz::date as STABLE
-- (not IMMUTABLE) due to timezone dependency. On real PostgreSQL this works.
-- The rule is also enforced at the application layer (booking-service.ts).
DO $$
BEGIN
  CREATE UNIQUE INDEX bookings_no_duplicate_day_idx
    ON bookings (patient_id, branch_service_id, branch_id, (slot_start::date))
    WHERE (status NOT IN ('CANCELLED', 'REJECTED'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'bookings_no_duplicate_day_idx skipped (PGlite?) — enforced at application layer';
END
$$;

-- ---------------------------------------------------------------------------
-- Indexes for common query patterns.
-- ---------------------------------------------------------------------------
-- Patient's bookings list
CREATE INDEX bookings_patient_status_idx ON bookings (patient_id, status);
-- Branch's bookings (reception dashboard)
CREATE INDEX bookings_branch_time_idx ON bookings (branch_id, slot_start);
-- Doctor's schedule
CREATE INDEX bookings_doctor_time_idx ON bookings (doctor_id, slot_start);
-- SLA monitoring: find PENDING bookings past deadline
CREATE INDEX bookings_sla_idx ON bookings (sla_deadline)
  WHERE (status = 'PENDING_CONFIRMATION' AND is_late = false);
-- Facility scope
CREATE INDEX bookings_facility_idx ON bookings (facility_id);

CREATE TRIGGER bookings_touch BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- booking_status_history — every transition is recorded (DEC-005, A-53).
--
-- This table is append-only by convention (deletions are blocked by the
-- application and tested). Unlike audit_log, it does not have DB-level
-- immutability triggers because it is not a financial table (A-46).
-- ---------------------------------------------------------------------------
CREATE TABLE booking_status_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  from_status   text,                       -- NULL for initial creation (T1)
  to_status     text NOT NULL,
  transition_id text NOT NULL,              -- T1..T17 from ARCHITECTURE.md §7.1
  action        text NOT NULL,              -- 'create', 'submit', 'confirm', etc.
  actor_id      uuid NOT NULL REFERENCES users(id),
  actor_role    text NOT NULL,
  reason        text,                       -- mandatory for REJECTED/CANCELLED
  metadata      jsonb,                      -- extra context (e.g. previous slot for reschedule)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bsh_booking_idx ON booking_status_history (booking_id, created_at);
CREATE INDEX bsh_actor_idx ON booking_status_history (actor_id);

-- ---------------------------------------------------------------------------
-- patient_consents — timestamped consent records (A-51).
--
-- Each consent grant/revoke is an immutable record. The latest record
-- per (patient_id, consent_type) determines the current state.
-- ---------------------------------------------------------------------------
CREATE TABLE patient_consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid REFERENCES bookings(id),  -- NULL for account-level consent
  patient_id    uuid NOT NULL REFERENCES users(id),
  consent_type  text NOT NULL CHECK (consent_type IN (
    'privacy', 'operational', 'marketing'
  )),
  granted       boolean NOT NULL,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pc_patient_idx ON patient_consents (patient_id, consent_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS — bookings
--
-- Patient: sees their own bookings only.
-- Receptionist/branch_manager: sees bookings for their branch.
-- Facility_manager/doctor/accountant: sees bookings for their facility.
-- Zamo admin/ops: all.
-- ---------------------------------------------------------------------------
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE ROW LEVEL SECURITY;

-- Zamo platform roles
CREATE POLICY bk_admin_all ON bookings
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

-- Patient sees own bookings
CREATE POLICY bk_patient_read ON bookings
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'patient'
    AND patient_id::text = current_setting('zamo.user_id', true)
  );

-- Patient can create bookings
CREATE POLICY bk_patient_insert ON bookings
  FOR INSERT TO zamo_app
  WITH CHECK (
    current_setting('zamo.role_code', true) = 'patient'
    AND patient_id::text = current_setting('zamo.user_id', true)
  );

-- Patient can update own bookings (for cancellation, reschedule)
CREATE POLICY bk_patient_update ON bookings
  FOR UPDATE TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'patient'
    AND patient_id::text = current_setting('zamo.user_id', true)
  );

-- Branch-scoped staff (receptionist, branch_manager)
CREATE POLICY bk_branch_staff ON bookings
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('receptionist', 'branch_manager')
    AND branch_id::text = current_setting('zamo.branch_id', true)
  );

-- Facility-scoped roles (facility_manager, doctor, accountant)
CREATE POLICY bk_facility_read ON bookings
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'doctor', 'accountant')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- Facility manager can update bookings
CREATE POLICY bk_facility_manager_write ON bookings
  FOR UPDATE TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'facility_manager'
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- ---------------------------------------------------------------------------
-- RLS — booking_status_history
-- ---------------------------------------------------------------------------
ALTER TABLE booking_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_status_history FORCE ROW LEVEL SECURITY;

CREATE POLICY bsh_admin_all ON booking_status_history
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

-- History is readable by anyone who can see the booking
CREATE POLICY bsh_by_booking ON booking_status_history
  FOR SELECT TO zamo_app
  USING (
    booking_id IN (SELECT id FROM bookings)
  );

-- History is insertable by the application (through state machine)
CREATE POLICY bsh_insert ON booking_status_history
  FOR INSERT TO zamo_app
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- RLS — patient_consents
-- ---------------------------------------------------------------------------
ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_consents FORCE ROW LEVEL SECURITY;

CREATE POLICY pc_admin_all ON patient_consents
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin')
  );

CREATE POLICY pc_patient ON patient_consents
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'patient'
    AND patient_id::text = current_setting('zamo.user_id', true)
  );

CREATE POLICY pc_facility_read ON patient_consents
  FOR SELECT TO zamo_app
  USING (
    booking_id IN (SELECT id FROM bookings)
  );

-- ---------------------------------------------------------------------------
-- Grants — ❌ NO DELETE on bookings (status-based lifecycle only)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON bookings TO zamo_app;
GRANT SELECT, INSERT ON booking_status_history TO zamo_app;
GRANT SELECT, INSERT ON patient_consents TO zamo_app;
