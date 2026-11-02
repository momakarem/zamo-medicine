-- ZAMO-AUDIT-004 :: rollback
--
-- The immutability triggers must be dropped before the table, otherwise the
-- BEFORE TRUNCATE/DELETE guards would block the teardown itself.

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
DROP FUNCTION IF EXISTS zamo_audit_log_is_append_only();
DROP TABLE IF EXISTS audit_log;
