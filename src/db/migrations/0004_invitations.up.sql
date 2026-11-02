-- ZAMO-AUTH-008 :: MFA secrets + invitations
--
-- Implements:
--  A-43: MFA mandatory for Zamo administration
--  [S2]: MFA optionally enforced by facility manager
--  DEC-009: Invitation system (phone + email + role + branch)

CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL,
  role_code    text NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
  facility_id  uuid REFERENCES facilities(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES branches(id) ON DELETE CASCADE,
  invited_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone        text,
  email        text,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Must have at least one contact method.
  CONSTRAINT invitations_need_contact CHECK (phone IS NOT NULL OR email IS NOT NULL),

  -- Branch-scoped invitations must specify a facility.
  CONSTRAINT invitations_branch_implies_facility
    CHECK (branch_id IS NULL OR facility_id IS NOT NULL)
);

CREATE INDEX invitations_token_idx ON invitations (token_hash);
CREATE INDEX invitations_phone_idx ON invitations (phone) WHERE phone IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON invitations TO zamo_app;
