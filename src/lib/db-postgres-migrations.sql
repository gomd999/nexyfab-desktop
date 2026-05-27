-- ============================================================================
-- NexyFab PostgreSQL Schema
-- All tables consolidated from SQLite schema (db.ts) + JSON file structures
-- ============================================================================

-- Schema migrations tracking
CREATE TABLE IF NOT EXISTS nf_schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at BIGINT  NOT NULL
);

-- ─── Core Auth & User ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nf_users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  password_hash         TEXT,
  plan                  TEXT NOT NULL DEFAULT 'free',
  email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  project_count         INTEGER NOT NULL DEFAULT 0,
  created_at            BIGINT NOT NULL,
  -- migration v6: account lockout
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until          BIGINT,
  -- migration v7: TOTP 2FA
  totp_secret           TEXT,
  totp_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  -- migration v30: avatar
  avatar_url            TEXT,
  -- migration v31: profile fields
  language              TEXT,
  country               TEXT,
  timezone              TEXT,
  phone                 TEXT,
  company               TEXT,
  job_title             TEXT,
  signup_source         TEXT,
  last_login_at         BIGINT,
  login_count           INTEGER NOT NULL DEFAULT 0,
  signup_ip             TEXT,
  last_login_ip         TEXT,
  -- v33: 통합 회원 서비스 태깅
  services              TEXT NOT NULL DEFAULT '["nexyfab"]',
  signup_service        TEXT DEFAULT 'nexyfab',
  nexyfab_plan          TEXT,
  nexyflow_plan         TEXT NOT NULL DEFAULT 'free',
  oauth_provider        TEXT,
  oauth_id              TEXT,
  account_type          TEXT DEFAULT 'personal',
  business_reg_number   TEXT,
  industry              TEXT,
  employee_size         TEXT,
  terms_agreed_at       BIGINT,
  privacy_agreed_at     BIGINT,
  age_confirmed         BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_agreed      BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_agreed_at   BIGINT,
  updated_at            BIGINT
);

CREATE TABLE IF NOT EXISTS nf_refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON nf_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON nf_refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS nf_password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_hash ON nf_password_reset_tokens(token_hash);

CREATE TABLE IF NOT EXISTS nf_verification_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS nf_sso_config (
  org_id      TEXT PRIMARY KEY,
  provider    TEXT,
  entity_id   TEXT,
  sso_url     TEXT,
  certificate TEXT,
  client_id   TEXT,
  issuer      TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  BIGINT NOT NULL
);

-- ─── Projects & 3D ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nf_projects (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  shape_id    TEXT,
  material_id TEXT,
  scene_data  TEXT,
  thumbnail   TEXT,
  tags        TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON nf_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON nf_projects(user_id, updated_at);

CREATE TABLE IF NOT EXISTS nf_shares (
  token            TEXT PRIMARY KEY,
  user_id          TEXT,
  mesh_data_base64 TEXT NOT NULL,
  metadata         TEXT,
  expires_at       BIGINT NOT NULL,
  view_count       INTEGER NOT NULL DEFAULT 0,
  created_at       BIGINT NOT NULL,
  -- migration v8: share versioning
  version          INTEGER NOT NULL DEFAULT 1,
  model_name       TEXT
);
CREATE INDEX IF NOT EXISTS idx_shares_token ON nf_shares(token);
CREATE INDEX IF NOT EXISTS idx_shares_user_model ON nf_shares(user_id, model_name);

CREATE TABLE IF NOT EXISTS nf_comments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  position    TEXT NOT NULL,
  text        TEXT NOT NULL,
  author      TEXT NOT NULL,
  author_plan TEXT,
  type        TEXT NOT NULL DEFAULT 'comment',
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON nf_comments(project_id);

-- ─── RFQ & Orders ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nf_rfqs (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  user_email        TEXT,
  shape_id          TEXT,
  shape_name        TEXT,
  material_id       TEXT,
  quantity          INTEGER DEFAULT 1,
  volume_cm3        DOUBLE PRECISION,
  surface_area_cm2  DOUBLE PRECISION,
  bbox              TEXT,
  dfm_results       TEXT,
  cost_estimates    TEXT,
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  quote_amount      DOUBLE PRECISION,
  manufacturer_note TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rfqs_user ON nf_rfqs(user_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_user_created ON nf_rfqs(user_id, created_at);

CREATE TABLE IF NOT EXISTS nf_orders (
  id                    TEXT PRIMARY KEY,
  rfq_id                TEXT,
  user_id               TEXT NOT NULL,
  part_name             TEXT NOT NULL,
  manufacturer_name     TEXT NOT NULL,
  quantity              INTEGER NOT NULL DEFAULT 1,
  total_price_krw       DOUBLE PRECISION NOT NULL,
  status                TEXT NOT NULL DEFAULT 'placed',
  steps                 TEXT NOT NULL,
  created_at            BIGINT NOT NULL,
  estimated_delivery_at BIGINT NOT NULL
);

-- ─── Collaboration ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nf_collab_sessions (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  user_name  TEXT NOT NULL,
  cursor     TEXT,
  color      TEXT NOT NULL,
  last_ping  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_project ON nf_collab_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_collab_updated ON nf_collab_sessions(last_ping);

-- ─── Audit Log ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nf_audit_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  resource_id TEXT,
  metadata    TEXT,
  ip          TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON nf_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON nf_audit_log(user_id, created_at);

-- ─── Stripe Webhooks ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nf_webhook_events (
  id              TEXT PRIMARY KEY,
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type      TEXT NOT NULL,
  processed_at    BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON nf_webhook_events(stripe_event_id);

-- ============================================================================
-- Tables migrated from JSON files (adminlink/ and data/)
-- ============================================================================

-- ─── Inquiries (from adminlink/inquiries.json) ───────────────────────────
-- Stores both customer inquiries and partner registrations

CREATE TABLE IF NOT EXISTS nf_inquiries (
  id           TEXT PRIMARY KEY,
  action       TEXT NOT NULL DEFAULT 'send_contact',  -- 'send_contact' | 'send_partner_register'
  name         TEXT,
  email        TEXT,
  phone        TEXT,
  company      TEXT,
  project_name TEXT,
  budget       TEXT,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'contacted' | 'closed'
  admin_note   TEXT,
  rfq_id       TEXT,
  shape_id     TEXT,
  material_id  TEXT,
  volume_cm3   DOUBLE PRECISION,
  date         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_inquiries_email ON nf_inquiries(email);
CREATE INDEX IF NOT EXISTS idx_inquiries_action ON nf_inquiries(action);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON nf_inquiries(status);

-- ─── Contracts (from data/contracts.json via src/app/lib/db.ts) ──────────
-- The existing SQLite contracts table stores data as JSON blob.
-- This is the fully normalized version.

CREATE TABLE IF NOT EXISTS nf_contracts (
  id                     TEXT PRIMARY KEY,
  project_name           TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'contracted',  -- contracted | in_progress | quality_check | delivered | completed | cancelled
  partner_email          TEXT,
  factory_name           TEXT,
  deadline               TEXT,
  contract_amount        DOUBLE PRECISION,
  commission_rate        DOUBLE PRECISION,
  base_commission_rate   DOUBLE PRECISION,
  gross_commission       DOUBLE PRECISION,
  plan_deduction         DOUBLE PRECISION,
  final_charge           DOUBLE PRECISION,
  is_first_contract      BOOLEAN DEFAULT FALSE,
  first_contract_discount DOUBLE PRECISION DEFAULT 0,
  commission_status      TEXT,
  completed_at           TEXT,
  completion_requested   BOOLEAN DEFAULT FALSE,
  completion_requested_at TEXT,
  customer_email         TEXT,
  customer_contact       TEXT,  -- JSON: { name, email, phone }
  quote_id               TEXT,
  plan                   TEXT,
  progress_percent       INTEGER DEFAULT 0,
  progress_notes         TEXT,  -- JSON array: [{ date, note, updatedBy }]
  created_at             TEXT NOT NULL,
  updated_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_contracts_partner ON nf_contracts(partner_email);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON nf_contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON nf_contracts(customer_email);

-- ─── Quotes (from data/quotes.json) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS nf_quotes (
  id               TEXT PRIMARY KEY,
  inquiry_id       TEXT,
  project_name     TEXT NOT NULL,
  factory_name     TEXT,
  estimated_amount DOUBLE PRECISION NOT NULL,
  details          TEXT,
  valid_until      TEXT,  -- ISO date string (YYYY-MM-DD)
  partner_email    TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected | expired
  created_at       TEXT NOT NULL,
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_quotes_inquiry ON nf_quotes(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_quotes_partner ON nf_quotes(partner_email);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON nf_quotes(status);

-- ─── Settlements (from data/settlements.json) ───────────────────────────

CREATE TABLE IF NOT EXISTS nf_settlements (
  id                     TEXT PRIMARY KEY,
  contract_id            TEXT NOT NULL,
  project_name           TEXT NOT NULL,
  factory_name           TEXT,
  contract_amount        DOUBLE PRECISION NOT NULL DEFAULT 0,
  commission_rate        DOUBLE PRECISION NOT NULL DEFAULT 0,
  gross_commission       DOUBLE PRECISION NOT NULL DEFAULT 0,
  plan_deduction         DOUBLE PRECISION NOT NULL DEFAULT 0,
  final_charge           DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_first_contract      BOOLEAN DEFAULT FALSE,
  first_contract_discount DOUBLE PRECISION DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'pending',  -- pending | invoiced | paid
  invoice_number         TEXT,
  invoiced_at            TEXT,
  paid_at                TEXT,
  notes                  TEXT,
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_settlements_contract ON nf_settlements(contract_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON nf_settlements(status);

-- ─── Partner Sessions (from adminlink/partner-sessions.json) ─────────────
-- Key-value: session_token_hash -> { partnerId, email, company, expiresAt }

CREATE TABLE IF NOT EXISTS nf_partner_sessions (
  token_hash TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  email      TEXT NOT NULL,
  company    TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partner_sessions_email ON nf_partner_sessions(email);

-- ─── Partner Tokens (from adminlink/partner-tokens.json) ─────────────────
-- Login codes sent to partner emails

CREATE TABLE IF NOT EXISTS nf_partner_tokens (
  id         TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  email      TEXT NOT NULL,
  company    TEXT,
  token      TEXT NOT NULL,  -- 6-digit code
  expires_at TEXT NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_partner_tokens_email ON nf_partner_tokens(email);

-- ─── Partner Statuses (from adminlink/partners-status.json) ──────────────
-- Key-value: partner_id -> { status, note, reviewedAt }

CREATE TABLE IF NOT EXISTS nf_partner_statuses (
  partner_id  TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  note        TEXT,
  reviewed_at TEXT
);

-- ─── Reviews (from adminlink/reviews.json) ───────────────────────────────

CREATE TABLE IF NOT EXISTS nf_reviews_data (
  id             TEXT PRIMARY KEY,
  contract_id    TEXT NOT NULL,
  partner_email  TEXT NOT NULL,
  rating         INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  cat_deadline   INTEGER,  -- category score 1-5
  cat_quality    INTEGER,  -- category score 1-5
  cat_communication INTEGER,  -- category score 1-5
  comment        TEXT,
  reviewed_at    TEXT NOT NULL,
  reviewer_email TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_partner ON nf_reviews_data(partner_email);
CREATE INDEX IF NOT EXISTS idx_reviews_contract ON nf_reviews_data(contract_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_contract_unique ON nf_reviews_data(contract_id);

-- ─── Messages (from data/messages.json via src/app/lib/db.ts) ────────────
-- Already in SQLite as 'messages' table, renaming with nf_ prefix

CREATE TABLE IF NOT EXISTS nf_messages (
  id          TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  sender      TEXT NOT NULL,
  sender_type TEXT NOT NULL,  -- 'admin' | 'partner' | 'customer'
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_contract ON nf_messages(contract_id);

-- ─── Notifications ─────────────────────────────────────────────────────────
-- Runtime SQL uses the adapter-backed SQLite-compatible shape:
-- user_id/body/link/read(integer)/created_at(bigint).

CREATE TABLE IF NOT EXISTS nf_notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON nf_notifications(user_id, read, created_at);

-- Backfill older Postgres installs that had recipient/message columns.
ALTER TABLE nf_notifications ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE nf_notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE nf_notifications ADD COLUMN IF NOT EXISTS link TEXT;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nf_notifications' AND column_name = 'recipient'
  ) THEN
    UPDATE nf_notifications SET user_id = COALESCE(user_id, recipient);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nf_notifications' AND column_name = 'message'
  ) THEN
    UPDATE nf_notifications SET body = COALESCE(body, message);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nf_notifications' AND column_name = 'read' AND data_type = 'boolean'
  ) THEN
    ALTER TABLE nf_notifications ALTER COLUMN read TYPE INTEGER USING CASE WHEN read THEN 1 ELSE 0 END;
  END IF;
END $$;

-- ─── Job Queue ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_job_queue (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error        TEXT,
  scheduled_at BIGINT NOT NULL,
  processed_at BIGINT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_queue_status ON nf_job_queue(status, scheduled_at);

-- ─── Teams & RBAC ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'team',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS nf_team_members (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES nf_teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'viewer',
  invited_by TEXT NOT NULL,
  joined_at  BIGINT,
  created_at BIGINT NOT NULL,
  UNIQUE(team_id, user_id)
);
CREATE TABLE IF NOT EXISTS nf_team_invites (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'viewer',
  token      TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(token)
);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON nf_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON nf_team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_invites_token ON nf_team_invites(token);

-- ─── BOM (Bill of Materials) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_bom (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  team_id     TEXT,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS nf_bom_items (
  id          TEXT PRIMARY KEY,
  bom_id      TEXT NOT NULL REFERENCES nf_bom(id) ON DELETE CASCADE,
  parent_id   TEXT,
  part_number TEXT,
  name        TEXT NOT NULL,
  description TEXT,
  material_id TEXT,
  process     TEXT,
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit        TEXT NOT NULL DEFAULT 'ea',
  unit_cost   INTEGER,
  notes       TEXT,
  level       INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bom_user ON nf_bom(user_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON nf_bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_parent ON nf_bom_items(parent_id);

-- ─── Contract Milestones ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_contract_milestones (
  id           TEXT PRIMARY KEY,
  contract_id  TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  photo_url    TEXT,
  completed_by TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  due_date     TEXT,
  completed_at BIGINT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_contract ON nf_contract_milestones(contract_id);

-- ─── Outbound Webhooks & Slack ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_webhook_subscriptions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  url               TEXT NOT NULL,
  secret            TEXT NOT NULL,
  events            TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'active',
  description       TEXT,
  last_triggered_at BIGINT,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_user ON nf_webhook_subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS nf_slack_integrations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  channel     TEXT,
  events      TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  UNIQUE(user_id)
);

-- ─── API Keys ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  scopes       TEXT NOT NULL DEFAULT '[]',
  ip_whitelist TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'active',
  last_used_at BIGINT,
  expires_at   BIGINT,
  created_at   BIGINT NOT NULL,
  UNIQUE(key_hash),
  UNIQUE(key_prefix)
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON nf_api_keys(user_id, status);

-- ─── Shipments (v17) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_shipments (
  id                TEXT PRIMARY KEY,
  contract_id       TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  carrier           TEXT NOT NULL DEFAULT 'unknown',
  tracking_number   TEXT NOT NULL,
  label             TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  last_status_text  TEXT,
  events            TEXT NOT NULL DEFAULT '[]',
  estimated_delivery TEXT,
  delivered_at      BIGINT,
  last_checked_at   BIGINT,
  created_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shipments_contract ON nf_shipments(contract_id);
CREATE INDEX IF NOT EXISTS idx_shipments_user ON nf_shipments(user_id);

-- ─── ERP Connector (v18) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_erp_sync_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  direction    TEXT NOT NULL,
  format       TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ok',
  error        TEXT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_erp_sync_user ON nf_erp_sync_log(user_id, created_at);

CREATE TABLE IF NOT EXISTS nf_erp_field_mappings (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  mappings   TEXT NOT NULL DEFAULT '{}',
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id)
);

-- ─── ESG Reports (v19) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_esg_reports (
  id          TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  inputs      TEXT NOT NULL,
  results     TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_esg_contract ON nf_esg_reports(contract_id, user_id);

-- ─── NexyFlow Integration (v20) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_nexyflow_integrations (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL,
  nexyflow_url           TEXT NOT NULL,
  access_token           TEXT NOT NULL,
  sync_tasks             SMALLINT NOT NULL DEFAULT 1,
  sync_calendar          SMALLINT NOT NULL DEFAULT 1,
  sync_approvals         SMALLINT NOT NULL DEFAULT 0,
  approval_threshold_krw INTEGER NOT NULL DEFAULT 1000000,
  status                 TEXT NOT NULL DEFAULT 'active',
  last_tested_at         BIGINT,
  created_at             BIGINT NOT NULL,
  updated_at             BIGINT NOT NULL,
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS nf_nexyflow_sync_map (
  id           TEXT PRIMARY KEY,
  nexyfab_type TEXT NOT NULL,
  nexyfab_id   TEXT NOT NULL,
  nexyflow_id  TEXT,
  user_id      TEXT NOT NULL,
  synced_at    BIGINT NOT NULL,
  UNIQUE(nexyfab_type, nexyfab_id, user_id)
);

-- ─── RFQ 3D Fields (v21) ────────────────────────────────────────────────────
ALTER TABLE nf_rfqs ADD COLUMN IF NOT EXISTS shape_share_token TEXT;
ALTER TABLE nf_rfqs ADD COLUMN IF NOT EXISTS dfm_score INTEGER;
ALTER TABLE nf_rfqs ADD COLUMN IF NOT EXISTS dfm_process TEXT;
CREATE INDEX IF NOT EXISTS idx_rfqs_share_token ON nf_rfqs(shape_share_token);

-- ─── Airwallex Billing (v22) ─────────────────────────────────────────────────

-- Airwallex customer mapping
CREATE TABLE IF NOT EXISTS nf_aw_customers (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  aw_customer_id TEXT NOT NULL,
  created_at     BIGINT NOT NULL,
  UNIQUE(user_id),
  UNIQUE(aw_customer_id)
);

-- Airwallex subscriptions
CREATE TABLE IF NOT EXISTS nf_aw_subscriptions (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  product              TEXT NOT NULL,
  aw_subscription_id   TEXT NOT NULL,
  aw_customer_id       TEXT NOT NULL,
  plan                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active',
  current_period_start BIGINT NOT NULL,
  current_period_end   BIGINT NOT NULL,
  cancelled_at         BIGINT,
  created_at           BIGINT NOT NULL,
  updated_at           BIGINT NOT NULL,
  UNIQUE(aw_subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_aw_subs_user ON nf_aw_subscriptions(user_id, status);

-- Airwallex invoices
CREATE TABLE IF NOT EXISTS nf_aw_invoices (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  product          TEXT NOT NULL,
  aw_invoice_id    TEXT NOT NULL,
  aw_customer_id   TEXT NOT NULL,
  plan             TEXT NOT NULL,
  base_amount_krw  INTEGER NOT NULL DEFAULT 0,
  usage_amount_krw INTEGER NOT NULL DEFAULT 0,
  total_amount_krw INTEGER NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'KRW',
  status           TEXT NOT NULL DEFAULT 'open',
  description      TEXT,
  paid_at          BIGINT,
  created_at       BIGINT NOT NULL,
  UNIQUE(aw_invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_aw_inv_user ON nf_aw_invoices(user_id, created_at);

-- Payment attempts with smart retry
CREATE TABLE IF NOT EXISTS nf_aw_payment_attempts (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES nf_aw_invoices(id),
  user_id        TEXT NOT NULL,
  aw_intent_id   TEXT,
  status         TEXT NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  error_message  TEXT,
  next_retry_at  BIGINT,
  attempted_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aw_retry ON nf_aw_payment_attempts(status, next_retry_at);

-- Usage events (per product, per billing cycle)
CREATE TABLE IF NOT EXISTS nf_usage_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  product     TEXT NOT NULL,
  metric      TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  cycle_start BIGINT NOT NULL,
  metadata    TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_cycle  ON nf_usage_events(user_id, product, cycle_start);
CREATE INDEX IF NOT EXISTS idx_usage_metric ON nf_usage_events(user_id, metric, cycle_start);

-- AI feature output history (Cost Copilot, Process Router, Supplier Matcher, DFM Explainer)
CREATE TABLE IF NOT EXISTS nf_ai_history (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  feature     TEXT NOT NULL,
  project_id  TEXT,
  title       TEXT NOT NULL,
  payload     TEXT NOT NULL,
  context     TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_history_user    ON nf_ai_history(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_history_feature ON nf_ai_history(user_id, feature, created_at);

-- BI analytics: all Airwallex API responses + billing events
CREATE TABLE IF NOT EXISTS nf_billing_analytics (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  product     TEXT NOT NULL,
  invoice_id  TEXT,
  payload     JSONB NOT NULL DEFAULT '{}',
  recorded_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_analytics_event ON nf_billing_analytics(event_type, recorded_at);
CREATE INDEX IF NOT EXISTS idx_billing_analytics_user  ON nf_billing_analytics(user_id, recorded_at);

-- Add Airwallex customer ID to users
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS aw_customer_id TEXT;

-- ─── Country Billing (v23) ───────────────────────────────────────────────────

-- 한국 전자세금계산서
CREATE TABLE IF NOT EXISTS nf_tax_invoices_kr (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES nf_aw_invoices(id),
  user_id           TEXT NOT NULL,
  mgt_key           TEXT NOT NULL,
  buyer_biz_reg_no  TEXT NOT NULL,
  buyer_corp_name   TEXT NOT NULL,
  supply_amount_krw INTEGER NOT NULL,
  tax_amount_krw    INTEGER NOT NULL,
  total_amount_krw  INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'issued',
  nts_send_dt       TEXT,
  created_at        BIGINT NOT NULL,
  UNIQUE(mgt_key)
);
CREATE INDEX IF NOT EXISTS idx_tax_inv_user ON nf_tax_invoices_kr(user_id, created_at);

-- 사용자 결제 국가/통화 프로필
CREATE TABLE IF NOT EXISTS nf_user_billing_profile (
  user_id         TEXT PRIMARY KEY,
  country         TEXT NOT NULL DEFAULT 'KR',
  currency        TEXT NOT NULL DEFAULT 'KRW',
  biz_reg_no      TEXT,
  corp_name       TEXT,
  ceo_name        TEXT,
  biz_address     TEXT,
  biz_email       TEXT,
  tax_exempt      SMALLINT NOT NULL DEFAULT 0,
  updated_at      BIGINT NOT NULL
);

-- Toss 빌링키 (한국 자동결제)
CREATE TABLE IF NOT EXISTS nf_toss_billing_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  billing_key  TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  method       TEXT NOT NULL,
  card_info    TEXT,
  created_at   BIGINT NOT NULL,
  UNIQUE(user_id)
);

-- 인보이스 + 구독에 국가/통화 컬럼 추가
ALTER TABLE nf_aw_invoices ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE nf_aw_invoices ADD COLUMN IF NOT EXISTS display_currency TEXT;
ALTER TABLE nf_aw_invoices ADD COLUMN IF NOT EXISTS display_amount NUMERIC;
ALTER TABLE nf_aw_subscriptions ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE nf_aw_subscriptions ADD COLUMN IF NOT EXISTS currency TEXT;

-- ─── Files (v27) ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_files (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  storage_key  TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   BIGINT NOT NULL DEFAULT 0,
  category     TEXT NOT NULL DEFAULT 'general',
  ref_type     TEXT,
  ref_id       TEXT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_user ON nf_files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_ref ON nf_files(ref_type, ref_id);

-- ─── RBAC: Orgs & Roles (v28) ──────────────────────────────────────────────

-- 조직 (기업 단위)
CREATE TABLE IF NOT EXISTS nf_orgs (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE,
  business_number TEXT,
  plan            TEXT NOT NULL DEFAULT 'free',
  country         TEXT NOT NULL DEFAULT 'KR',
  owner_id        TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  created_at      BIGINT NOT NULL
);

-- 조직 멤버
CREATE TABLE IF NOT EXISTS nf_org_members (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES nf_orgs(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  joined_at  BIGINT NOT NULL,
  UNIQUE(org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON nf_org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON nf_org_members(org_id);

-- 제품별 역할
CREATE TABLE IF NOT EXISTS nf_user_roles (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  product    TEXT NOT NULL,
  role       TEXT NOT NULL,
  org_id     TEXT REFERENCES nf_orgs(id) ON DELETE SET NULL,
  granted_at BIGINT NOT NULL,
  UNIQUE(user_id, product, role)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON nf_user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_product ON nf_user_roles(product, role);

-- nf_users에 global role 추가
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- 구독/인보이스에 org_id 추가
ALTER TABLE nf_aw_subscriptions ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES nf_orgs(id);
ALTER TABLE nf_aw_invoices ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES nf_orgs(id);

-- ─── Org Invites (v29) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nf_org_invites (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES nf_orgs(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  token       TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending',
  expires_at  BIGINT NOT NULL,
  invited_by  TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON nf_org_invites(org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_invites_token ON nf_org_invites(token);

-- ─── Login History & Security Alerts (v32) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS nf_login_history (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  ip          TEXT NOT NULL,
  country     TEXT,
  user_agent  TEXT,
  method      TEXT NOT NULL DEFAULT 'email',
  success     BOOLEAN NOT NULL DEFAULT TRUE,
  risk_level  TEXT NOT NULL DEFAULT 'normal',
  risk_reason TEXT,
  service     TEXT NOT NULL DEFAULT 'nexyfab',
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON nf_login_history(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_login_history_ip ON nf_login_history(ip, created_at);

CREATE TABLE IF NOT EXISTS nf_security_alerts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  alert_type  TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'medium',
  details     TEXT,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by TEXT,
  resolved_at BIGINT,
  service     TEXT DEFAULT 'nexyfab',
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_alerts_user ON nf_security_alerts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_security_alerts_unresolved ON nf_security_alerts(resolved, created_at);

-- ─── Embed Configs ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nf_embed_configs (
  token           TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES nf_users(id) ON DELETE CASCADE,
  allowed_origins TEXT NOT NULL DEFAULT '[]',
  features        TEXT NOT NULL DEFAULT '[]',
  rfq_auto_submit BOOLEAN NOT NULL DEFAULT TRUE,
  branding        TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embed_configs_user ON nf_embed_configs(user_id);

-- ─── Releases (Desktop download binaries) ──────────────────────────────

CREATE TABLE IF NOT EXISTS nf_releases (
  id                   TEXT PRIMARY KEY,
  version              TEXT NOT NULL UNIQUE,
  pub_date             TEXT NOT NULL,
  notes                TEXT NOT NULL DEFAULT '',
  download_win_x64     TEXT,
  download_mac_aarch64 TEXT,
  download_mac_x64     TEXT,
  download_linux_x64   TEXT,
  sig_win_x64          TEXT,
  sig_mac_aarch64      TEXT,
  sig_mac_x64          TEXT,
  sig_linux_x64        TEXT,
  is_latest            INTEGER NOT NULL DEFAULT 0,
  dl_win_x64           INTEGER NOT NULL DEFAULT 0,
  dl_mac_aarch64       INTEGER NOT NULL DEFAULT 0,
  dl_mac_x64           INTEGER NOT NULL DEFAULT 0,
  dl_linux_x64         INTEGER NOT NULL DEFAULT 0,
  created_at           BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nf_releases_latest ON nf_releases(is_latest);

-- ─── Waitlist (Desktop pre-launch notify) ──────────────────────────────

CREATE TABLE IF NOT EXISTS nf_waitlist (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  product    TEXT NOT NULL DEFAULT 'nexyfab-desktop',
  lang       TEXT,
  source     TEXT,
  user_agent TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(email, product)
);
CREATE INDEX IF NOT EXISTS idx_waitlist_product ON nf_waitlist(product, created_at);

-- ─── Additional Indexes ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_plan ON nf_users(plan);
CREATE INDEX IF NOT EXISTS idx_users_role ON nf_users(role);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON nf_users(last_login_at);
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON nf_users(locked_until);
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON nf_verification_codes(expires_at);

-- ─── Multi-currency on orders/quotes (Phase 7-4a.1) ────────────────────────
-- Generalize total_price_krw → currency + total_price; capture FX snapshot
-- on the quote so accepted prices don't drift with spot rates.
ALTER TABLE nf_orders ADD COLUMN IF NOT EXISTS currency      TEXT NOT NULL DEFAULT 'KRW';
ALTER TABLE nf_orders ADD COLUMN IF NOT EXISTS total_price   DOUBLE PRECISION;
ALTER TABLE nf_orders ADD COLUMN IF NOT EXISTS fx_quote      TEXT;
ALTER TABLE nf_orders ADD COLUMN IF NOT EXISTS buyer_country TEXT;
UPDATE nf_orders SET total_price = total_price_krw WHERE total_price IS NULL;

ALTER TABLE nf_quotes ADD COLUMN IF NOT EXISTS currency       TEXT NOT NULL DEFAULT 'KRW';
ALTER TABLE nf_quotes ADD COLUMN IF NOT EXISTS amount         DOUBLE PRECISION;
ALTER TABLE nf_quotes ADD COLUMN IF NOT EXISTS fx_quote       TEXT;
ALTER TABLE nf_quotes ADD COLUMN IF NOT EXISTS fx_valid_until BIGINT;
UPDATE nf_quotes SET amount = estimated_amount WHERE amount IS NULL;

ALTER TABLE nf_contracts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'KRW';
ALTER TABLE nf_contracts ADD COLUMN IF NOT EXISTS fx_quote TEXT;

-- ─── DPA / privacy consent log (Phase 7-4a.6) ──────────────────────────────
CREATE TABLE IF NOT EXISTS nf_dpa_consent (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  version     TEXT NOT NULL,
  regime      TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  accepted_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dpa_user ON nf_dpa_consent(user_id, accepted_at);

-- ─── International shipping fields (Phase 7-4a.7) ──────────────────────────
-- HS Code = customs tariff classification; Incoterm = who pays freight & duty.
-- Both nullable: domestic KR-only orders don't need them.
ALTER TABLE nf_orders ADD COLUMN IF NOT EXISTS hs_code           TEXT;
ALTER TABLE nf_orders ADD COLUMN IF NOT EXISTS incoterm          TEXT;
ALTER TABLE nf_orders ADD COLUMN IF NOT EXISTS ship_from_country TEXT;
ALTER TABLE nf_orders ADD COLUMN IF NOT EXISTS ship_to_country   TEXT;

ALTER TABLE nf_quotes ADD COLUMN IF NOT EXISTS hs_code  TEXT;
ALTER TABLE nf_quotes ADD COLUMN IF NOT EXISTS incoterm TEXT;

-- ─── BM Matrix infra (Phase BM-1) ──────────────────────────────────────────
-- 42개 기능 스펙 §4 참조. 숨겨진 무기(결함·RMA·마진·번들)의 학습 데이터를
-- Day 1부터 쌓는다. ENUM은 lookup 테이블 FK로 무결성 강제.

-- Stage 필드
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS stage                TEXT          NOT NULL DEFAULT 'A';
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS stage_since          BIGINT;
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS cumulative_order_krw DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS order_count_success  INTEGER       NOT NULL DEFAULT 0;
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS quarterly_order_krw  DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS org_size             INTEGER       NOT NULL DEFAULT 1;
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS last_order_at        BIGINT;

DO $$ BEGIN
  ALTER TABLE nf_users ADD CONSTRAINT nf_users_stage_domain
    CHECK (stage IN ('A','B','C','D','E','F'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ENUM lookup 테이블
CREATE TABLE IF NOT EXISTS nf_enum_defect_cause (
  code       TEXT PRIMARY KEY,
  label_ko   TEXT NOT NULL,
  label_en   TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
INSERT INTO nf_enum_defect_cause (code, label_ko, label_en, sort_order) VALUES
  ('dimensional',   '치수 불량', 'Dimensional',    1),
  ('surface',       '표면 불량', 'Surface Finish', 2),
  ('material',      '재료 불량', 'Material',       3),
  ('assembly',      '조립 불량', 'Assembly',       4),
  ('packaging',     '포장 불량', 'Packaging',      5),
  ('documentation', '서류 불비', 'Documentation',  6),
  ('other',         '기타',      'Other',          99)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS nf_enum_process_step (
  code       TEXT PRIMARY KEY,
  label_ko   TEXT NOT NULL,
  label_en   TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
INSERT INTO nf_enum_process_step (code, label_ko, label_en, sort_order) VALUES
  ('cnc',        'CNC 가공',  'CNC',         1),
  ('injection',  '사출',      'Injection',   2),
  ('printing',   '3D 프린팅', '3D Printing', 3),
  ('finishing',  '후처리',    'Finishing',   4),
  ('qc',         '품질 검사', 'QC',          5),
  ('packaging',  '포장',      'Packaging',   6),
  ('shipping',   '배송',      'Shipping',    7)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS nf_enum_severity (
  code     TEXT PRIMARY KEY,
  label_ko TEXT NOT NULL,
  weight   DOUBLE PRECISION NOT NULL
);
INSERT INTO nf_enum_severity (code, label_ko, weight) VALUES
  ('critical', '치명', 1.00),
  ('major',    '주요', 0.50),
  ('minor',    '경미', 0.15)
ON CONFLICT (code) DO NOTHING;

-- 결함 / RMA (#18, #19)
CREATE TABLE IF NOT EXISTS nf_defects (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES nf_orders(id),
  cause_code        TEXT NOT NULL REFERENCES nf_enum_defect_cause(code),
  process_step      TEXT NOT NULL REFERENCES nf_enum_process_step(code),
  severity          TEXT NOT NULL REFERENCES nf_enum_severity(code),
  quantity_affected INTEGER NOT NULL CHECK (quantity_affected > 0),
  reported_at       BIGINT NOT NULL,
  reported_by       TEXT NOT NULL,
  evidence_urls     TEXT,
  resolved_at       BIGINT
);
CREATE INDEX IF NOT EXISTS idx_defects_order   ON nf_defects(order_id);
CREATE INDEX IF NOT EXISTS idx_defects_pattern ON nf_defects(cause_code, process_step);

CREATE TABLE IF NOT EXISTS nf_rma (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES nf_orders(id),
  defect_id   TEXT REFERENCES nf_defects(id),
  resolution  TEXT NOT NULL CHECK (resolution IN ('refund','replace','repair','rejected','pending')),
  refund_krw  DECIMAL(18,2),
  created_at  BIGINT NOT NULL,
  resolved_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_rma_order ON nf_rma(order_id);

-- 마진 분해 (#21) — 합계 CHECK (정확 일치)
CREATE TABLE IF NOT EXISTS nf_margin_breakdown (
  order_id           TEXT PRIMARY KEY REFERENCES nf_orders(id),
  material_krw       DECIMAL(18,2) NOT NULL,
  labor_krw          DECIMAL(18,2) NOT NULL,
  machine_krw        DECIMAL(18,2) NOT NULL,
  overhead_krw       DECIMAL(18,2) NOT NULL,
  platform_fee_krw   DECIMAL(18,2) NOT NULL,
  partner_payout_krw DECIMAL(18,2) NOT NULL,
  total_krw          DECIMAL(18,2) NOT NULL,
  CONSTRAINT margin_sum_check CHECK (
    material_krw + labor_krw + machine_krw + overhead_krw
    + platform_fee_krw + partner_payout_krw = total_krw
  )
);

-- 번들링 (#23)
CREATE TABLE IF NOT EXISTS nf_bundles (
  id            TEXT PRIMARY KEY,
  partner_id    TEXT NOT NULL,
  process_step  TEXT NOT NULL REFERENCES nf_enum_process_step(code),
  material_code TEXT NOT NULL,
  savings_krw   DECIMAL(18,2) NOT NULL CHECK (savings_krw >= 0),
  created_at    BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS nf_bundle_orders (
  bundle_id TEXT NOT NULL REFERENCES nf_bundles(id),
  order_id  TEXT NOT NULL REFERENCES nf_orders(id),
  PRIMARY KEY (bundle_id, order_id)
);

-- Stage 전환 Outbox (append-only — UPDATE/DELETE는 앱 레이어에서 금지)
CREATE TABLE IF NOT EXISTS nf_stage_event (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES nf_users(id),
  from_stage    TEXT NOT NULL,
  to_stage      TEXT NOT NULL,
  trigger_type  TEXT NOT NULL CHECK (trigger_type IN (
    'first_order','cumulative_krw','order_count',
    'org_promotion','quarterly_volume','enterprise_contract',
    'manual_override','compliance_demotion'
  )),
  trigger_value TEXT,
  occurred_at   BIGINT NOT NULL,
  processed_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_stage_event_unprocessed
  ON nf_stage_event(processed_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_stage_event_user ON nf_stage_event(user_id, occurred_at);

-- Shadow logging 전용 테이블 (백엔드만 사용, UI 노출 없음)
CREATE TABLE IF NOT EXISTS nf_quote_reject_log (
  id                    TEXT PRIMARY KEY,
  quote_id              TEXT REFERENCES nf_quotes(id),
  rfq_id                TEXT,
  reject_reason_code    TEXT NOT NULL,
  alternative_suggested BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_by           TEXT NOT NULL,
  rejected_at           BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS nf_cad_access_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  file_id     TEXT NOT NULL,
  access_type TEXT NOT NULL CHECK (access_type IN ('view','download','share','delete')),
  ip          TEXT,
  user_agent  TEXT,
  accessed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cad_access_user ON nf_cad_access_log(user_id, accessed_at);
CREATE INDEX IF NOT EXISTS idx_cad_access_file ON nf_cad_access_log(file_id, accessed_at);

CREATE TABLE IF NOT EXISTS nf_cbam_log (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES nf_orders(id),
  material_kg        DOUBLE PRECISION NOT NULL CHECK (material_kg >= 0),
  process_energy_kwh DOUBLE PRECISION NOT NULL CHECK (process_energy_kwh >= 0),
  co2e_kg            DOUBLE PRECISION NOT NULL CHECK (co2e_kg >= 0),
  computed_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cbam_order ON nf_cbam_log(order_id);

-- ─── v62: stage_event_retry_columns ─────────────────────────────────
-- BM-3 워커가 알림 발송 실패를 추적하고 재시도/dead-letter 분기 결정.
ALTER TABLE nf_stage_event ADD COLUMN IF NOT EXISTS retry_count     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nf_stage_event ADD COLUMN IF NOT EXISTS last_error      TEXT;
ALTER TABLE nf_stage_event ADD COLUMN IF NOT EXISTS last_attempt_at BIGINT;

-- ─── v63: nf_dfm_check ──────────────────────────────────────────────
-- Phase B-1: DFM 검증 결과 영속화 (전환율 분석 + 룰 학습 데이터).
CREATE TABLE IF NOT EXISTS nf_dfm_check (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES nf_users(id),
  file_id      TEXT REFERENCES nf_files(id),
  input_params TEXT NOT NULL,
  issues       INTEGER NOT NULL DEFAULT 0,
  warnings     INTEGER NOT NULL DEFAULT 0,
  items        TEXT NOT NULL,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dfm_user ON nf_dfm_check(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dfm_file ON nf_dfm_check(file_id);

-- ─── v64: funnel_events_and_dfm_action ───────────────────────────────
-- Stage(신뢰/결제) 와 Funnel(의도/행동) 분리. computeStage 는 funnel 무참조.
ALTER TABLE nf_dfm_check ADD COLUMN IF NOT EXISTS next_action TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS nf_funnel_event (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES nf_users(id),
  event_type   TEXT NOT NULL,
  context_type TEXT,
  context_id   TEXT,
  metadata     TEXT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_funnel_user_time
  ON nf_funnel_event(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_funnel_event_type
  ON nf_funnel_event(event_type, created_at);

-- ─── v65: rfq_dfm_check_link ─────────────────────────────────────────
-- RFQ → DFM 검증 결과 역참조. #7 AI 매칭 엔진이 "이 RFQ가 어떤 도면
-- 이슈를 알고 있는 상태에서 들어왔는가" 를 즉시 알 수 있게 한다.
ALTER TABLE nf_rfqs ADD COLUMN IF NOT EXISTS dfm_check_id TEXT REFERENCES nf_dfm_check(id);
CREATE INDEX IF NOT EXISTS idx_rfqs_dfm_check ON nf_rfqs(dfm_check_id);

-- ─── v66: demo_sessions ──────────────────────────────────────────────
-- 데모 모드 격리. nf_sessions 글로벌 테이블 + session_id FK 로 통일.
-- 가입 시 UPDATE ... WHERE session_id = ? 로 데이터 일괄 이관.
-- nf_funnel_event.user_id NOT NULL 유지를 위해 sentinel 'demo-user' 시드.
CREATE TABLE IF NOT EXISTS nf_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES nf_users(id),
  is_demo     BOOLEAN NOT NULL DEFAULT TRUE,
  ip          TEXT,
  user_agent  TEXT,
  created_at  BIGINT NOT NULL,
  claimed_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON nf_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_demo_time
  ON nf_sessions(is_demo, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ip_time
  ON nf_sessions(ip, created_at);

INSERT INTO nf_users (id, email, name, plan, email_verified, created_at)
VALUES ('demo-user', 'demo@nexyfab.local', 'Demo User', 'free', FALSE,
        (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE nf_dfm_check    ADD COLUMN IF NOT EXISTS session_id TEXT REFERENCES nf_sessions(id);
ALTER TABLE nf_funnel_event ADD COLUMN IF NOT EXISTS session_id TEXT REFERENCES nf_sessions(id);
ALTER TABLE nf_rfqs         ADD COLUMN IF NOT EXISTS session_id TEXT REFERENCES nf_sessions(id);

CREATE INDEX IF NOT EXISTS idx_dfm_session    ON nf_dfm_check(session_id);
CREATE INDEX IF NOT EXISTS idx_funnel_session ON nf_funnel_event(session_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_session   ON nf_rfqs(session_id);

-- ─── v67: support_tickets ────────────────────────────────────────────
-- 공개 /contact 폼 + 로그인 사용자 문의 저장소.
-- email 은 필수, user_id 는 있을 때만. status: open / in_progress / resolved / closed
CREATE TABLE IF NOT EXISTS nf_support_tickets (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES nf_users(id),
  email         TEXT NOT NULL,
  name          TEXT,
  category      TEXT NOT NULL DEFAULT 'general',
  subject       TEXT NOT NULL,
  message       TEXT NOT NULL,
  context       TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  admin_note    TEXT,
  assigned_to   TEXT REFERENCES nf_users(id),
  ip            TEXT,
  user_agent    TEXT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  resolved_at   BIGINT
);
CREATE INDEX IF NOT EXISTS idx_tickets_status_time
  ON nf_support_tickets(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_email_time
  ON nf_support_tickets(email, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_user
  ON nf_support_tickets(user_id, created_at);

-- ─── v68: factories_directory ────────────────────────────────────────
-- 286k 레거시 공장 DB (factories.db) 를 단일 DB 로 통합.
-- scripts/import-factories-directory.ts 로 1회 배치 임포트.
-- PG 에서는 향후 GIN(to_tsvector('simple', search_text)) 로 승격 가능.
CREATE TABLE IF NOT EXISTS nf_factories_directory (
  id           INTEGER PRIMARY KEY,
  country      TEXT NOT NULL,
  name         TEXT NOT NULL,
  product      TEXT,
  industry     TEXT,
  address      TEXT,
  search_text  TEXT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fdir_country    ON nf_factories_directory(country);
CREATE INDEX IF NOT EXISTS idx_fdir_industry   ON nf_factories_directory(industry);
CREATE INDEX IF NOT EXISTS idx_fdir_country_id ON nf_factories_directory(country, id);
-- 한국어/중국어 trigram 검색을 위한 GIN 인덱스 (pg_trgm 확장 필요)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS idx_fdir_search_trgm
--   ON nf_factories_directory USING GIN (search_text gin_trgm_ops);

-- ─── v69: RFQ assigned factory display name ─────────────────────────
ALTER TABLE nf_rfqs ADD COLUMN IF NOT EXISTS assigned_factory_name TEXT;

-- ─── v70: RFQ-linked CAD file versioning (nf_files) ─────────────────
ALTER TABLE nf_files ADD COLUMN IF NOT EXISTS replaces_file_id TEXT;
ALTER TABLE nf_files ADD COLUMN IF NOT EXISTS cad_root_id TEXT;
ALTER TABLE nf_files ADD COLUMN IF NOT EXISTS cad_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nf_files ADD COLUMN IF NOT EXISTS uploaded_by_role TEXT;
UPDATE nf_files SET cad_root_id = id, cad_version = 1
  WHERE category = 'cad' AND cad_root_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_rfq_cad ON nf_files(ref_type, ref_id, category);

-- ─── v71: Stage E→F — 맞춤 계약·ERP·3구간 연속 분기 발주 (bm-matrix §1.1) ──
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS quarterly_order_krw_history TEXT NOT NULL DEFAULT '[0,0,0]';
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS enterprise_contract BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS erp_integration_contract BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── v72: 분기 히스토리 롤 idempotency (Asia/Seoul 기준 `YYYY-Qn`) ───────
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS last_quarterly_history_roll_period TEXT;

-- ─── v73: M1 — buyer↔partner thread messages ─────────────────────────
-- Per-RFQ or per-order conversation thread. Replaces email-only handoffs.
-- Both buyer (rfq.user_id / order.user_id) and the assigned partner
-- (factories.partner_email / orders.partner_email) read+write.
CREATE TABLE IF NOT EXISTS nf_thread_messages (
  id                   TEXT PRIMARY KEY,
  thread_kind          TEXT NOT NULL,           -- 'rfq' | 'order'
  thread_id            TEXT NOT NULL,
  sender_user_id       TEXT,                    -- set when buyer
  sender_partner_email TEXT,                    -- set when partner
  sender_type          TEXT NOT NULL,           -- 'buyer' | 'partner' | 'admin' | 'system'
  body                 TEXT NOT NULL,
  attachments_json     TEXT,                    -- JSON array of https URLs
  read_at              BIGINT,
  created_at           BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_msgs ON nf_thread_messages(thread_kind, thread_id, created_at);

-- ─── v74: M4 — order milestone uploads (partner→buyer visibility) ─────
-- Partner posts photos+notes per production step. Distinct from
-- nf_milestones (those are user-defined task list items); this table
-- captures the partner-side progress feed.
CREATE TABLE IF NOT EXISTS nf_order_milestones (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL,
  step              TEXT NOT NULL,           -- 'production_start'|'qc'|'packing'|'shipped'|'note'
  note              TEXT,
  attachments_json  TEXT,                    -- JSON array of https URLs
  by_partner_email  TEXT NOT NULL,
  created_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_milestones ON nf_order_milestones(order_id, created_at);

-- ─── v75: B7 — RFQ template library ───────────────────────────────────
-- User-saved RFQ templates for quick re-quoting. System templates ship
-- in code (lib/nexyfab/rfqSystemTemplates.ts), this stores user's own.
CREATE TABLE IF NOT EXISTS nf_rfq_templates (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  fields_json   TEXT NOT NULL,             -- JSON RFQ field defaults
  source_rfq_id TEXT,                      -- when cloned from an existing RFQ
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rfq_tpl_user ON nf_rfq_templates(user_id, created_at DESC);

-- ─── v76: B3 — partner multi-dim metric events (formal registration) ──
-- Existing partner-metrics.ts creates this table lazily; declaring it
-- here so fresh deploys have it ready before the first event fires.
CREATE TABLE IF NOT EXISTS nf_partner_metric_events (
  id                   TEXT PRIMARY KEY,
  partner_email        TEXT NOT NULL,
  kind                 TEXT NOT NULL,        -- 'order_delivered_on_time'|'order_delivered_late'|'quote_responded'|'review_received'|'defect_reported'|'defect_resolved'
  order_id             TEXT,
  quote_id             TEXT,
  review_id            TEXT,
  value                REAL,
  days_late            REAL,
  lead_time_days       REAL,
  response_minutes     REAL,
  rating               REAL,
  quality_rating       REAL,
  communication_rating REAL,
  deadline_rating      REAL,
  created_at           BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pme_partner ON nf_partner_metric_events(partner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pme_kind    ON nf_partner_metric_events(partner_email, kind);

-- ─── v77: Q — Concierge (managed marketplace) ────────────────────────
-- Per-RFQ × per-factory contact tracking. Operations team updates the
-- status as they reach out to factories from the directory; customers
-- see a blurred-name progress feed so they know their RFQ is being
-- worked on. Realistic acknowledgement that nf_factories is mostly
-- public-directory data, not pre-signed partners.
CREATE TABLE IF NOT EXISTS nf_concierge_status (
  id              TEXT PRIMARY KEY,
  rfq_id          TEXT NOT NULL,
  factory_id      TEXT NOT NULL,
  status          TEXT NOT NULL,          -- 'recommended'|'contacted'|'responded'|'declined'|'quote_drafting'|'quote_received'|'partner_signup'
  last_note       TEXT,                   -- ops-only memo (or shown to customer if marked public_note=true)
  public_note     BOOLEAN NOT NULL DEFAULT FALSE,
  last_action_at  BIGINT NOT NULL,
  last_action_by  TEXT,                   -- admin user id
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_concierge_rfq    ON nf_concierge_status(rfq_id, last_action_at DESC);
CREATE INDEX IF NOT EXISTS idx_concierge_factory ON nf_concierge_status(factory_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_concierge_pair ON nf_concierge_status(rfq_id, factory_id);

-- ─── v78: Q — Partner invite magic links ─────────────────────────────
-- When a directory factory expresses interest, ops generates an invite
-- token. The factory clicks the magic link, sees pre-filled info +
-- partner agreement, sets a password, and becomes an active partner
-- in <1 minute. Tokens are single-use and time-bound.
CREATE TABLE IF NOT EXISTS nf_partner_invites (
  id                  TEXT PRIMARY KEY,
  token               TEXT NOT NULL UNIQUE,
  factory_id          TEXT,
  prefill_email       TEXT,
  prefill_name        TEXT,                 -- contact person name
  prefill_company     TEXT,
  prefill_phone       TEXT,                 -- contact person phone (담당자 번호)
  prefill_biz_reg_no  TEXT,                 -- 사업자 등록 번호 (10 digits, may include hyphens)
  rfq_context_id      TEXT,                 -- optional: which RFQ triggered this invite
  created_by          TEXT,                 -- admin user id
  created_at          BIGINT NOT NULL,
  expires_at          BIGINT NOT NULL,
  accepted_at         BIGINT,
  accepted_by_email   TEXT,
  accepted_by_ip      TEXT,
  -- Final values captured at acceptance (may differ from prefill if user edited).
  -- These three are REQUIRED at acceptance per partner agreement v1.0.
  final_biz_reg_no    TEXT,
  final_phone         TEXT,
  final_company       TEXT,
  resulting_user_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_partner_invites_token  ON nf_partner_invites(token);
CREATE INDEX IF NOT EXISTS idx_partner_invites_factory ON nf_partner_invites(factory_id);

-- ─── v79: Q — Partner agreement consent log ──────────────────────────
-- Tracks which partner accepted which agreement version, when, from
-- which IP. Required for legal enforceability (anti-poach, escrow
-- mandate). Versions are stored as files under /legal/, this table
-- just tracks acceptance signatures.
CREATE TABLE IF NOT EXISTS nf_partner_agreement_consents (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  partner_email       TEXT,
  agreement_version   TEXT NOT NULL,      -- e.g. 'v1.0'
  accepted_at         BIGINT NOT NULL,
  ip_address          TEXT,
  user_agent          TEXT,
  invite_id           TEXT                -- back-ref to nf_partner_invites if signed via magic link
);
CREATE INDEX IF NOT EXISTS idx_consents_user    ON nf_partner_agreement_consents(user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_consents_version ON nf_partner_agreement_consents(agreement_version);

-- ─── v80: Q — Escrow transaction ledger (interface stub) ─────────────
-- Tracks money flowing through NexyFab's account between buyer and
-- factory. Real PG (Toss/KG/Stripe) integration happens at the
-- payment gateway layer; this table is the system-of-record for what
-- was received and what was released. Status transitions happen via
-- /admin/escrow or PG webhook (when wired).
--
-- Mandatory by partner agreement v1.0 — no off-platform settlement
-- allowed during the 24-month exclusivity window.
CREATE TABLE IF NOT EXISTS nf_escrow_transactions (
  id                    TEXT PRIMARY KEY,
  order_id              TEXT NOT NULL,
  buyer_user_id         TEXT NOT NULL,
  partner_email         TEXT NOT NULL,
  gross_amount_krw      BIGINT NOT NULL,  -- buyer pays this
  commission_pct        REAL NOT NULL,    -- 8.0 / 7.0 / 5.0 depending on plan
  commission_amount_krw BIGINT NOT NULL,  -- gross × pct
  net_amount_krw        BIGINT NOT NULL,  -- gross − commission, paid to factory
  status                TEXT NOT NULL,    -- 'pending'|'received'|'held'|'released'|'refunded'|'disputed'
  pg_provider           TEXT,             -- 'toss'|'kg'|'stripe'|'manual'
  pg_transaction_id     TEXT,
  received_at           BIGINT,
  released_at           BIGINT,
  refunded_at           BIGINT,
  notes                 TEXT,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_escrow_order   ON nf_escrow_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_escrow_partner ON nf_escrow_transactions(partner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escrow_status  ON nf_escrow_transactions(status);


-- ─── v81: Partner Pro grace window ───────────────────────────────────
-- Partners get temporary Pro tier access while they have an active
-- deal in flight (from quote submission through escrow release + 30d).
-- Resolved at auth time: if pro_grace_until > now and stored plan is
-- free, the user is treated as Pro for tooling access. Stored plan is
-- never overwritten — paid Pro subscriptions remain authoritative.
ALTER TABLE nf_users ADD COLUMN IF NOT EXISTS pro_grace_until BIGINT;
CREATE INDEX IF NOT EXISTS idx_users_pro_grace ON nf_users(pro_grace_until) WHERE pro_grace_until IS NOT NULL;


-- ─── v82: Payment idempotency ────────────────────────────────────────
-- Application-level guard against double-charge race conditions where
-- two concurrent PATCH /payment calls slip past the SQLite busy_timeout.
-- The (toss_order_id, payment_key) pair is unique because Toss returns
-- the same paymentKey for retries — INSERT will fail if we already
-- committed this exact attempt, so the second confirmer sees the unique
-- violation and aborts before re-charging.
CREATE TABLE IF NOT EXISTS nf_payment_attempts (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL,
  toss_order_id   TEXT NOT NULL,
  payment_key     TEXT NOT NULL,
  amount_krw      BIGINT NOT NULL,
  status          TEXT NOT NULL,        -- 'succeeded' | 'failed'
  user_id         TEXT NOT NULL,
  raw_response    TEXT,
  created_at      BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempt_pair
  ON nf_payment_attempts(toss_order_id, payment_key);
CREATE INDEX IF NOT EXISTS idx_payment_attempt_order
  ON nf_payment_attempts(order_id, created_at DESC);


-- ─── v83: Order → Quote linkage ──────────────────────────────────────
-- nf_orders previously only stored rfq_id. The escrow ledger needs to
-- find the contract → commission_rate, which is keyed by quote_id, so
-- without this column we have to traverse rfq → quotes → contract (3
-- hops, fragile if multiple quotes exist for one RFQ).
ALTER TABLE nf_orders ADD COLUMN IF NOT EXISTS quote_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_quote_id ON nf_orders(quote_id);


-- ─── v84: API usage telemetry ────────────────────────────────────────
-- Granular log of every external API call so the admin console can plot
-- cost / latency / error rate per provider. Replaces the scattered
-- aiMeter / funnel-event / Sentry data with a single queryable table.
--
-- High write volume — keep rows lean (no full request/response bodies).
-- Aggregate queries should hit the indexed (provider, called_at) range.
CREATE TABLE IF NOT EXISTS nf_api_usage (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,        -- 'deepseek' | 'anthropic' | 'openai' | 'gemini' | 'toss' | 'resend' | 'r2' | ...
  endpoint        TEXT,                 -- e.g. 'chat.completions' | 'payments/confirm'
  feature         TEXT,                 -- e.g. 'shape-chat' | 'scad-agent' | 'rfq-writer'
  status_code     INTEGER,              -- HTTP status; 0 = network/exception
  latency_ms      INTEGER NOT NULL,
  tokens_in       INTEGER,              -- AI providers only
  tokens_out      INTEGER,              -- AI providers only
  cost_usd        REAL,                 -- computed at call time
  user_id         TEXT,                 -- nf_users.id when known
  error_message   TEXT,                 -- truncated to 500 chars
  called_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_usage_provider_time
  ON nf_api_usage(provider, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_feature_time
  ON nf_api_usage(feature, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_time
  ON nf_api_usage(user_id, called_at DESC) WHERE user_id IS NOT NULL;

-- ─── v85: Admin runtime settings ─────────────────────────────────────
-- Hot-swappable config that would otherwise need a redeploy to change:
-- API keys (encrypted), feature flag overrides, budget thresholds, etc.
-- Reads are cached in-process for 30s; writes invalidate the cache.
--
-- Encryption: value_encrypted uses AES-256-GCM with NEXYFAB_SECRET_KEY
-- as the master key. The value_plain column holds non-secret config
-- (booleans, thresholds) where encryption would be ceremony.
CREATE TABLE IF NOT EXISTS nf_admin_settings (
  key             TEXT PRIMARY KEY,
  value_plain     TEXT,                 -- non-secret value
  value_encrypted TEXT,                 -- secret value (AES-GCM, base64)
  scope           TEXT NOT NULL,        -- 'api_key' | 'feature_flag' | 'budget' | 'config'
  description     TEXT,
  updated_by      TEXT,                 -- nf_users.id of last editor
  updated_at      BIGINT NOT NULL,
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_settings_scope ON nf_admin_settings(scope);

-- ─── v86: Admin audit log ────────────────────────────────────────────
-- Immutable record of every admin action that mutates state — secret
-- rotation, feature flag toggles, escrow overrides, anti-poach verdicts.
-- Required for incident forensics and (future) compliance.
CREATE TABLE IF NOT EXISTS nf_admin_audit (
  id              TEXT PRIMARY KEY,
  admin_user_id   TEXT NOT NULL,
  action          TEXT NOT NULL,        -- e.g. 'setting.rotate' | 'feature_flag.toggle'
  target          TEXT,                 -- key/id of mutated entity
  old_value_hash  TEXT,                 -- sha256 of prior value (no leaks)
  new_value_hash  TEXT,                 -- sha256 of new value
  metadata        TEXT,                 -- additional context, JSON
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_user_time
  ON nf_admin_audit(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action_time
  ON nf_admin_audit(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target
  ON nf_admin_audit(target, created_at DESC) WHERE target IS NOT NULL;

-- ─── v87: RFQ optional CAE hint snapshot (client self-report, not verified) ──
ALTER TABLE nf_rfqs ADD COLUMN IF NOT EXISTS analysis_summary TEXT;

-- ─── v88: Dodo Payments webhook idempotency ──────────────────────────────────
-- Separate from nf_webhook_events (Stripe-only) so Dodo retries don't collide
-- on event_id namespace.
CREATE TABLE IF NOT EXISTS nf_dodo_webhook_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  received_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dodo_webhook_events_received_at
  ON nf_dodo_webhook_events(received_at);
