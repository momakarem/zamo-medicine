-- ZAMO Phase 3 — Discovery: schema additions, public views, search indexes, legal pages
-- This migration:
--   1. Adds missing columns to facilities (logo_url, description_ar/en)
--   2. Creates read-only public views for the discovery/search module
--   3. Adds performance indexes
--   4. Creates the legal_pages table with 10 placeholder pages (B-38)

-- ============================================================================
-- 1. Schema additions to facilities table
-- ============================================================================

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS logo_url       text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS description_ar text;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS description_en text;

-- ============================================================================
-- 2. Public views (read-only projections for unauthenticated visitors)
-- ============================================================================

-- Public doctors view: only active doctors in approved facilities with active branches
CREATE OR REPLACE VIEW public_doctors_v AS
SELECT
  d.id                AS doctor_id,
  d.name_ar           AS doctor_name_ar,
  d.name_en           AS doctor_name_en,
  d.license_number,
  d.bio_ar,
  d.bio_en,
  d.photo_url,
  d.gender,
  s.id                AS specialty_id,
  s.name_ar           AS specialty_name_ar,
  s.name_en           AS specialty_name_en,
  s.slug              AS specialty_slug,
  b.id                AS branch_id,
  b.name_ar           AS branch_name_ar,
  b.name_en           AS branch_name_en,
  b.city_ar,
  b.city_en,
  b.district_ar,
  b.district_en,
  b.address_line,
  b.phone             AS branch_phone,
  b.latitude,
  b.longitude,
  f.id                AS facility_id,
  f.name_ar           AS facility_name_ar,
  f.name_en           AS facility_name_en,
  f.logo_url          AS facility_logo_url
FROM doctors d
JOIN specialties s      ON s.id = d.specialty_id
JOIN doctor_branches db ON db.doctor_id = d.id AND db.is_active = true
JOIN branches b         ON b.id = db.branch_id AND b.is_active = true
JOIN facilities f       ON f.id = d.facility_id AND f.status = 'approved'
WHERE d.is_active = true
  AND s.is_active = true;

-- Public branches view
CREATE OR REPLACE VIEW public_branches_v AS
SELECT
  b.id                AS branch_id,
  b.name_ar           AS branch_name_ar,
  b.name_en           AS branch_name_en,
  b.city_ar,
  b.city_en,
  b.district_ar,
  b.district_en,
  b.address_line,
  b.phone,
  b.latitude,
  b.longitude,
  f.id                AS facility_id,
  f.name_ar           AS facility_name_ar,
  f.name_en           AS facility_name_en,
  f.logo_url          AS facility_logo_url
FROM branches b
JOIN facilities f ON f.id = b.facility_id AND f.status = 'approved'
WHERE b.is_active = true;

-- Public facilities view
CREATE OR REPLACE VIEW public_facilities_v AS
SELECT
  f.id                AS facility_id,
  f.name_ar           AS facility_name_ar,
  f.name_en           AS facility_name_en,
  f.logo_url,
  f.description_ar,
  f.description_en,
  f.status,
  f.created_at        AS joined_at
FROM facilities f
WHERE f.status = 'approved';

-- ============================================================================
-- 3. Search performance indexes
-- ============================================================================

-- Speed up specialty-based doctor search
CREATE INDEX IF NOT EXISTS idx_doctors_specialty_active
  ON doctors (specialty_id)
  WHERE is_active = true;

-- Speed up branch-based service lookup
CREATE INDEX IF NOT EXISTS idx_branch_services_branch_active
  ON branch_services (branch_id)
  WHERE is_active = true;

-- Speed up active price lookup
CREATE INDEX IF NOT EXISTS idx_prices_active_current
  ON prices (branch_service_id)
  WHERE status = 'approved' AND effective_to IS NULL;

-- Speed up doctor-branch association lookup
CREATE INDEX IF NOT EXISTS idx_doctor_branches_active
  ON doctor_branches (doctor_id)
  WHERE is_active = true;

-- ============================================================================
-- 4. Legal pages table (SRCH-026)
-- ============================================================================

CREATE TABLE legal_pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  title_ar    TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  content_ar  TEXT NOT NULL,
  content_en  TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER legal_pages_touch BEFORE UPDATE ON legal_pages
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- Seed the 10 required legal pages with placeholder text (B-38)
INSERT INTO legal_pages (slug, title_ar, title_en, content_ar, content_en, sort_order) VALUES
  ('about',
   'عن زامو',
   'About Zamo',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. زامو هي منصة وسيط حجز مواعيد طبية في المملكة العربية السعودية. نربط المرضى بالعيادات المرخصة والمعتمدة.',
   '⚠️ PLACEHOLDER — Replace before launch. Zamo is a medical appointment booking platform in Saudi Arabia. We connect patients with licensed and verified clinics.',
   1),

  ('terms',
   'شروط الاستخدام',
   'Terms of Service',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. باستخدامك لمنصة زامو، فإنك توافق على هذه الشروط. زامو وسيط حجز وليست مقدم رعاية صحية.',
   '⚠️ PLACEHOLDER — Replace before launch. By using the Zamo platform, you agree to these terms. Zamo is a booking intermediary, not a healthcare provider.',
   2),

  ('privacy',
   'سياسة الخصوصية',
   'Privacy Policy',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. نحمي بياناتك الشخصية وفقاً لأنظمة المملكة العربية السعودية. لا نشارك بياناتك مع أطراف ثالثة دون موافقتك.',
   '⚠️ PLACEHOLDER — Replace before launch. We protect your personal data in accordance with Saudi Arabian regulations. We do not share your data with third parties without your consent.',
   3),

  ('medical-disclaimer',
   'إخلاء المسؤولية الطبية',
   'Medical Disclaimer',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. زامو منصة حجز مواعيد فقط، وليست مقدم رعاية صحية. لا نقدم استشارات طبية أو تشخيصات. جميع القرارات الطبية تعود للطبيب المعالج والمريض. النتائج تختلف من شخص لآخر.',
   '⚠️ PLACEHOLDER — Replace before launch. Zamo is an appointment booking platform only, not a healthcare provider. We do not provide medical advice or diagnoses. All medical decisions are between the treating physician and patient. Results vary from person to person.',
   4),

  ('cookies',
   'سياسة الكوكيز',
   'Cookie Policy',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. نستخدم ملفات تعريف الارتباط لتحسين تجربتك على المنصة.',
   '⚠️ PLACEHOLDER — Replace before launch. We use cookies to improve your experience on the platform.',
   5),

  ('refund',
   'سياسة الاسترجاع',
   'Refund Policy',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. الدفع يتم داخل المنشأة مباشرة. لا يتم أي دفع إلكتروني عبر المنصة في النسخة الحالية.',
   '⚠️ PLACEHOLDER — Replace before launch. Payment is made directly at the facility. No electronic payments are processed through the platform in the current version.',
   6),

  ('contact',
   'تواصل معنا',
   'Contact Us',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. للتواصل مع فريق زامو، يرجى إرسال بريد إلكتروني إلى support@zamo.sa.',
   '⚠️ PLACEHOLDER — Replace before launch. To contact the Zamo team, please email support@zamo.sa.',
   7),

  ('faq',
   'الأسئلة الشائعة',
   'FAQ',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. س: ما هي زامو؟ ج: منصة حجز مواعيد طبية تربط المرضى بالعيادات المرخصة.',
   '⚠️ PLACEHOLDER — Replace before launch. Q: What is Zamo? A: A medical appointment booking platform that connects patients with licensed clinics.',
   8),

  ('accessibility',
   'إمكانية الوصول',
   'Accessibility',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. نلتزم بتوفير منصة متاحة للجميع، بما في ذلك الأشخاص ذوي الإعاقة. المنصة تدعم رحلة نصية كاملة دون الاعتماد على الصوت.',
   '⚠️ PLACEHOLDER — Replace before launch. We are committed to providing an accessible platform for everyone, including people with disabilities. The platform supports a fully text-based journey without relying on audio.',
   9),

  ('complaints',
   'الشكاوى',
   'Complaints',
   '⚠️ PLACEHOLDER — يُستبدل قبل الإطلاق. لتقديم شكوى، يرجى التواصل عبر البريد الإلكتروني complaints@zamo.sa مع ذكر رقم الحجز وتفاصيل الشكوى.',
   '⚠️ PLACEHOLDER — Replace before launch. To file a complaint, please email complaints@zamo.sa with your booking number and complaint details.',
   10);
