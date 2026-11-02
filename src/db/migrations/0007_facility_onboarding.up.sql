-- ZAMO-FAC-011 :: facility onboarding — application & review workflow.
--
-- [S2]: "طلب انضمام يتضمن السجل والترخيص وبيانات المفوض والفروع.
--        تراجع زامو الطلب قبل التفعيل."
--
-- Hard constraint (A-48, A-49, DEC-014): NO diagnostic / medical fields.

-- ---------------------------------------------------------------------------
-- facility_applications — join requests submitted by prospective facilities.
-- Zamo reviews before activation (A-32).
-- ---------------------------------------------------------------------------
CREATE TABLE facility_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Facility data
  name_ar         text NOT NULL CHECK (length(btrim(name_ar)) > 0),
  name_en         text NOT NULL CHECK (length(btrim(name_en)) > 0),
  commercial_reg  text NOT NULL CHECK (length(btrim(commercial_reg)) > 0),
  tax_number      text,

  -- Authorised contact
  contact_name    text NOT NULL CHECK (length(btrim(contact_name)) > 0),
  contact_phone   text NOT NULL,   -- E.164
  contact_email   text NOT NULL,

  -- City / location (default Riyadh per S2)
  city_ar         text NOT NULL DEFAULT 'الرياض',
  city_en         text NOT NULL DEFAULT 'Riyadh',

  -- Status (state machine: draft → submitted → under_review → approved|rejected)
  status          text NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected')),

  -- Review
  reviewed_by     uuid REFERENCES users(id),
  review_notes    text,
  reviewed_at     timestamptz,

  -- Link to facility once approved
  facility_id     uuid REFERENCES facilities(id),

  submitted_at    timestamptz DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER facility_applications_touch BEFORE UPDATE ON facility_applications
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — only zamo_admin can see applications; the submitter sees their own.
-- ---------------------------------------------------------------------------
ALTER TABLE facility_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_applications FORCE ROW LEVEL SECURITY;

CREATE POLICY fac_app_admin_all ON facility_applications
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

-- Allow the contact (future facility_manager) to see their own application
-- by matching phone.  Once approved, facility_id will be set and normal
-- facility policies take over.
CREATE POLICY fac_app_submitter ON facility_applications
  FOR SELECT TO zamo_app
  USING (
    contact_phone = (
      SELECT phone FROM users
      WHERE id::text = current_setting('zamo.user_id', true)
    )
  );

GRANT SELECT, INSERT, UPDATE ON facility_applications TO zamo_app;
