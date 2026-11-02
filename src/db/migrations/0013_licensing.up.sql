-- ZAMO-LIC-017 :: licensing & compliance.
--
-- [S1+S2]: "رفع + مراجعة بشرية + اعتماد/رفض + تنبيه انتهاء"
-- D12: "Workflow اعتماد بمراجع بشري وحالة وتاريخ"
--
-- Hard constraint (A-48, A-49, DEC-014): NO diagnostic / medical fields.

-- ---------------------------------------------------------------------------
-- licenses — documents uploaded by a facility for compliance verification.
-- ---------------------------------------------------------------------------
CREATE TABLE licenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,

  license_type    text NOT NULL CHECK (license_type IN (
    'commercial_registration',
    'medical_practice',
    'ministry_health',
    'municipality',
    'other'
  )),
  license_number  text NOT NULL CHECK (length(btrim(license_number)) > 0),

  -- Document
  document_url    text NOT NULL,
  document_name   text NOT NULL,

  -- Validity
  issued_date     date,
  expiry_date     date,

  -- Review state
  status          text NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review', 'approved', 'rejected', 'expired')),
  reviewed_by     uuid REFERENCES users(id),
  review_notes    text,
  reviewed_at     timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX licenses_facility_idx ON licenses (facility_id);
CREATE INDEX licenses_expiry_idx ON licenses (expiry_date) WHERE status = 'approved';

CREATE TRIGGER licenses_touch BEFORE UPDATE ON licenses
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- verification_reviews — audit trail of each review decision.
-- ---------------------------------------------------------------------------
CREATE TABLE verification_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id  uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id),
  decision    text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  notes       text,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- compliance_alerts — system-generated alerts for expiring/missing docs.
-- ---------------------------------------------------------------------------
CREATE TABLE compliance_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  license_id  uuid REFERENCES licenses(id) ON DELETE SET NULL,
  alert_type  text NOT NULL CHECK (alert_type IN (
    'expiring_soon', 'expired', 'missing_license', 'review_needed'
  )),
  message_ar  text NOT NULL,
  message_en  text NOT NULL,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX compliance_alerts_facility_idx ON compliance_alerts (facility_id);

-- ---------------------------------------------------------------------------
-- RLS — facility-scoped for licenses & alerts; zamo_admin for reviews.
-- ---------------------------------------------------------------------------

-- licenses
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses FORCE ROW LEVEL SECURITY;

CREATE POLICY lic_admin_all ON licenses
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY lic_tenant_read ON licenses
  FOR SELECT TO zamo_app
  USING (facility_id::text = current_setting('zamo.facility_id', true));

CREATE POLICY lic_tenant_insert ON licenses
  FOR INSERT TO zamo_app
  WITH CHECK (
    current_setting('zamo.role_code', true) = 'facility_manager'
    AND facility_id::text = current_setting('zamo.facility_id', true)
  );

-- verification_reviews
ALTER TABLE verification_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY vr_admin_all ON verification_reviews
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY vr_tenant_read ON verification_reviews
  FOR SELECT TO zamo_app
  USING (
    license_id IN (
      SELECT id FROM licenses
      WHERE facility_id::text = current_setting('zamo.facility_id', true)
    )
  );

-- compliance_alerts
ALTER TABLE compliance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY ca_admin_all ON compliance_alerts
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

CREATE POLICY ca_tenant_read ON compliance_alerts
  FOR SELECT TO zamo_app
  USING (facility_id::text = current_setting('zamo.facility_id', true));

-- Grants
GRANT SELECT, INSERT, UPDATE ON licenses TO zamo_app;
GRANT SELECT, INSERT ON verification_reviews TO zamo_app;
GRANT SELECT, INSERT, UPDATE ON compliance_alerts TO zamo_app;
