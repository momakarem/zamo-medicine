-- Rollback ZAMO-GROW-071..072, ZAMO-RPT-073..076

-- Drop views (reverse order)
DROP VIEW IF EXISTS v_financial_reconciliation;
DROP VIEW IF EXISTS v_sla_response_time;
DROP VIEW IF EXISTS v_zamo_dashboard;
DROP VIEW IF EXISTS v_facility_campaigns_report;
DROP VIEW IF EXISTS v_facility_offers_report;
DROP VIEW IF EXISTS v_facility_sla_report;
DROP VIEW IF EXISTS v_facility_cancellations_report;
DROP VIEW IF EXISTS v_facility_branches_report;
DROP VIEW IF EXISTS v_facility_doctors_report;
DROP VIEW IF EXISTS v_facility_commission_report;
DROP VIEW IF EXISTS v_facility_revenue_report;
DROP VIEW IF EXISTS v_facility_services_report;
DROP VIEW IF EXISTS v_facility_attendance_report;
DROP VIEW IF EXISTS v_facility_bookings_report;
DROP VIEW IF EXISTS campaign_stats_view;

-- Drop RLS policies
DROP POLICY IF EXISTS camp_facility_read ON campaigns;
DROP POLICY IF EXISTS camp_zamo_admin ON campaigns;
DROP POLICY IF EXISTS attr_facility_read ON attribution_touches;
DROP POLICY IF EXISTS attr_zamo_admin ON attribution_touches;

-- Drop column from bookings
ALTER TABLE bookings DROP COLUMN IF EXISTS attribution_id;

-- Drop tables
DROP TABLE IF EXISTS offers;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS attribution_touches;
