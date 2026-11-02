-- ZAMO-AUDIT-004 :: tamper-evident audit log
--
-- Implements approved decision A-46: "سجل غير قابل للمحو للتعديلات المالية"
-- (an indelible record of financial changes).
--
-- Built BEFORE any financial module (DEC-013) so that no money-touching code
-- can ever exist without a place to record what it did.
--
-- Immutability is enforced by the DATABASE, not by application discipline:
-- UPDATE and DELETE are rejected by triggers that fire for every role,
-- including the table owner. Application code cannot opt out.

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),

  -- WHO
  actor_user_id uuid,                  -- NULL for system/scheduled actions
  actor_role    text,
  actor_ip      text,
  request_id    text,

  -- WHAT
  action        text NOT NULL CHECK (length(btrim(action)) > 0),
  entity_type   text NOT NULL,
  entity_id     text,

  -- SCOPE (lets an auditor filter to one facility without a join)
  facility_id   uuid,
  branch_id     uuid,

  -- BEFORE / AFTER — the evidence itself
  before_state  jsonb,
  after_state   jsonb,

  -- WHY: mandatory for the actions the approved decisions require a reason for
  -- (A-21: Zamo may not change a confirmed booking without a recorded reason).
  reason        text,

  -- Financial entries are singled out because A-46 names them explicitly.
  is_financial  boolean NOT NULL DEFAULT false
);

CREATE INDEX audit_log_occurred_idx  ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor_idx     ON audit_log (actor_user_id);
CREATE INDEX audit_log_entity_idx    ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_facility_idx  ON audit_log (facility_id);
CREATE INDEX audit_log_financial_idx ON audit_log (is_financial) WHERE is_financial;

-- ---------------------------------------------------------------------------
-- Immutability triggers.
--
-- A BEFORE trigger that raises is the strongest guarantee available here: it
-- fires for every caller, cannot be bypassed by application code, and does not
-- depend on which role happens to be connected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zamo_audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only: % is forbidden (approved decision A-46)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION zamo_audit_log_is_append_only();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION zamo_audit_log_is_append_only();

-- TRUNCATE bypasses row-level triggers, so it is blocked separately.
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION zamo_audit_log_is_append_only();

-- ---------------------------------------------------------------------------
-- Privileges: the application role may only append and read.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON audit_log TO zamo_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO zamo_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM zamo_app;
