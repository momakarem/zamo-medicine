-- ZAMO-DB-003 :: core identity + tenancy schema
--
-- Scope note (DEC B-05): this migration contains ONLY foundations that do not
-- depend on undecided business rules. No bookings, no commissions, no invoices
-- — those wait on OQ-003 / OQ-007..OQ-012.
--
-- Hard constraint (A-48, A-49, DEC-014): this schema carries NO diagnostic,
-- treatment or medical-record field of any kind. Enforced by scripts/scan-medical-fields.mjs.

-- ---------------------------------------------------------------------------
-- Application role used by the API. It is deliberately NOT a superuser, so
-- Row-Level Security actually applies to it (superusers bypass RLS).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zamo_app') THEN
    CREATE ROLE zamo_app NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Shared helper: keep updated_at honest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zamo_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- facilities — المنشأة. The tenant boundary (A-26).
-- ---------------------------------------------------------------------------
CREATE TABLE facilities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar        text NOT NULL CHECK (length(btrim(name_ar)) > 0),
  name_en        text NOT NULL CHECK (length(btrim(name_en)) > 0),
  -- A-32: Zamo reviews the join request before activation.
  status         text NOT NULL DEFAULT 'pending_review'
                   CHECK (status IN ('draft', 'pending_review', 'approved', 'suspended')),
  commercial_reg text,
  contact_email  text,
  contact_phone  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER facilities_touch BEFORE UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- branches — الفرع. A facility has many branches (A-23).
-- ---------------------------------------------------------------------------
CREATE TABLE branches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id  uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  name_ar      text NOT NULL CHECK (length(btrim(name_ar)) > 0),
  name_en      text NOT NULL CHECK (length(btrim(name_en)) > 0),
  city_ar      text NOT NULL DEFAULT 'الرياض',
  city_en      text NOT NULL DEFAULT 'Riyadh',
  district_ar  text,
  district_en  text,
  address_line text,
  phone        text,
  latitude     numeric(9, 6),
  longitude    numeric(9, 6),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Branch names are unique inside a facility, not globally.
  CONSTRAINT branches_unique_name_per_facility UNIQUE (facility_id, name_en)
);

CREATE INDEX branches_facility_idx ON branches (facility_id);

CREATE TRIGGER branches_touch BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- roles — the approved role set (DECISIONS A-table, B-02, B-03, B-04).
-- `scope` records where a role can operate; it drives the authorization layer.
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  code        text PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  scope       text NOT NULL CHECK (scope IN ('platform', 'facility', 'branch', 'self')),
  description text
);

-- ---------------------------------------------------------------------------
-- permissions — fine-grained, referenced by code from the application.
-- ---------------------------------------------------------------------------
CREATE TABLE permissions (
  code        text PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  -- Financial permissions get extra audit scrutiny (A-46).
  is_financial boolean NOT NULL DEFAULT false
);

CREATE TABLE role_permissions (
  role_code       text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

-- ---------------------------------------------------------------------------
-- users
--
-- Patients authenticate with phone + OTP and have NO password (A-33).
-- Staff and Zamo admins use a password plus MFA (A-43).
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164, normalised by the application before insert.
  phone          text UNIQUE,
  email          text UNIQUE,
  full_name      text,
  preferred_lang text NOT NULL DEFAULT 'ar' CHECK (preferred_lang IN ('ar', 'en')),

  -- NULL for patients: they never have a password (A-33).
  password_hash  text,
  mfa_secret     text,
  mfa_enabled    boolean NOT NULL DEFAULT false,

  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- A user must be reachable by at least one identifier.
  CONSTRAINT users_need_an_identifier CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ---------------------------------------------------------------------------
-- user_roles — a role assignment, scoped to a facility and optionally a branch.
--
-- facility_id IS NULL  -> platform-level (Zamo staff) or patient.
-- branch_id   IS NULL  -> whole facility.
-- ---------------------------------------------------------------------------
CREATE TABLE user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code   text NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
  branch_id   uuid REFERENCES branches(id) ON DELETE CASCADE,
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_roles_unique UNIQUE NULLS NOT DISTINCT (user_id, role_code, facility_id, branch_id)
);

CREATE INDEX user_roles_user_idx ON user_roles (user_id);
CREATE INDEX user_roles_facility_idx ON user_roles (facility_id);

-- A branch-scoped assignment must name a facility too.
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_branch_implies_facility
  CHECK (branch_id IS NULL OR facility_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Seed: the approved roles.
-- ---------------------------------------------------------------------------
INSERT INTO roles (code, name_ar, name_en, scope, description) VALUES
  ('zamo_admin',     'مدير زامو',        'Zamo Administrator', 'platform',
   'إدارة جميع المنشآت والعمولات والحملات والتوثيق والتقارير'),
  ('zamo_ops',       'تشغيل زامو',       'Zamo Operations',    'platform',
   'المتابعة التشغيلية والحجوزات المتعثرة'),
  ('zamo_support',   'دعم زامو',         'Zamo Support',       'platform',
   'دعم المستخدمين والتصعيد'),
  ('zamo_marketing', 'تسويق زامو',       'Zamo Marketing',     'platform',
   'الحملات ومصادر العملاء'),
  ('zamo_auditor',   'مدقق زامو',        'Zamo Auditor',       'platform',
   'اطلاع على سجل التدقيق فقط'),
  ('facility_manager','مدير المنشأة',     'Facility Manager',   'facility',
   'الفروع والمستخدمون والأطباء والأسعار والعروض واعتماد المبالغ'),
  ('branch_manager', 'مدير الفرع',       'Branch Manager',     'branch',
   'جدول الفرع وفريق الاستقبال والأطباء والخدمات التابعة للفرع'),
  ('receptionist',   'موظف الاستقبال',   'Receptionist',       'branch',
   'التأكيد والرفض وإعادة الجدولة وتسجيل الحضور والخدمة والتحصيل'),
  ('doctor',         'الطبيب',           'Doctor',             'facility',
   'جدوله وتفاصيل المواعيد واقتراح تعديل الخدمة أو السعر'),
  ('accountant',     'المحاسب',          'Accountant',         'facility',
   'اطلاع ومراجعة: الخدمات المنفذة والتحصيل والعمولات والفواتير'),
  ('patient',        'المريض',           'Patient',            'self',
   'الطلب والإلغاء وإعادة الجدولة ومتابعة الحالة والاعتراض');
