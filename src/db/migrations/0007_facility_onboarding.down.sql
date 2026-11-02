-- ZAMO-FAC-011 :: rollback facility onboarding
DROP POLICY IF EXISTS fac_app_submitter ON facility_applications;
DROP POLICY IF EXISTS fac_app_admin_all ON facility_applications;
DROP TRIGGER IF EXISTS facility_applications_touch ON facility_applications;
DROP TABLE IF EXISTS facility_applications;
