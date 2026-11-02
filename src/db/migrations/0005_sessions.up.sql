-- ZAMO-AUTH-009 :: session storage
--
-- Sessions are server-side (opaque tokens). Token hash is stored, never
-- the raw token. TTL is role-dependent (A-47):
--   patient  → 7 days
--   staff    → 8 hours
--   admin    → 30 minutes

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  role_code     text NOT NULL REFERENCES roles(code),
  facility_id   uuid REFERENCES facilities(id),
  branch_id     uuid REFERENCES branches(id),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_active   timestamptz NOT NULL DEFAULT now(),

  -- Branch-scoped session must specify facility
  CONSTRAINT sessions_branch_implies_facility
    CHECK (branch_id IS NULL OR facility_id IS NOT NULL)
);

-- Look up sessions by token hash (primary auth path).
CREATE INDEX sessions_token_hash_idx ON sessions (token_hash) WHERE revoked_at IS NULL;

-- Look up all sessions for a user (revoke all, list active).
CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);

-- Cleanup: find expired sessions.
CREATE INDEX sessions_expires_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON sessions TO zamo_app;
