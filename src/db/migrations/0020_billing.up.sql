-- ZAMO-BILL-062..070 :: billing — commission rules, entries, settlements,
-- invoices, payments, disputes, and patient objections.
--
-- M8 Billing module (Phase 8 — المال).
--
-- Implements:
--   A-06:  Default commission 10%, adjustable.
--   A-07:  Commission on executed+collected service only.
--   A-08:  Monthly commission invoice.
--   A-35:  Priority: service → facility → platform.
--   A-46:  Indelible record for financial changes.
--   B-11:  VAT 15% on top of commission.
--   B-12:  Accrual at manager approval. Per-payment. Partial collection.
--   B-13:  Commission on actual collected (actual service, not booked).
--   B-14:  NO_SHOW = no commission.
--   B-15:  Close last day of month. Invoice within 5 days. Pay in 30. Object in 7.
--   B-16:  Digital confirmation as minimum proof. 5-year retention.
--   B-24:  SAR. Ceiling to nearest 0.01.
--   B-25:  Commission on collected offer price (not original).
--   B-26:  Manual bank transfer + proof + Zamo confirmation.
--   B-27:  Fixed amount nullable, MVP-disabled.
--   B-39:  Accountant reviews only. Manager approves.
--   DEC-007: Commission stored as snapshot.
--   DEC-008: Rule active at accrual date applies.
--   DEC-019: All scheduled tasks idempotent.
--
-- Depends on: 0018_operations (value_approvals, collection_entries)
--             0017_bookings (bookings)
--             0011_branch_services (branch_services)
--             0001_core_identity (users, facilities, branches)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. commission_rules — قواعد العمولة (ZAMO-BILL-062)
--
-- Three scopes (A-35):
--   'platform'  — Zamo-wide default (A-06: 10%)
--   'facility'  — per-facility override
--   'service'   — per-branch_service override (highest priority)
--
-- Append-only by design: changing a rule = closing the old one (effective_to)
-- and inserting a new one. No UPDATE on rate/amount columns.
--
-- ❗ Only zamo_admin may write (CM-14). Enforced by RLS + service layer.
-- ❗ Every change requires a reason (A-46, CM-15).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE commission_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope
  scope_type      text NOT NULL CHECK (scope_type IN ('platform', 'facility', 'service')),
  facility_id     uuid REFERENCES facilities(id) ON DELETE RESTRICT,
  service_id      uuid REFERENCES branch_services(id) ON DELETE RESTRICT,

  -- Rate (0.10 = 10%)
  rate            numeric(5,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),

  -- Fixed amount — nullable, MVP-disabled (B-27)
  fixed_amount    numeric(12,2),

  -- Validity window — effective_to = NULL means currently active
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,

  -- WHY and WHO changed it (A-46, CM-15)
  reason          text NOT NULL,
  changed_by      uuid NOT NULL REFERENCES users(id),

  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- CONSTRAINTS
  -- facility scope requires facility_id
  CONSTRAINT cr_facility_scope CHECK (
    scope_type != 'facility' OR facility_id IS NOT NULL
  ),
  -- service scope requires service_id
  CONSTRAINT cr_service_scope CHECK (
    scope_type != 'service' OR service_id IS NOT NULL
  ),
  -- platform scope must NOT have facility/service
  CONSTRAINT cr_platform_scope CHECK (
    scope_type != 'platform' OR (facility_id IS NULL AND service_id IS NULL)
  ),
  -- end must be after start
  CONSTRAINT cr_dates_valid CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

-- Active rule lookup by scope
CREATE INDEX cr_platform_active_idx ON commission_rules (scope_type, effective_from DESC)
  WHERE scope_type = 'platform' AND effective_to IS NULL;

CREATE INDEX cr_facility_active_idx ON commission_rules (facility_id, effective_from DESC)
  WHERE scope_type = 'facility' AND effective_to IS NULL;

CREATE INDEX cr_service_active_idx ON commission_rules (service_id, effective_from DESC)
  WHERE scope_type = 'service' AND effective_to IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. commission_entries — بنود العمولة المحتسبة (ZAMO-BILL-064)
--
-- Created when value_approvals.decision = 'APPROVED' (B-12).
-- Snapshot pattern (DEC-007): stores the rate/amounts at computation time.
-- IMMUTABLE — no UPDATE. Corrections are done via reversal entries.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE commission_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links
  booking_id          uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  value_approval_id   uuid NOT NULL REFERENCES value_approvals(id) ON DELETE RESTRICT,
  facility_id         uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,

  -- Snapshot of the rule applied (DEC-007)
  rule_id             uuid NOT NULL REFERENCES commission_rules(id) ON DELETE RESTRICT,
  rule_scope          text NOT NULL,   -- 'platform'/'facility'/'service'
  applied_rate        numeric(5,4) NOT NULL,

  -- Financial amounts
  collected_amount    numeric(12,2) NOT NULL CHECK (collected_amount >= 0),
  commission_amount   numeric(12,2) NOT NULL,  -- can be negative for reversals
  vat_rate            numeric(5,4) NOT NULL DEFAULT 0.1500,  -- B-11: 15%
  vat_amount          numeric(12,2) NOT NULL,
  total_with_vat      numeric(12,2) NOT NULL,
  currency            text NOT NULL DEFAULT 'SAR',  -- B-24

  -- Timing
  accrued_at          timestamptz NOT NULL DEFAULT now(),  -- B-12: moment of approval

  -- Settlement linkage (filled when settlement closes)
  billing_period_id   uuid,  -- FK added after billing_periods table
  settlement_period   text,  -- e.g. '2026-09'

  -- Reversal tracking
  is_reversal         boolean NOT NULL DEFAULT false,
  reverses_entry_id   uuid REFERENCES commission_entries(id),

  -- Timestamps
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX comm_entry_booking_idx ON commission_entries (booking_id);
CREATE INDEX comm_entry_facility_idx ON commission_entries (facility_id);
CREATE INDEX comm_entry_period_idx ON commission_entries (settlement_period, facility_id);
CREATE INDEX comm_entry_unsettled_idx ON commission_entries (facility_id, accrued_at)
  WHERE billing_period_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. billing_periods — فترات الإقفال (ZAMO-BILL-065)
--
-- B-15: Close at last day of calendar month (23:59 Asia/Riyadh).
-- DEC-019: Idempotent — closing twice does not duplicate.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE billing_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key      text NOT NULL,       -- '2026-09'
  facility_id     uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,

  -- Status
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  closed_at       timestamptz,
  closed_by       uuid REFERENCES users(id),

  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- One period per facility per month
  CONSTRAINT bp_unique_facility_period UNIQUE (period_key, facility_id)
);

CREATE INDEX bp_facility_idx ON billing_periods (facility_id, period_key DESC);

-- Now add the FK from commission_entries
ALTER TABLE commission_entries
  ADD CONSTRAINT ce_billing_period_fk
  FOREIGN KEY (billing_period_id) REFERENCES billing_periods(id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. invoices — الفواتير (ZAMO-BILL-066)
--
-- B-11: VAT 15% on top of commission.
-- B-15: Issued within 5 business days of close. Due in 30 days.
-- [S1]: 9 fields — period, service_count, total_collected, commission,
--       VAT, due_date, status, download, objection.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-readable number (e.g. ZAMO-INV-202609-001)
  invoice_number      text NOT NULL UNIQUE,

  -- Links
  billing_period_id   uuid NOT NULL REFERENCES billing_periods(id) ON DELETE RESTRICT,
  facility_id         uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,

  -- Aggregates ([S1] fields)
  service_count       int NOT NULL DEFAULT 0,
  total_collected     numeric(12,2) NOT NULL DEFAULT 0,
  total_commission    numeric(12,2) NOT NULL DEFAULT 0,
  total_vat           numeric(12,2) NOT NULL DEFAULT 0,
  grand_total         numeric(12,2) NOT NULL DEFAULT 0,  -- commission + VAT

  -- Zamo tax registration (B-11)
  zamo_tax_number     text,

  -- Dates (B-15)
  issued_at           timestamptz,
  due_date            date,             -- issued_at + 30 days
  objection_deadline  date,             -- issued_at + 7 business days

  -- Status lifecycle
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'OBJECTED')
  ),

  -- Currency (B-24)
  currency            text NOT NULL DEFAULT 'SAR',

  -- Timestamps
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inv_facility_idx ON invoices (facility_id, status);
CREATE INDEX inv_period_idx ON invoices (billing_period_id);
CREATE INDEX inv_status_idx ON invoices (status) WHERE status IN ('ISSUED', 'OVERDUE');

CREATE TRIGGER invoices_touch BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. invoice_line_items — بنود الفاتورة
--
-- Each line traces back to a booking + service + approved value [S2].
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE invoice_line_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  commission_entry_id   uuid NOT NULL REFERENCES commission_entries(id) ON DELETE RESTRICT,
  booking_id            uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,

  -- Denormalized for traceability and PDF generation
  service_name_ar       text NOT NULL,
  service_name_en       text,
  collected_amount      numeric(12,2) NOT NULL,
  commission_rate       numeric(5,4) NOT NULL,
  commission_amount     numeric(12,2) NOT NULL,
  vat_amount            numeric(12,2) NOT NULL,
  line_total            numeric(12,2) NOT NULL,

  -- Timestamps
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ili_invoice_idx ON invoice_line_items (invoice_id);
CREATE INDEX ili_booking_idx ON invoice_line_items (booking_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. payments — السداد (ZAMO-BILL-067)
--
-- B-26: Manual bank transfer + proof upload + Zamo confirmation.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  facility_id       uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,

  -- Amount
  amount            numeric(12,2) NOT NULL CHECK (amount > 0),
  currency          text NOT NULL DEFAULT 'SAR',

  -- Payment details (B-26)
  payment_method    text NOT NULL DEFAULT 'bank_transfer' CHECK (
    payment_method IN ('bank_transfer')  -- MVP: only bank transfer
  ),
  reference_number  text,       -- bank transfer reference
  proof_url         text,       -- uploaded receipt image/PDF

  -- Confirmation workflow
  status            text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'CONFIRMED', 'REJECTED')
  ),
  confirmed_by      uuid REFERENCES users(id),
  confirmed_at      timestamptz,
  rejection_reason  text,

  -- WHO submitted
  submitted_by      uuid NOT NULL REFERENCES users(id),

  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Rejection requires reason
  CONSTRAINT pay_rejection_reason CHECK (
    status != 'REJECTED' OR rejection_reason IS NOT NULL
  )
);

CREATE INDEX pay_invoice_idx ON payments (invoice_id);
CREATE INDEX pay_facility_idx ON payments (facility_id);
CREATE INDEX pay_status_idx ON payments (status) WHERE status = 'PENDING';

CREATE TRIGGER payments_touch BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. disputes — النزاعات (ZAMO-DISP-068)
--
-- 7 types from [S1]: patient_no_show, service_not_performed,
-- incorrect_value, patient_source_disputed, incorrect_commission,
-- booking_complaint, advertising_complaint.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE disputes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-readable number
  dispute_number  text NOT NULL UNIQUE,

  -- Type (7 types from [S1])
  dispute_type    text NOT NULL CHECK (dispute_type IN (
    'patient_no_show',
    'service_not_performed',
    'incorrect_value',
    'patient_source_disputed',
    'incorrect_commission',
    'booking_complaint',
    'advertising_complaint'
  )),

  -- Links (optional — not all disputes relate to a booking/invoice)
  booking_id      uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  invoice_id      uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  facility_id     uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,

  -- Parties
  raised_by       uuid NOT NULL REFERENCES users(id),
  raised_by_role  text NOT NULL,
  assigned_to     uuid REFERENCES users(id),

  -- Content
  description     text NOT NULL,

  -- Status
  status          text NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED')
  ),

  -- Resolution
  resolution            text,
  financial_impact      numeric(12,2),  -- commission adjustment if resolved
  commission_entry_id   uuid REFERENCES commission_entries(id),  -- reversal entry

  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);

CREATE INDEX disp_facility_idx ON disputes (facility_id);
CREATE INDEX disp_booking_idx ON disputes (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX disp_status_idx ON disputes (status) WHERE status IN ('OPEN', 'UNDER_REVIEW');

CREATE TRIGGER disputes_touch BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. dispute_evidence — أدلة النزاع
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE dispute_evidence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  file_url    text NOT NULL,
  file_type   text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX de_dispute_idx ON dispute_evidence (dispute_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. patient_objections — اعتراض المريض على الزيارة (ZAMO-DISP-069)
--
-- [S1] §14.3: 4 types. Escalated to Zamo management.
-- Accepted objection reverses commission impact.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE patient_objections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  patient_id            uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Type (4 types from [S1] §14.3)
  objection_type        text NOT NULL CHECK (objection_type IN (
    'did_not_attend',
    'did_not_receive_service',
    'different_service',
    'incorrect_value'
  )),

  description           text,

  -- Status — escalated to Zamo management
  status                text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED')
  ),

  -- Resolution
  reviewed_by           uuid REFERENCES users(id),
  resolution            text,
  commission_reversed   boolean NOT NULL DEFAULT false,
  reversal_entry_id     uuid REFERENCES commission_entries(id),

  -- Timestamps
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX po_booking_idx ON patient_objections (booking_id);
CREATE INDEX po_patient_idx ON patient_objections (patient_id);
CREATE INDEX po_status_idx ON patient_objections (status) WHERE status IN ('PENDING', 'UNDER_REVIEW');

CREATE TRIGGER patient_objections_touch BEFORE UPDATE ON patient_objections
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Financial Audit Protection (ZAMO-BILL-070)
--
-- A-46: Financial audit entries are immutable — no UPDATE or DELETE.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION deny_financial_audit_modification() RETURNS trigger AS $$
BEGIN
  IF OLD.is_financial = true THEN
    RAISE EXCEPTION 'Financial audit entries are immutable (A-46). Cannot modify or delete.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deny_update_financial_audit
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION deny_financial_audit_modification();

CREATE TRIGGER deny_delete_financial_audit
  BEFORE DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION deny_financial_audit_modification();

-- ═══════════════════════════════════════════════════════════════════════════
-- Default platform commission rule (A-06: 10%)
-- ═══════════════════════════════════════════════════════════════════════════

-- We use a DO block so we can reference the system user.
-- In a real environment, changed_by would be a known admin user.
-- For migration purposes we insert with a placeholder that will be
-- updated during seeding. The '00000000-...' UUID is reserved for system.
DO $$
DECLARE
  sys_user uuid;
BEGIN
  SELECT id INTO sys_user FROM users WHERE phone = 'SYSTEM' LIMIT 1;
  IF sys_user IS NULL THEN
    -- Fallback: use any zamo_admin
    SELECT u.id INTO sys_user FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role_code = 'zamo_admin'
      LIMIT 1;
  END IF;
  IF sys_user IS NULL THEN
    -- Last fallback: first user
    SELECT id INTO sys_user FROM users LIMIT 1;
  END IF;

  IF sys_user IS NOT NULL THEN
    INSERT INTO commission_rules (
      scope_type, facility_id, service_id,
      rate, fixed_amount,
      effective_from, effective_to,
      reason, changed_by
    ) VALUES (
      'platform', NULL, NULL,
      0.1000, NULL,
      '2026-01-01T00:00:00+03:00', NULL,
      'Default platform commission rate (A-06: 10%)',
      sys_user
    );
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- commission_rules — only zamo_admin writes, facility staff reads their own
-- ---------------------------------------------------------------------------
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY cr_admin_all ON commission_rules
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY cr_facility_read ON commission_rules
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'accountant')
    AND (
      scope_type = 'platform'
      OR facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- ---------------------------------------------------------------------------
-- commission_entries — zamo admins full, facility scoped read
-- ---------------------------------------------------------------------------
ALTER TABLE commission_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY ce_admin_all ON commission_entries
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY ce_facility_read ON commission_entries
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'accountant')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- ---------------------------------------------------------------------------
-- billing_periods — zamo admins full, facility scoped read
-- ---------------------------------------------------------------------------
ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_periods FORCE ROW LEVEL SECURITY;

CREATE POLICY bp_admin_all ON billing_periods
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY bp_facility_read ON billing_periods
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'accountant')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- ---------------------------------------------------------------------------
-- invoices — zamo admins full, facility scoped (manager + accountant)
-- ---------------------------------------------------------------------------
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY inv_admin_all ON invoices
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY inv_facility_read ON invoices
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'accountant')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- ---------------------------------------------------------------------------
-- invoice_line_items — same as invoices
-- ---------------------------------------------------------------------------
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;

CREATE POLICY ili_admin_all ON invoice_line_items
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY ili_facility_read ON invoice_line_items
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'accountant')
    AND invoice_id IN (
      SELECT i.id FROM invoices i
      WHERE i.facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- ---------------------------------------------------------------------------
-- payments — facility submits, zamo confirms
-- ---------------------------------------------------------------------------
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

CREATE POLICY pay_admin_all ON payments
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY pay_facility_manage ON payments
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'accountant')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- ---------------------------------------------------------------------------
-- disputes — parties see their own disputes only
-- ---------------------------------------------------------------------------
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes FORCE ROW LEVEL SECURITY;

CREATE POLICY disp_admin_all ON disputes
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY disp_facility_manage ON disputes
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'accountant')
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- ---------------------------------------------------------------------------
-- dispute_evidence — follows dispute visibility
-- ---------------------------------------------------------------------------
ALTER TABLE dispute_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY de_admin_all ON dispute_evidence
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY de_facility_manage ON dispute_evidence
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager', 'accountant')
    AND dispute_id IN (
      SELECT d.id FROM disputes d
      WHERE d.facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- ---------------------------------------------------------------------------
-- patient_objections — patient sees own, zamo admins see all
-- ---------------------------------------------------------------------------
ALTER TABLE patient_objections ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_objections FORCE ROW LEVEL SECURITY;

CREATE POLICY po_admin_all ON patient_objections
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY po_patient_own ON patient_objections
  FOR ALL TO zamo_app
  USING (
    current_setting('zamo.role_code', true) = 'patient'
    AND patient_id::text = current_setting('zamo.user_id', true)
  );

CREATE POLICY po_facility_read ON patient_objections
  FOR SELECT TO zamo_app
  USING (
    current_setting('zamo.role_code', true) IN ('facility_manager')
    AND booking_id IN (
      SELECT b.id FROM bookings b
      WHERE b.facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- GRANTS
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT ON commission_rules TO zamo_app;  -- append-only
GRANT SELECT, INSERT ON commission_entries TO zamo_app;  -- append-only (DEC-007)
GRANT SELECT, INSERT, UPDATE ON billing_periods TO zamo_app;
GRANT SELECT, INSERT, UPDATE ON invoices TO zamo_app;
GRANT SELECT, INSERT ON invoice_line_items TO zamo_app;  -- append-only
GRANT SELECT, INSERT, UPDATE ON payments TO zamo_app;
GRANT SELECT, INSERT, UPDATE ON disputes TO zamo_app;
GRANT SELECT, INSERT ON dispute_evidence TO zamo_app;
GRANT SELECT, INSERT, UPDATE ON patient_objections TO zamo_app;
