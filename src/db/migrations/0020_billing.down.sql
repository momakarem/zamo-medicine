-- Rollback for 0020_billing

-- Drop triggers first
DROP TRIGGER IF EXISTS deny_delete_financial_audit ON audit_log;
DROP TRIGGER IF EXISTS deny_update_financial_audit ON audit_log;
DROP FUNCTION IF EXISTS deny_financial_audit_modification();

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS patient_objections CASCADE;
DROP TABLE IF EXISTS dispute_evidence CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invoice_line_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS billing_periods CASCADE;
DROP TABLE IF EXISTS commission_entries CASCADE;
DROP TABLE IF EXISTS commission_rules CASCADE;
