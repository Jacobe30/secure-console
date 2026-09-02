BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000
    CHECK (password_iterations >= 100000),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email = LOWER(email)),
  CHECK (char_length(email) BETWEEN 3 AND 254),
  CHECK (char_length(display_name) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_unique_idx
  ON admin_users (LOWER(email));

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_sessions_user_expiry_idx
  ON admin_sessions (admin_user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx
  ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  customer_name TEXT NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 120),
  customer_email TEXT NOT NULL CHECK (char_length(customer_email) BETWEEN 3 AND 254),
  customer_phone TEXT CHECK (customer_phone IS NULL OR char_length(customer_phone) <= 32),
  insurance_type TEXT CHECK (insurance_type IS NULL OR char_length(insurance_type) <= 60),
  vehicle_year INTEGER CHECK (vehicle_year IS NULL OR vehicle_year BETWEEN 1990 AND 2100),
  vehicle_make_model TEXT CHECK (vehicle_make_model IS NULL OR char_length(vehicle_make_model) <= 160),
  vehicle_value NUMERIC(14, 2) CHECK (vehicle_value IS NULL OR vehicle_value >= 0),
  usage_purpose TEXT CHECK (usage_purpose IS NULL OR char_length(usage_purpose) <= 100),
  policy_start_date DATE,
  repair_location TEXT CHECK (repair_location IS NULL OR char_length(repair_location) <= 80),
  selected_offer JSONB,
  internal_note TEXT CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000),
  reviewed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (customer_email = LOWER(customer_email)),
  CHECK (selected_offer IS NULL OR jsonb_typeof(selected_offer) = 'object')
);

CREATE INDEX IF NOT EXISTS quote_requests_status_created_idx
  ON quote_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS quote_requests_updated_idx
  ON quote_requests (updated_at DESC);

CREATE INDEX IF NOT EXISTS quote_requests_name_search_idx
  ON quote_requests (LOWER(customer_name));

CREATE INDEX IF NOT EXISTS quote_requests_email_search_idx
  ON quote_requests (LOWER(customer_email));

CREATE TABLE IF NOT EXISTS quote_activity (
  id BIGSERIAL PRIMARY KEY,
  quote_request_id UUID NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('public', 'admin', 'system')),
  admin_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  details JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (actor_type = 'admin' AND admin_user_id IS NOT NULL)
    OR (actor_type <> 'admin')
  )
);

CREATE INDEX IF NOT EXISTS quote_activity_request_time_idx
  ON quote_activity (quote_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS quote_activity_admin_time_idx
  ON quote_activity (admin_user_id, created_at DESC)
  WHERE admin_user_id IS NOT NULL;

COMMIT;
