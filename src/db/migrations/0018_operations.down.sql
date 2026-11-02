-- Rollback for 0018_operations.up.sql

-- Drop grants
REVOKE SELECT, INSERT ON value_approvals FROM zamo_app;
REVOKE SELECT, INSERT, UPDATE ON collection_entries FROM zamo_app;
REVOKE SELECT, INSERT, UPDATE ON performed_services FROM zamo_app;
REVOKE SELECT, INSERT, UPDATE ON attendance FROM zamo_app;

-- Drop tables (reverse order due to FK dependencies)
DROP TABLE IF EXISTS value_approvals CASCADE;
DROP TABLE IF EXISTS collection_entries CASCADE;
DROP TABLE IF EXISTS performed_services CASCADE;
DROP TABLE IF EXISTS attendance CASCADE;
