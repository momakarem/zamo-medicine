-- ZAMO-AUTH-007 :: OTP storage for patient authentication
--
-- Patients authenticate with phone + OTP only (A-33: no password).
-- This table tracks OTP requests, enforces rate limits, and prevents reuse.
--
-- Hard constraint: OTP codes are stored as hashes (never plain text).
-- The application uses the OTP_PEPPER from env to produce the hash.

CREATE TABLE otp_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL,
  -- SHA-256(code + pepper). Never store the raw OTP.
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  used          boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Look up recent OTPs by phone for rate limiting.
CREATE INDEX otp_requests_phone_created_idx ON otp_requests (phone, created_at DESC);

-- Cleanup index: delete expired OTPs periodically.
CREATE INDEX otp_requests_expires_idx ON otp_requests (expires_at) WHERE NOT used;

GRANT SELECT, INSERT, UPDATE ON otp_requests TO zamo_app;
