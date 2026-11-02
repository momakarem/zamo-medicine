-- ZAMO-CAT-014 :: catalog — specialties & services dictionary.
--
-- [S2]: "أسنان · جلدية · تجميل" — the three launch specialties.
-- [S1]: Services have bilingual names (name_ar / name_en) per D8.
--
-- These are PLATFORM-LEVEL entities, not facility-scoped.
-- Individual facilities link to them via branch_services (0011).
--
-- Hard constraint (A-48, A-49, DEC-014): NO diagnostic / medical fields.

-- ---------------------------------------------------------------------------
-- specialties — التخصصات (platform-level).
-- ---------------------------------------------------------------------------
CREATE TABLE specialties (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar        text NOT NULL CHECK (length(btrim(name_ar)) > 0),
  name_en        text NOT NULL CHECK (length(btrim(name_en)) > 0),
  slug           text NOT NULL UNIQUE,   -- URL-safe identifier
  icon           text,                    -- Lucide icon name (S2)
  description_ar text,
  description_en text,
  sort_order     smallint NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- services — قاموس الخدمات (platform-level).
-- ---------------------------------------------------------------------------
CREATE TABLE services (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  specialty_id             uuid NOT NULL REFERENCES specialties(id) ON DELETE RESTRICT,
  name_ar                  text NOT NULL CHECK (length(btrim(name_ar)) > 0),
  name_en                  text NOT NULL CHECK (length(btrim(name_en)) > 0),
  slug                     text NOT NULL UNIQUE,
  description_ar           text,
  description_en           text,
  default_duration_minutes smallint NOT NULL DEFAULT 30 CHECK (default_duration_minutes > 0),
  sort_order               smallint NOT NULL DEFAULT 0,
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX services_specialty_idx ON services (specialty_id);

-- ---------------------------------------------------------------------------
-- Seed: the three approved specialties [S2].
-- ---------------------------------------------------------------------------
INSERT INTO specialties (name_ar, name_en, slug, icon, sort_order) VALUES
  ('أسنان',  'Dentistry',    'dentistry',    'stethoscope', 1),
  ('جلدية',  'Dermatology',  'dermatology',  'scan-eye',    2),
  ('تجميل',  'Cosmetics',    'cosmetics',    'sparkles',    3);

-- ---------------------------------------------------------------------------
-- RLS — platform-level: readable by all, writable by admin only.
-- ---------------------------------------------------------------------------
ALTER TABLE specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialties FORCE ROW LEVEL SECURITY;

CREATE POLICY spec_read_all ON specialties
  FOR SELECT TO zamo_app
  USING (true);

CREATE POLICY spec_admin_write ON specialties
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;

CREATE POLICY svc_read_all ON services
  FOR SELECT TO zamo_app
  USING (true);

CREATE POLICY svc_admin_write ON services
  FOR ALL TO zamo_app
  USING (current_setting('zamo.role_code', true) = 'zamo_admin');

-- Grants
GRANT SELECT, INSERT, UPDATE ON specialties TO zamo_app;
GRANT SELECT, INSERT, UPDATE ON services TO zamo_app;
