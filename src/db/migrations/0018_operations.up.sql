-- ZAMO-OPS-037..045 :: operations — attendance, service, collection, approval.
--
-- M7 Operations module (ARCHITECTURE.md §4).
--
-- Implements:
--   T11: CONFIRMED → ATTENDED (receptionist records attendance)
--   T12: CONFIRMED → NO_SHOW (receptionist records no-show)
--   T13: ATTENDED → SERVICE_DONE (record actual service performed)
--   T14: SERVICE_DONE → SERVICE_DONE (submit value for approval)
--   T15: SERVICE_DONE → COLLECTED (facility_manager approves value — A-27)
--   T16: SERVICE_DONE → SERVICE_DONE (facility_manager rejects value)
--   A-27: Receptionist CANNOT approve final value.
--   DEC-005: All state changes through State Machine only.
--   DEC-014: NO diagnostic / medical fields — admin_notes only.
--   B-31: arrived_late and rescheduled_on_arrival as flags.
--
-- Depends on: 0017_bookings (bookings, booking_status_history)
--             0011_branch_services (branch_services)
--             0010_practitioners (doctors)
--             0001_core_identity (users, branches, facilities)

-- ---------------------------------------------------------------------------
-- attendance — records when a patient arrives (or doesn't).
-- One record per booking (UNIQUE constraint).
-- ---------------------------------------------------------------------------
CREATE TABLE attendance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,

  -- Attendance outcome
  attendance_status text NOT NULL CHECK (attendance_status IN (
    'ATTENDED', 'NO_SHOW', 'LATE', 'RESCHEDULED_ON_ARRIVAL'
  )),

  -- Timing
  arrival_time      timestamptz,  -- NULL for NO_SHOW
  slot_start        timestamptz NOT NULL,  -- denormalized for query performance

  -- WHO recorded
  recorded_by       uuid NOT NULL REFERENCES users(id),
  recorded_by_name  text NOT NULL,  -- denormalized for Audit display

  -- Scope (for RLS)
  branch_id         uuid NOT NULL REFERENCES branches(id),
  facility_id       uuid NOT NULL REFERENCES facilities(id),

  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX att_branch_time_idx ON attendance (branch_id, slot_start);
CREATE INDEX att_facility_idx ON attendance (facility_id);

CREATE TRIGGER attendance_touch BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- performed_services — the ACTUAL service performed (may differ from booked).
--
-- ❗ This is SEPARATE from booking.branch_service_id (ARCHITECTURE.md §8.2):
--    «PerformedService منفصل عن Booking.service_id — لأن [S1] يميز صراحة
--     الخدمة المحجوزة عن الخدمة الفعلية»
--
-- ❌ NO diagnostic/medical fields (DEC-014).
--    admin_notes is for administrative notes ONLY.
-- ---------------------------------------------------------------------------
CREATE TABLE performed_services (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  attendance_id         uuid NOT NULL REFERENCES attendance(id) ON DELETE RESTRICT,

  -- WHAT was actually performed
  booked_service_id     uuid NOT NULL REFERENCES branch_services(id),  -- original
  actual_service_id     uuid NOT NULL REFERENCES branch_services(id),  -- what happened
  service_matches       boolean NOT NULL GENERATED ALWAYS AS (booked_service_id = actual_service_id) STORED,

  -- WHO actually performed
  booked_doctor_id      uuid NOT NULL REFERENCES doctors(id),  -- original
  actual_doctor_id      uuid NOT NULL REFERENCES doctors(id),  -- who did it

  -- WHEN
  performed_at          timestamptz NOT NULL DEFAULT now(),
  duration_minutes      smallint,  -- actual duration

  -- Administrative notes ONLY — ❌ NO diagnosis, treatment, or medication
  admin_notes           text,

  -- WHO recorded
  recorded_by           uuid NOT NULL REFERENCES users(id),
  recorded_by_role      text NOT NULL,

  -- Scope (for RLS)
  branch_id             uuid NOT NULL REFERENCES branches(id),
  facility_id           uuid NOT NULL REFERENCES facilities(id),

  -- Timestamps
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ps_booking_idx ON performed_services (booking_id);
CREATE INDEX ps_branch_time_idx ON performed_services (branch_id, performed_at);
CREATE INDEX ps_facility_idx ON performed_services (facility_id);

CREATE TRIGGER performed_services_touch BEFORE UPDATE ON performed_services
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- collection_entries — proposed collected amount + payment method.
-- Created by receptionist/doctor, sent to facility_manager for approval.
-- ---------------------------------------------------------------------------
CREATE TABLE collection_entries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id              uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  performed_service_id    uuid NOT NULL REFERENCES performed_services(id) ON DELETE RESTRICT,

  -- Financial data — numeric for precision (ARCHITECTURE.md §8.2)
  proposed_amount         numeric(12,2) NOT NULL CHECK (proposed_amount >= 0),
  payment_method          text NOT NULL CHECK (payment_method IN (
    'cash', 'card', 'insurance', 'mixed'
  )),
  payment_notes           text,  -- e.g. insurance policy number

  -- Approval workflow
  approval_status         text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (approval_status IN (
    'PENDING_APPROVAL', 'APPROVED', 'REJECTED'
  )),

  -- WHO submitted
  submitted_by            uuid NOT NULL REFERENCES users(id),
  submitted_by_role       text NOT NULL,

  -- Scope (for RLS)
  branch_id               uuid NOT NULL REFERENCES branches(id),
  facility_id             uuid NOT NULL REFERENCES facilities(id),

  -- Timestamps
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ce_booking_idx ON collection_entries (booking_id);
CREATE INDEX ce_approval_idx ON collection_entries (approval_status) WHERE approval_status = 'PENDING_APPROVAL';
CREATE INDEX ce_branch_idx ON collection_entries (branch_id);
CREATE INDEX ce_facility_idx ON collection_entries (facility_id);

CREATE TRIGGER collection_entries_touch BEFORE UPDATE ON collection_entries
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- value_approvals — facility_manager's decision on the collected value.
--
-- ❗ A-27: ONLY facility_manager can approve.
--    This is enforced in the application layer (operations-service.ts)
--    and tested with negative tests for receptionist, doctor, branch_manager.
--
-- Each approval/rejection is an immutable record (append-only).
-- A rejected entry may have a new collection_entry submitted after correction.
-- ---------------------------------------------------------------------------
CREATE TABLE value_approvals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id              uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  collection_entry_id     uuid NOT NULL REFERENCES collection_entries(id) ON DELETE RESTRICT,

  -- Decision
  decision                text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  approved_amount         numeric(12,2),  -- final amount (may differ from proposed)
  rejection_reason        text,  -- ❗ mandatory when REJECTED

  -- State snapshot for Audit (before/after)
  before_state            jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- WHO approved — ❗ MUST be facility_manager (A-27)
  approved_by             uuid NOT NULL REFERENCES users(id),
  approved_by_role        text NOT NULL,

  -- Scope (for RLS)
  branch_id               uuid NOT NULL REFERENCES branches(id),
  facility_id             uuid NOT NULL REFERENCES facilities(id),

  -- Timestamps
  created_at              timestamptz NOT NULL DEFAULT now(),

  -- CONSTRAINTS
  -- Rejection requires a reason
  CONSTRAINT va_rejected_needs_reason CHECK (
    decision != 'REJECTED' OR rejection_reason IS NOT NULL
  ),
  -- Approved must have amount
  CONSTRAINT va_approved_needs_amount CHECK (
    decision != 'APPROVED' OR approved_amount IS NOT NULL
  ),
  -- Approved amount must be non-negative
  CONSTRAINT va_approved_amount_valid CHECK (
    approved_amount IS NULL OR approved_amount >= 0
  )
);

CREATE INDEX va_booking_idx ON value_approvals (booking_id);
CREATE INDEX va_collection_idx ON value_approvals (collection_entry_id);
CREATE INDEX va_facility_idx ON value_approvals (facility_id);

-- ---------------------------------------------------------------------------
-- RLS — attendance
-- ---------------------------------------------------------------------------
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance FORCE ROW LEVEL SECURITY;

-- Zamo platform roles — full access
CREATE POLICY att_admin_all ON attendance
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

-- Branch-scoped staff (receptionist, branch_manager)
CREATE POLICY att_branch_staff ON attendance
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('receptionist', 'branch_manager')
    AND branch_id::text = current_setting('zamo.branch_id', true)
  );

-- Facility-scoped roles (facility_manager, doctor, accountant)
CREATE POLICY att_facility_read ON attendance
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'doctor', 'accountant')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- Facility manager can also write (for corrections)
CREATE POLICY att_facility_manager_write ON attendance
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'facility_manager'
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- ---------------------------------------------------------------------------
-- RLS — performed_services
-- ---------------------------------------------------------------------------
ALTER TABLE performed_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE performed_services FORCE ROW LEVEL SECURITY;

CREATE POLICY ps_admin_all ON performed_services
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY ps_branch_staff ON performed_services
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('receptionist', 'branch_manager')
    AND branch_id::text = current_setting('zamo.branch_id', true)
  );

CREATE POLICY ps_facility_read ON performed_services
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'doctor', 'accountant')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

CREATE POLICY ps_facility_manager_write ON performed_services
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'facility_manager'
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- ---------------------------------------------------------------------------
-- RLS — collection_entries
-- ---------------------------------------------------------------------------
ALTER TABLE collection_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY ce_admin_all ON collection_entries
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY ce_branch_staff ON collection_entries
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('receptionist', 'branch_manager')
    AND branch_id::text = current_setting('zamo.branch_id', true)
  );

CREATE POLICY ce_facility_read ON collection_entries
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'accountant')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

CREATE POLICY ce_facility_manager_write ON collection_entries
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'facility_manager'
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- ---------------------------------------------------------------------------
-- RLS — value_approvals
-- ---------------------------------------------------------------------------
ALTER TABLE value_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE value_approvals FORCE ROW LEVEL SECURITY;

CREATE POLICY va_admin_all ON value_approvals
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

-- Only facility_manager can insert approvals (A-27)
CREATE POLICY va_facility_manager ON value_approvals
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'facility_manager'
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- Branch staff and accountant can read (for display)
CREATE POLICY va_read_staff ON value_approvals
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('receptionist', 'branch_manager', 'accountant')
    AND (
      branch_id::text = current_setting('zamo.branch_id', true)
      OR facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON attendance TO zamo_app;
GRANT SELECT, INSERT, UPDATE ON performed_services TO zamo_app;
GRANT SELECT, INSERT, UPDATE ON collection_entries TO zamo_app;
GRANT SELECT, INSERT ON value_approvals TO zamo_app;  -- append-only
