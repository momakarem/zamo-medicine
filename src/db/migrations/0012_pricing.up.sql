-- ZAMO-CAT-016 :: historical pricing.
--
-- [S1]: "تاريخ بدء/انتهاء السعر + سجل التعديلات + اسم المستخدم المعدّل"
-- DEC (ARCHITECTURE §8.2): "السعر جدول تاريخي منفصل، لا حقل في Service"
-- DEC: amounts are numeric (never float) — financial precision (D2).
--
-- Prices are APPEND-ONLY by design: a new row replaces the old one by closing
-- `effective_to` on the previous record.  No UPDATE on amount columns.
--
-- Hard constraint (A-48, A-49, DEC-014): NO diagnostic / medical fields.

-- ---------------------------------------------------------------------------
-- prices — historical price records per branch_service.
-- ---------------------------------------------------------------------------
CREATE TABLE prices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_service_id uuid NOT NULL REFERENCES branch_services(id) ON DELETE CASCADE,

  -- Price type [S1]: fixed | starting_from | range
  price_type        text NOT NULL CHECK (price_type IN ('fixed', 'starting_from', 'range')),
  amount            numeric(12, 2) NOT NULL CHECK (amount >= 0),
  amount_max        numeric(12, 2) CHECK (amount_max IS NULL OR amount_max >= amount),
  currency          text NOT NULL DEFAULT 'SAR',

  -- Validity window
  effective_from    timestamptz NOT NULL DEFAULT now(),
  effective_to      timestamptz,  -- NULL = currently active

  -- Approval workflow (facility_manager only — A-table §6.3)
  status            text NOT NULL DEFAULT 'pending_approval'
                      CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  approved_by       uuid REFERENCES users(id),
  approved_at       timestamptz,
  rejection_reason  text,

  -- Creator
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Business rules
  CONSTRAINT price_range_requires_max CHECK (
    price_type != 'range' OR amount_max IS NOT NULL
  )
);

-- Fast lookup: current active price for a branch_service
CREATE INDEX prices_active_idx ON prices (branch_service_id, effective_from DESC)
  WHERE status = 'approved' AND effective_to IS NULL;

CREATE INDEX prices_branch_service_idx ON prices (branch_service_id);

-- ---------------------------------------------------------------------------
-- RLS — scoped through branch_service_id → branch_id → facility_id.
-- ---------------------------------------------------------------------------
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices FORCE ROW LEVEL SECURITY;

CREATE POLICY prices_admin_all ON prices
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY prices_tenant_read ON prices
  FOR SELECT TO zamo_app
  USING (
    branch_service_id IN (
      SELECT bs.id FROM branch_services bs
      JOIN branches b ON bs.branch_id = b.id
      WHERE b.facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

CREATE POLICY prices_tenant_write ON prices
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
GRANT SELECT, INSERT, UPDATE ON prices TO zamo_app;
