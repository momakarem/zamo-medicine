-- ZAMO-GROW-071..072, ZAMO-RPT-073..076 :: growth + reporting.
--
-- M12 Growth module + M14 Reporting module (Phase 9 — النمو والتقارير).
--
-- Implements:
--   F9.1:  UTM attribution capture before registration.
--   F9.2:  Link attribution to booking → service → revenue → commission.
--   F9.3:  Campaign management + budget + completed-service cost + contribution margin.
--   F9.4:  11 facility reports [S1].
--   F9.5:  Zamo executive dashboard (financial/analytical KPIs).
--   F9.6:  SLA response-time report (Risk #1).
--
-- Depends on: 0020_billing (commission_entries, invoices, settlements, payments)
--             0019_agent (conversations)
--             0018_operations (attendance, performed_services, collection_entries, value_approvals)
--             0017_bookings (bookings, booking_status_history)
--             0011_branch_services (branch_services)
--             0009_catalog (services, specialties)
--             0008_branch_management (branches)
--             0007_facility_onboarding (facilities)
--             0001_core_identity (users)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. attribution_touches — التقاط مصدر العميل (ZAMO-GROW-071)
--
-- ❗ يُلتقط **قبل التسجيل** — sessionId يربط الزائر المجهول.
-- ❗ يبقى عبر الجلسة حتى الحجز [S1].
-- ❗ ينتقل من المحادثة للحجز.
-- الدخول المباشر يُسجَّل كمصدر 'direct'.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE attribution_touches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Session binding — links anonymous visitor before auth
  session_id      text NOT NULL,

  -- Patient binding — NULL before registration, set after OTP
  patient_id      uuid REFERENCES users(id) ON DELETE SET NULL,

  -- UTM parameters
  utm_source      text,          -- google, facebook, tiktok, snapchat...
  utm_medium      text,          -- cpc, social, organic, email...
  utm_campaign    text,          -- campaign identifier (matches campaigns.utm_campaign)
  utm_term        text,          -- keyword (paid search)
  utm_content     text,          -- ad variation identifier

  -- Extra attribution data
  referrer        text,          -- HTTP Referer header
  landing_page    text,          -- first page URL visited

  -- Derived channel
  channel         text NOT NULL DEFAULT 'direct'
                  CHECK (channel IN ('paid', 'organic', 'direct', 'referral', 'social')),

  -- Conversation linkage (from Agent module)
  conversation_id uuid,          -- links to conversations table if flow started via agent

  -- Lifecycle
  linked_to_booking_at timestamptz,  -- set when attribution is attached to a booking

  -- Timestamps
  captured_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attr_session_idx ON attribution_touches (session_id);
CREATE INDEX attr_patient_idx ON attribution_touches (patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX attr_utm_campaign_idx ON attribution_touches (utm_campaign) WHERE utm_campaign IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. campaigns — إدارة الحملات (ZAMO-GROW-072)
--
-- 15 fields from [S1]:
--   1. name               2. platform           3. facility_id
--   4. branch_id           5. service_id         6. budget
--   7. start_date          8. end_date           9. utm_campaign
--   10-15: computed via campaign_stats_view (bookings, attendance,
--          services, revenue, commission, completed_service_cost,
--          contribution_margin)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name            text NOT NULL,                          -- 1. اسم الحملة
  platform        text NOT NULL,                          -- 2. المنصة الإعلانية
  utm_campaign    text NOT NULL UNIQUE,                   -- 9. معرّف UTM (matches attribution_touches.utm_campaign)

  -- Scope — optional targeting
  facility_id     uuid REFERENCES facilities(id) ON DELETE SET NULL,  -- 3. العيادة
  branch_id       uuid REFERENCES branches(id) ON DELETE SET NULL,    -- 4. الفرع
  service_id      uuid REFERENCES branch_services(id) ON DELETE SET NULL, -- 5. الخدمة

  -- Budget
  budget          numeric(14,2) NOT NULL DEFAULT 0        -- 6. الميزانية (SAR)
                  CHECK (budget >= 0),

  -- Date range
  start_date      date NOT NULL,                          -- 7. تاريخ البداية
  end_date        date,                                   -- 8. تاريخ النهاية

  -- Status
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'paused', 'ended')),

  -- Audit
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX camp_status_idx ON campaigns (status) WHERE status = 'active';
CREATE INDEX camp_facility_idx ON campaigns (facility_id) WHERE facility_id IS NOT NULL;

CREATE TRIGGER campaigns_touch BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Add attribution_id to bookings (ZAMO-GROW-071 / F9.2)
--
-- Links each booking back to its acquisition source.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE bookings
  ADD COLUMN attribution_id uuid REFERENCES attribution_touches(id) ON DELETE SET NULL;

CREATE INDEX bookings_attribution_idx ON bookings (attribution_id) WHERE attribution_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3b. offers — العروض والخصومات
--
-- Tracks facility/branch promotions linked to branch_services.
-- Referenced by v_facility_offers_report (Report 10).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS offers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope
  facility_id       uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  branch_id         uuid REFERENCES branches(id) ON DELETE CASCADE,
  branch_service_id uuid REFERENCES branch_services(id) ON DELETE CASCADE,

  -- Details
  title             text NOT NULL,
  description       text,
  discount_type     text NOT NULL DEFAULT 'percentage'
                    CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value    numeric(14,2) NOT NULL CHECK (discount_value > 0),

  -- Validity
  start_date        date NOT NULL DEFAULT CURRENT_DATE,
  end_date          date,

  -- Status
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'paused', 'ended', 'expired')),

  -- Audit
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- end_date must be >= start_date when set
  CONSTRAINT offers_date_range CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX offers_facility_idx ON offers (facility_id);
CREATE INDEX offers_branch_idx ON offers (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX offers_status_idx ON offers (status) WHERE status = 'active';

CREATE TRIGGER offers_touch BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION zamo_touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. campaign_stats_view — القمع الكامل (ZAMO-GROW-072)
--
-- Full funnel: bookings → attendance → services → revenue → commission → margin
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW campaign_stats_view AS
SELECT
  c.id                                              AS campaign_id,
  c.name                                            AS campaign_name,
  c.platform,
  c.budget,
  c.start_date,
  c.end_date,
  c.status,

  -- 10. الحجوزات
  COUNT(DISTINCT b.id)                              AS total_bookings,

  -- 11. الحضور
  COUNT(DISTINCT b.id) FILTER (
    WHERE b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED')
  )                                                 AS total_attended,

  -- 12. الخدمات المنفذة
  COUNT(DISTINCT b.id) FILTER (
    WHERE b.status IN ('SERVICE_DONE','COLLECTED')
  )                                                 AS total_services_done,

  -- 13. الإيراد (المحصّل فعلياً)
  COALESCE(SUM(ce_agg.total_collected), 0)          AS total_revenue,

  -- 14. العمولة
  COALESCE(SUM(cm_agg.total_commission), 0)         AS total_commission,

  -- 15. تكلفة الخدمة المكتملة
  CASE
    WHEN COUNT(DISTINCT b.id) FILTER (
      WHERE b.status IN ('SERVICE_DONE','COLLECTED')
    ) > 0
    THEN c.budget / COUNT(DISTINCT b.id) FILTER (
      WHERE b.status IN ('SERVICE_DONE','COLLECTED')
    )
    ELSE NULL
  END                                               AS cost_per_completed_service,

  -- هامش المساهمة = إيراد - (ميزانية + عمولة)
  COALESCE(SUM(ce_agg.total_collected), 0)
    - c.budget
    - COALESCE(SUM(cm_agg.total_commission), 0)     AS contribution_margin

FROM campaigns c
LEFT JOIN attribution_touches at ON at.utm_campaign = c.utm_campaign
LEFT JOIN bookings b ON b.attribution_id = at.id
LEFT JOIN LATERAL (
  SELECT SUM(ce.proposed_amount) AS total_collected
  FROM collection_entries ce
  WHERE ce.booking_id = b.id
    AND ce.approval_status = 'APPROVED'
) ce_agg ON true
LEFT JOIN LATERAL (
  SELECT SUM(cx.commission_amount) AS total_commission
  FROM commission_entries cx
  WHERE cx.booking_id = b.id
    AND cx.is_reversal = false
) cm_agg ON true
GROUP BY c.id, c.name, c.platform, c.budget, c.start_date, c.end_date, c.status;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. FACILITY REPORTS — 11 تقرير للمنشأة (ZAMO-RPT-073)
--
-- All views are read-only (M14 Reporting module).
-- ❗ Access control (facility_manager sees own facility only) is enforced
--    at the application layer + RLS on the underlying tables.
-- ═══════════════════════════════════════════════════════════════════════════

-- Report 1: الحجوزات
CREATE OR REPLACE VIEW v_facility_bookings_report AS
SELECT
  b.facility_id,
  b.branch_id,
  b.doctor_id,
  b.status,
  DATE(b.slot_start)                    AS booking_date,
  b.is_late,
  b.sla_deadline,
  b.confirmed_at,
  b.cancelled_at,
  b.rejected_at,
  COUNT(*)                              AS booking_count
FROM bookings b
GROUP BY b.facility_id, b.branch_id, b.doctor_id, b.status,
         DATE(b.slot_start), b.is_late, b.sla_deadline,
         b.confirmed_at, b.cancelled_at, b.rejected_at;

-- Report 2: الحضور
CREATE OR REPLACE VIEW v_facility_attendance_report AS
SELECT
  a.facility_id,
  a.branch_id,
  DATE(a.slot_start)                    AS attendance_date,
  a.attendance_status,
  COUNT(*)                              AS attendance_count,
  AVG(EXTRACT(EPOCH FROM (a.arrival_time - a.slot_start)) / 60.0)
    FILTER (WHERE a.arrival_time IS NOT NULL)
                                        AS avg_arrival_offset_minutes
FROM attendance a
GROUP BY a.facility_id, a.branch_id, DATE(a.slot_start), a.attendance_status;

-- Report 3: الخدمات المنفذة
CREATE OR REPLACE VIEW v_facility_services_report AS
SELECT
  ps.facility_id,
  ps.branch_id,
  ps.actual_service_id,
  ps.actual_doctor_id,
  ps.service_matches,
  DATE(ps.created_at)                   AS service_date,
  COUNT(*)                              AS service_count
FROM performed_services ps
GROUP BY ps.facility_id, ps.branch_id, ps.actual_service_id,
         ps.actual_doctor_id, ps.service_matches, DATE(ps.created_at);

-- Report 4: الإيراد والتحصيل
CREATE OR REPLACE VIEW v_facility_revenue_report AS
SELECT
  ce.facility_id,
  ce.branch_id,
  DATE(ce.created_at)                   AS collection_date,
  ce.approval_status,
  COUNT(*)                              AS entry_count,
  SUM(ce.proposed_amount)               AS total_collected
FROM collection_entries ce
GROUP BY ce.facility_id, ce.branch_id, DATE(ce.created_at), ce.approval_status;

-- Report 5: العمولات
CREATE OR REPLACE VIEW v_facility_commission_report AS
SELECT
  cx.facility_id,
  cx.is_reversal,
  cx.billing_period_id,
  DATE(cx.accrued_at)                   AS accrual_date,
  COUNT(*)                              AS entry_count,
  SUM(cx.commission_amount)             AS total_net,
  SUM(cx.vat_amount)                    AS total_vat,
  SUM(cx.total_with_vat)                AS total_gross
FROM commission_entries cx
GROUP BY cx.facility_id, cx.is_reversal, cx.billing_period_id, DATE(cx.accrued_at);

-- Report 6: أداء الأطباء
CREATE OR REPLACE VIEW v_facility_doctors_report AS
SELECT
  b.facility_id,
  b.branch_id,
  b.doctor_id,
  COUNT(*)                                                    AS total_bookings,
  COUNT(*) FILTER (WHERE b.status = 'CONFIRMED')             AS confirmed,
  COUNT(*) FILTER (WHERE b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED'))
                                                              AS attended,
  COUNT(*) FILTER (WHERE b.status = 'NO_SHOW')               AS no_shows,
  COUNT(*) FILTER (WHERE b.status IN ('SERVICE_DONE','COLLECTED'))
                                                              AS services_done,
  COUNT(*) FILTER (WHERE b.status = 'COLLECTED')              AS collected
FROM bookings b
GROUP BY b.facility_id, b.branch_id, b.doctor_id;

-- Report 7: مقارنة الفروع
CREATE OR REPLACE VIEW v_facility_branches_report AS
SELECT
  b.facility_id,
  b.branch_id,
  COUNT(*)                                                    AS total_bookings,
  COUNT(*) FILTER (WHERE b.status NOT IN ('CANCELLED','REJECTED'))
                                                              AS active_bookings,
  COUNT(*) FILTER (WHERE b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED'))
                                                              AS attended,
  COUNT(*) FILTER (WHERE b.status = 'NO_SHOW')                AS no_shows,
  CASE
    WHEN COUNT(*) FILTER (WHERE b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED','NO_SHOW')) > 0
    THEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED'))
      / COUNT(*) FILTER (WHERE b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED','NO_SHOW')),
      1
    )
    ELSE 0
  END                                                         AS attendance_rate,
  AVG(EXTRACT(EPOCH FROM (b.confirmed_at - b.created_at)) / 60.0)
    FILTER (WHERE b.confirmed_at IS NOT NULL)
                                                              AS avg_response_minutes
FROM bookings b
GROUP BY b.facility_id, b.branch_id;

-- Report 8: الإلغاءات والرفض
CREATE OR REPLACE VIEW v_facility_cancellations_report AS
SELECT
  b.facility_id,
  b.branch_id,
  b.status,
  b.cancellation_source,
  b.rejection_reason,
  b.cancellation_reason,
  DATE(COALESCE(b.cancelled_at, b.rejected_at))              AS event_date,
  COUNT(*)                                                    AS event_count
FROM bookings b
WHERE b.status IN ('CANCELLED', 'REJECTED')
GROUP BY b.facility_id, b.branch_id, b.status,
         b.cancellation_source, b.rejection_reason,
         b.cancellation_reason,
         DATE(COALESCE(b.cancelled_at, b.rejected_at));

-- Report 9: الالتزام بالـSLA
CREATE OR REPLACE VIEW v_facility_sla_report AS
SELECT
  b.facility_id,
  b.branch_id,
  DATE(b.created_at)                                          AS report_date,
  COUNT(*)                                                    AS total_bookings,
  COUNT(*) FILTER (WHERE b.confirmed_at IS NOT NULL
    AND b.sla_deadline IS NOT NULL
    AND b.confirmed_at <= b.sla_deadline)                     AS within_sla,
  COUNT(*) FILTER (WHERE b.is_late = true)                    AS late_count,
  CASE
    WHEN COUNT(*) FILTER (WHERE b.sla_deadline IS NOT NULL) > 0
    THEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE b.confirmed_at IS NOT NULL
        AND b.sla_deadline IS NOT NULL
        AND b.confirmed_at <= b.sla_deadline)
      / COUNT(*) FILTER (WHERE b.sla_deadline IS NOT NULL),
      1
    )
    ELSE 0
  END                                                         AS sla_compliance_rate,
  AVG(EXTRACT(EPOCH FROM (b.confirmed_at - b.created_at)) / 60.0)
    FILTER (WHERE b.confirmed_at IS NOT NULL)
                                                              AS avg_confirmation_minutes
FROM bookings b
WHERE b.status != 'NEW'
GROUP BY b.facility_id, b.branch_id, DATE(b.created_at);

-- Report 10: أداء العروض
CREATE OR REPLACE VIEW v_facility_offers_report AS
SELECT
  o.facility_id,
  o.branch_id,
  o.id                                  AS offer_id,
  o.title,
  o.status                              AS offer_status,
  o.discount_type,
  o.discount_value,
  o.start_date,
  o.end_date,
  COUNT(DISTINCT b.id)                  AS total_bookings,
  COUNT(DISTINCT b.id) FILTER (
    WHERE b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED')
  )                                     AS attended_bookings,
  COUNT(DISTINCT b.id) FILTER (
    WHERE b.status = 'COLLECTED'
  )                                     AS collected_bookings
FROM offers o
LEFT JOIN bookings b ON b.branch_service_id = o.branch_service_id
  AND b.slot_start >= o.start_date
  AND (o.end_date IS NULL OR b.slot_start <= o.end_date + interval '1 day')
  AND b.status NOT IN ('CANCELLED', 'REJECTED')
GROUP BY o.facility_id, o.branch_id, o.id, o.title, o.status,
         o.discount_type, o.discount_value, o.start_date, o.end_date;

-- Report 11: الحملات الإعلانية (per facility)
CREATE OR REPLACE VIEW v_facility_campaigns_report AS
SELECT
  c.id                                  AS campaign_id,
  c.name                                AS campaign_name,
  c.platform,
  c.facility_id,
  c.budget,
  c.start_date,
  c.end_date,
  c.status,
  COUNT(DISTINCT b.id)                  AS total_bookings,
  COUNT(DISTINCT b.id) FILTER (
    WHERE b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED')
  )                                     AS attended_bookings,
  COUNT(DISTINCT b.id) FILTER (
    WHERE b.status = 'COLLECTED'
  )                                     AS collected_bookings
FROM campaigns c
LEFT JOIN attribution_touches at ON at.utm_campaign = c.utm_campaign
LEFT JOIN bookings b ON b.attribution_id = at.id
WHERE c.facility_id IS NOT NULL
GROUP BY c.id, c.name, c.platform, c.facility_id, c.budget,
         c.start_date, c.end_date, c.status;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. ZAMO DASHBOARD — لوحة قيادة زامو (ZAMO-RPT-074)
--
-- Financial/analytical KPIs extending the operational dashboard (OPS-045).
-- ❗ Access: zamo_admin + zamo_ops only (enforced at application layer).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_zamo_dashboard AS
SELECT
  -- 1. إجمالي الإيراد المحصّل
  COALESCE((
    SELECT SUM(ce.proposed_amount)
    FROM collection_entries ce
    WHERE ce.approval_status = 'APPROVED'
  ), 0)                                                       AS total_revenue,

  -- 2. إجمالي العمولات المستحقة
  COALESCE((
    SELECT SUM(cx.commission_amount)
    FROM commission_entries cx
    WHERE cx.is_reversal = false
  ), 0)                                                       AS total_commission_due,

  -- 3. إجمالي العمولات المسددة
  COALESCE((
    SELECT SUM(p.amount)
    FROM payments p
    WHERE p.status = 'CONFIRMED'
  ), 0)                                                       AS total_commission_paid,

  -- 4. معدل التحصيل
  CASE
    WHEN (SELECT COUNT(*) FROM bookings WHERE status IN ('SERVICE_DONE','COLLECTED')) > 0
    THEN ROUND(
      100.0 * (SELECT COUNT(*) FROM bookings WHERE status = 'COLLECTED')
      / (SELECT COUNT(*) FROM bookings WHERE status IN ('SERVICE_DONE','COLLECTED')),
      1
    )
    ELSE 0
  END                                                         AS collection_rate,

  -- 5. هامش المساهمة الإجمالي
  COALESCE((
    SELECT SUM(ce.proposed_amount) FROM collection_entries ce WHERE ce.approval_status = 'APPROVED'
  ), 0)
  - COALESCE((SELECT SUM(c.budget) FROM campaigns c WHERE c.status IN ('active','ended')), 0)
  - COALESCE((
    SELECT SUM(cx.commission_amount) FROM commission_entries cx WHERE cx.is_reversal = false
  ), 0)                                                       AS total_contribution_margin,

  -- 6-7: top facilities/services — computed at application layer

  -- 8. معدل التحويل (booking → attended → service)
  CASE
    WHEN (SELECT COUNT(*) FROM bookings WHERE status != 'NEW') > 0
    THEN ROUND(
      100.0 * (SELECT COUNT(*) FROM bookings WHERE status IN ('ATTENDED','SERVICE_DONE','COLLECTED'))
      / (SELECT COUNT(*) FROM bookings WHERE status != 'NEW'),
      1
    )
    ELSE 0
  END                                                         AS conversion_rate,

  -- 9. عدد الحملات النشطة
  (SELECT COUNT(*) FROM campaigns WHERE status = 'active')    AS active_campaigns,

  -- 10. تكلفة اكتساب العميل (CAC)
  CASE
    WHEN (SELECT COUNT(DISTINCT b.patient_id)
          FROM bookings b
          JOIN attribution_touches at ON b.attribution_id = at.id
          WHERE at.channel = 'paid'
            AND b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED')) > 0
    THEN ROUND(
      (SELECT COALESCE(SUM(c.budget), 0) FROM campaigns c WHERE c.status IN ('active','ended'))::numeric
      / (SELECT COUNT(DISTINCT b.patient_id)
         FROM bookings b
         JOIN attribution_touches at ON b.attribution_id = at.id
         WHERE at.channel = 'paid'
           AND b.status IN ('ATTENDED','SERVICE_DONE','COLLECTED')),
      2
    )
    ELSE NULL
  END                                                         AS customer_acquisition_cost,

  -- 11. متوسط سرعة الاستجابة (دقائق)
  (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (b.confirmed_at - b.created_at)) / 60.0), 1)
   FROM bookings b
   WHERE b.confirmed_at IS NOT NULL)                          AS avg_response_minutes,

  -- 12. نسبة الالتزام بالـSLA
  CASE
    WHEN (SELECT COUNT(*) FROM bookings WHERE sla_deadline IS NOT NULL) > 0
    THEN ROUND(
      100.0 * (SELECT COUNT(*) FROM bookings
               WHERE confirmed_at IS NOT NULL
                 AND sla_deadline IS NOT NULL
                 AND confirmed_at <= sla_deadline)
      / (SELECT COUNT(*) FROM bookings WHERE sla_deadline IS NOT NULL),
      1
    )
    ELSE 0
  END                                                         AS sla_compliance_rate;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. SLA RESPONSE TIME REPORT — تقرير سرعة الاستجابة (ZAMO-RPT-075)
--
-- ❗ مرتبط بالخطر رقم 1 في [S2].
-- Per-facility response time analytics.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_sla_response_time AS
SELECT
  b.facility_id,
  DATE(b.created_at)                                          AS report_date,

  -- Average confirmation time (minutes)
  AVG(EXTRACT(EPOCH FROM (b.confirmed_at - b.created_at)) / 60.0)
    FILTER (WHERE b.confirmed_at IS NOT NULL)
                                                              AS avg_confirmation_minutes,

  -- Median (p50) — using percentile_cont
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (b.confirmed_at - b.created_at)) / 60.0
  ) FILTER (WHERE b.confirmed_at IS NOT NULL)
                                                              AS median_confirmation_minutes,

  -- p95
  PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (b.confirmed_at - b.created_at)) / 60.0
  ) FILTER (WHERE b.confirmed_at IS NOT NULL)
                                                              AS p95_confirmation_minutes,

  -- SLA compliance
  COUNT(*) FILTER (WHERE b.sla_deadline IS NOT NULL)          AS total_with_sla,
  COUNT(*) FILTER (WHERE b.confirmed_at IS NOT NULL
    AND b.sla_deadline IS NOT NULL
    AND b.confirmed_at <= b.sla_deadline)                     AS confirmed_within_sla,
  COUNT(*) FILTER (WHERE b.is_late = true)                    AS late_confirmations,

  CASE
    WHEN COUNT(*) FILTER (WHERE b.sla_deadline IS NOT NULL) > 0
    THEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE b.confirmed_at IS NOT NULL
        AND b.sla_deadline IS NOT NULL
        AND b.confirmed_at <= b.sla_deadline)
      / COUNT(*) FILTER (WHERE b.sla_deadline IS NOT NULL),
      1
    )
    ELSE 0
  END                                                         AS sla_compliance_rate,

  -- Rejection rate
  COUNT(*)                                                    AS total_bookings,
  COUNT(*) FILTER (WHERE b.status = 'REJECTED')               AS rejected_count,
  CASE
    WHEN COUNT(*) > 0
    THEN ROUND(100.0 * COUNT(*) FILTER (WHERE b.status = 'REJECTED') / COUNT(*), 1)
    ELSE 0
  END                                                         AS rejection_rate

FROM bookings b
WHERE b.status != 'NEW'
GROUP BY b.facility_id, DATE(b.created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. FINANCIAL RECONCILIATION — التقارير المالية (ZAMO-RPT-076)
--
-- ❗ تطابق تقرير العمولة مع الفواتير.
-- ❗ تطابق المجاميع مع قيود التسوية.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_financial_reconciliation AS
SELECT
  bp.id                                  AS billing_period_id,
  bp.facility_id,
  bp.period_key,
  bp.starts_at                           AS period_start,
  bp.ends_at                             AS period_end,
  bp.status                              AS period_status,

  -- Commission entries in this period
  COALESCE(cx_agg.entry_count, 0)       AS commission_entry_count,
  COALESCE(cx_agg.total_net, 0)         AS commission_total_net,
  COALESCE(cx_agg.total_vat, 0)         AS commission_total_vat,
  COALESCE(cx_agg.total_gross, 0)       AS commission_total_gross,

  -- Invoice linked to this period
  i.id                                  AS invoice_id,
  i.invoice_number,
  i.status                              AS invoice_status,
  COALESCE(il_agg.line_item_count, 0)   AS invoice_line_count,
  COALESCE(i.total_commission, 0)       AS invoice_commission,
  COALESCE(i.total_vat, 0)             AS invoice_vat,
  COALESCE(i.grand_total, 0)           AS invoice_total,

  -- Payments
  COALESCE(p_agg.paid_amount, 0)        AS total_paid,

  -- ❗ Reconciliation checks
  CASE
    WHEN cx_agg.entry_count IS NOT NULL AND il_agg.line_item_count IS NOT NULL
    THEN cx_agg.entry_count = il_agg.line_item_count
    ELSE NULL
  END                                   AS entries_match_invoice,

  CASE
    WHEN cx_agg.total_gross IS NOT NULL AND i.grand_total IS NOT NULL
    THEN ABS(cx_agg.total_gross - i.grand_total) < 0.01
    ELSE NULL
  END                                   AS amounts_match

FROM billing_periods bp
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)           AS entry_count,
    SUM(cx.commission_amount) AS total_net,
    SUM(cx.vat_amount) AS total_vat,
    SUM(cx.total_with_vat) AS total_gross
  FROM commission_entries cx
  WHERE cx.billing_period_id = bp.id
) cx_agg ON true
LEFT JOIN invoices i ON i.billing_period_id = bp.id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS line_item_count
  FROM invoice_line_items il
  WHERE il.invoice_id = i.id
) il_agg ON true
LEFT JOIN LATERAL (
  SELECT SUM(p.amount) AS paid_amount
  FROM payments p
  WHERE p.invoice_id = i.id
    AND p.status = 'CONFIRMED'
) p_agg ON true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. RLS Policies for attribution_touches and campaigns
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE attribution_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Attribution: zamo_admin sees all, facility staff sees touches linked to their facility's bookings
CREATE POLICY attr_zamo_admin ON attribution_touches
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY attr_facility_read ON attribution_touches
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.attribution_id = attribution_touches.id
        AND b.facility_id = current_setting('app.facility_id', true)::uuid
    )
  );

-- Campaigns: zamo_admin full access, facility sees their own
CREATE POLICY camp_zamo_admin ON campaigns
  FOR ALL
  USING (
    current_setting('app.role', true) IN ('zamo_admin', 'zamo_ops')
  );

CREATE POLICY camp_facility_read ON campaigns
  FOR SELECT
  USING (
    facility_id = current_setting('app.facility_id', true)::uuid
  );
