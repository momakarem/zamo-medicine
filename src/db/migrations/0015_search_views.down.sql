-- Rollback for 0015_search_views.up.sql

DROP TABLE IF EXISTS legal_pages;

DROP INDEX IF EXISTS idx_doctor_branches_active;
DROP INDEX IF EXISTS idx_prices_active_current;
DROP INDEX IF EXISTS idx_branch_services_branch_active;
DROP INDEX IF EXISTS idx_doctors_specialty_active;

DROP VIEW IF EXISTS public_facilities_v;
DROP VIEW IF EXISTS public_branches_v;
DROP VIEW IF EXISTS public_doctors_v;

ALTER TABLE facilities DROP COLUMN IF EXISTS description_en;
ALTER TABLE facilities DROP COLUMN IF EXISTS description_ar;
ALTER TABLE facilities DROP COLUMN IF EXISTS logo_url;
