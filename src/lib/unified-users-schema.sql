-- ============================================================================
-- Nexysys 통합 회원 스키마 (Neon PostgreSQL)
--
-- 모든 서비스(NexyFab, NexyFlow, Nexysys)가 공유하는 단일 users 테이블.
-- 각 사이트에서 독립적으로 가입/로그인 가능.
-- 같은 이메일이면 자동으로 서비스 연결.
-- ============================================================================

-- ─── 통합 회원 테이블 ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  password_hash         TEXT,              -- NULL = OAuth 전용 계정

  -- Profile (공통)
  avatar_url            TEXT,
  language              TEXT DEFAULT 'ko',
  country               TEXT,
  timezone              TEXT,
  phone                 TEXT,
  gender                TEXT,

  -- 직장/사업자 정보
  company               TEXT,
  job_title             TEXT,
  industry              TEXT,
  employee_size         TEXT,
  account_type          TEXT DEFAULT 'personal',  -- personal | business
  business_reg_number   TEXT,

  -- 서비스 가입 현황 (어느 서비스에서 가입했는지)
  services              TEXT NOT NULL DEFAULT '[]',  -- JSON: ["nexyfab","nexyflow"]
  signup_source         TEXT,                        -- email, google, kakao, naver
  signup_service        TEXT,                        -- 최초 가입한 서비스: nexyfab, nexyflow, nexysys

  -- 서비스별 플랜 (각 서비스마다 독립적)
  nexyfab_plan          TEXT NOT NULL DEFAULT 'free',
  nexyflow_plan         TEXT NOT NULL DEFAULT 'free',

  -- 글로벌 역할
  role                  TEXT NOT NULL DEFAULT 'user',  -- user, admin, super_admin

  -- 인증 상태
  email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until          BIGINT,

  -- OAuth
  oauth_provider        TEXT,    -- google, kakao, naver
  oauth_id              TEXT,    -- provider별 고유 ID

  -- MFA / TOTP
  totp_secret           TEXT,
  totp_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_backup_codes      TEXT,    -- JSON array

  -- 동의 기록 (GDPR / 개인정보보호법 / CCPA)
  terms_agreed_at       BIGINT,
  privacy_agreed_at     BIGINT,
  age_confirmed         BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_agreed      BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_agreed_at   BIGINT,

  -- 로그인 추적
  last_login_at         BIGINT,
  login_count           INTEGER NOT NULL DEFAULT 0,
  signup_ip             TEXT,
  last_login_ip         TEXT,

  -- 타임스탬프
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_services ON users USING GIN ((services::jsonb));
CREATE INDEX IF NOT EXISTS idx_users_signup_service ON users(signup_service);

-- ─── 공유 인증 테이블 ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  service    TEXT NOT NULL DEFAULT 'nexyfab',  -- 어느 서비스에서 발급했는지
  expires_at BIGINT NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_hash ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

-- ─── 조직 (공유) ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  logo        TEXT,
  plan        TEXT DEFAULT 'free',
  max_members INTEGER DEFAULT 50,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_orgs_slug ON organizations(slug);

CREATE TABLE IF NOT EXISTS org_members (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            TEXT DEFAULT 'member',    -- owner, admin, member
  department      TEXT,
  position        TEXT,
  joined_at       BIGINT NOT NULL,
  UNIQUE(user_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_om_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_om_org ON org_members(org_id);

-- ─── 서비스별 역할 (제품별 세분화된 권한) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS user_service_roles (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service    TEXT NOT NULL,  -- nexyfab, nexyflow
  role       TEXT NOT NULL,  -- viewer, editor, admin, etc.
  granted_at BIGINT NOT NULL,
  UNIQUE(user_id, service)
);

-- ─── 로그인 이력 (공유) ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS login_history (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service      TEXT NOT NULL,  -- nexyfab, nexyflow, nexysys
  ip           TEXT,
  country      TEXT,
  user_agent   TEXT,
  method       TEXT,           -- email, google, kakao, naver
  success      BOOLEAN NOT NULL DEFAULT TRUE,
  risk_level   TEXT DEFAULT 'normal',
  risk_reason  TEXT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lh_user ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_lh_created ON login_history(created_at);

-- ─── 보안 알림 (공유) ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_alerts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service      TEXT,
  alert_type   TEXT NOT NULL,
  severity     TEXT NOT NULL,
  details      TEXT,
  resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by  TEXT,
  resolved_at  BIGINT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sa_user ON security_alerts(user_id);

-- ─── SSO 설정 (조직별) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sso_config (
  org_id      TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider    TEXT,
  entity_id   TEXT,
  sso_url     TEXT,
  certificate TEXT,
  client_id   TEXT,
  issuer      TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  BIGINT NOT NULL
);
