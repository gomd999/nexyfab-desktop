// DB path resolution priority:
//   1. NEXYFAB_DB_PATH  — explicit full path (production recommended)
//   2. DATA_ROOT/nexyfab.db — Railway Volume mount (set DATA_ROOT=/data)
//   3. {cwd}/nexyfab.db — dev fallback
import Database from 'better-sqlite3';
import path from 'path';
let _db: Database.Database | null = null;
let signalHandlersRegistered = false;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath =
    process.env.NEXYFAB_DB_PATH
    || (process.env.DATA_ROOT ? path.join(process.env.DATA_ROOT, 'nexyfab.db') : null)
    || path.join(process.cwd(), 'nexyfab.db');
  _db = new Database(dbPath);
  // Production-grade SQLite settings
  _db.pragma('journal_mode = WAL');        // WAL mode for concurrent reads
  _db.pragma('synchronous = NORMAL');       // Balance durability/performance (not FULL which is slow)
  _db.pragma('cache_size = -64000');        // 64MB page cache
  _db.pragma('temp_store = memory');        // Temp tables in memory
  _db.pragma('mmap_size = 268435456');     // 256MB memory-mapped I/O
  _db.pragma('foreign_keys = ON');          // Enforce FK constraints
  _db.pragma('busy_timeout = 5000');        // Wait up to 5s on locked DB (prevents SQLITE_BUSY crash)
  initSchema(_db);

  // Graceful shutdown — register signal handlers once after DB is first created
  if (!signalHandlersRegistered && typeof process !== 'undefined') {
    signalHandlersRegistered = true;
    const shutdown = () => {
      if (_db) { _db.close(); _db = null; }
      process.exit(0);
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }

  return _db;
}

// ─── Schema migrations ────────────────────────────────────────────────────────

const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: 'initial_schema',
    sql: '', // 이미 initSchema에서 처리됨
  },
  {
    version: 2,
    name: 'add_refresh_tokens',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES nf_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON nf_refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON nf_refresh_tokens(token_hash);
    `,
  },
  {
    version: 3,
    name: 'add_password_reset_tokens',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES nf_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pwd_reset_hash ON nf_password_reset_tokens(token_hash);
    `,
  },
  {
    version: 4,
    name: 'add_webhook_events',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_webhook_events (
        id TEXT PRIMARY KEY,
        stripe_event_id TEXT UNIQUE NOT NULL,
        event_type TEXT NOT NULL,
        processed_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON nf_webhook_events(stripe_event_id);
    `,
  },
  // indexes migration
  {
    version: 5,
    name: 'add_performance_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_rfqs_user_created ON nf_rfqs(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON nf_projects(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_shares_token ON nf_shares(token);
      CREATE INDEX IF NOT EXISTS idx_collab_updated ON nf_collab_sessions(last_ping);
      CREATE INDEX IF NOT EXISTS idx_audit_user_created ON nf_audit_log(user_id, created_at);
    `,
  },
  {
    version: 6,
    name: 'add_account_lockout_columns',
    sql: `
      ALTER TABLE nf_users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE nf_users ADD COLUMN locked_until INTEGER;
    `,
  },
  {
    version: 7,
    name: 'add_totp_2fa_columns',
    sql: `
      ALTER TABLE nf_users ADD COLUMN totp_secret TEXT;
      ALTER TABLE nf_users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 8,
    name: 'add_share_version',
    sql: `
      ALTER TABLE nf_shares ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE nf_shares ADD COLUMN model_name TEXT;
      CREATE INDEX IF NOT EXISTS idx_shares_user_model ON nf_shares(user_id, model_name);
    `,
  },
  {
    version: 9,
    name: 'add_stripe_customer_id',
    sql: `
      ALTER TABLE nf_users ADD COLUMN stripe_customer_id TEXT;
    `,
  },
  {
    version: 10,
    name: 'add_quotes_table',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_quotes (
        id TEXT PRIMARY KEY,
        inquiry_id TEXT,
        project_name TEXT NOT NULL,
        factory_name TEXT NOT NULL DEFAULT '',
        estimated_amount REAL NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        valid_until TEXT,
        partner_email TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_quotes_inquiry ON nf_quotes(inquiry_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_status ON nf_quotes(status);
      CREATE INDEX IF NOT EXISTS idx_quotes_partner ON nf_quotes(partner_email);
    `,
  },
  {
    version: 11,
    name: 'add_job_queue',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_job_queue (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        attempts    INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        error       TEXT,
        scheduled_at INTEGER NOT NULL,
        processed_at INTEGER,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_queue_status ON nf_job_queue(status, scheduled_at);
    `,
  },
  {
    version: 12,
    name: 'add_teams',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_teams (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        owner_id   TEXT NOT NULL,
        plan       TEXT NOT NULL DEFAULT 'team',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nf_team_members (
        id         TEXT PRIMARY KEY,
        team_id    TEXT NOT NULL REFERENCES nf_teams(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL,
        email      TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'viewer',
        invited_by TEXT NOT NULL,
        joined_at  INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(team_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS nf_team_invites (
        id         TEXT PRIMARY KEY,
        team_id    TEXT NOT NULL,
        email      TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'viewer',
        token      TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_team_members_team ON nf_team_members(team_id);
      CREATE INDEX IF NOT EXISTS idx_team_members_user ON nf_team_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_team_invites_token ON nf_team_invites(token);
    `,
  },
  {
    version: 13,
    name: 'add_bom',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_bom (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        team_id     TEXT,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'draft',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
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
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bom_user ON nf_bom(user_id);
      CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON nf_bom_items(bom_id);
      CREATE INDEX IF NOT EXISTS idx_bom_items_parent ON nf_bom_items(parent_id);
    `,
  },
  {
    version: 14,
    name: 'add_contract_milestones',
    sql: `
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
        completed_at INTEGER,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_milestones_contract ON nf_contract_milestones(contract_id);
    `,
  },
  {
    version: 15,
    name: 'add_webhook_subscriptions',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_webhook_subscriptions (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        url         TEXT NOT NULL,
        secret      TEXT NOT NULL,
        events      TEXT NOT NULL DEFAULT '[]',
        status      TEXT NOT NULL DEFAULT 'active',
        description TEXT,
        last_triggered_at INTEGER,
        failure_count     INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_webhooks_user ON nf_webhook_subscriptions(user_id, status);
      CREATE TABLE IF NOT EXISTS nf_slack_integrations (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL UNIQUE,
        webhook_url TEXT NOT NULL,
        channel     TEXT,
        events      TEXT NOT NULL DEFAULT '[]',
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `,
  },
  {
    version: 16,
    name: 'add_api_keys',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_api_keys (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        name         TEXT NOT NULL,
        key_hash     TEXT NOT NULL UNIQUE,
        key_prefix   TEXT NOT NULL,
        scopes       TEXT NOT NULL DEFAULT '[]',
        ip_whitelist TEXT NOT NULL DEFAULT '[]',
        status       TEXT NOT NULL DEFAULT 'active',
        last_used_at INTEGER,
        expires_at   INTEGER,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_user ON nf_api_keys(user_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_prefix ON nf_api_keys(key_prefix);
    `,
  },
  {
    version: 17,
    name: 'add_shipments',
    sql: `
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
        delivered_at      INTEGER,
        last_checked_at   INTEGER,
        created_at        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shipments_contract ON nf_shipments(contract_id);
      CREATE INDEX IF NOT EXISTS idx_shipments_user ON nf_shipments(user_id);
    `,
  },
  {
    version: 18,
    name: 'add_erp_connector',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_erp_sync_log (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        direction    TEXT NOT NULL,
        format       TEXT NOT NULL,
        record_count INTEGER NOT NULL DEFAULT 0,
        status       TEXT NOT NULL DEFAULT 'ok',
        error        TEXT,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_erp_sync_user ON nf_erp_sync_log(user_id, created_at);
      CREATE TABLE IF NOT EXISTS nf_erp_field_mappings (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL UNIQUE,
        mappings   TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 19,
    name: 'add_esg_reports',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_esg_reports (
        id          TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        inputs      TEXT NOT NULL,
        results     TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_esg_contract ON nf_esg_reports(contract_id, user_id);
    `,
  },
  {
    version: 20,
    name: 'add_nexyflow_integration',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_nexyflow_integrations (
        id                     TEXT PRIMARY KEY,
        user_id                TEXT NOT NULL UNIQUE,
        nexyflow_url           TEXT NOT NULL,
        access_token           TEXT NOT NULL,
        sync_tasks             INTEGER NOT NULL DEFAULT 1,
        sync_calendar          INTEGER NOT NULL DEFAULT 1,
        sync_approvals         INTEGER NOT NULL DEFAULT 0,
        approval_threshold_krw INTEGER NOT NULL DEFAULT 1000000,
        status                 TEXT NOT NULL DEFAULT 'active',
        last_tested_at         INTEGER,
        created_at             INTEGER NOT NULL,
        updated_at             INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nf_nexyflow_sync_map (
        id           TEXT PRIMARY KEY DEFAULT (hex(randomblob(8))),
        nexyfab_type TEXT NOT NULL,
        nexyfab_id   TEXT NOT NULL,
        nexyflow_id  TEXT,
        user_id      TEXT NOT NULL,
        synced_at    INTEGER NOT NULL,
        UNIQUE(nexyfab_type, nexyfab_id, user_id)
      );
    `,
  },
  {
    version: 21,
    name: 'add_rfq_3d_fields',
    sql: `
      ALTER TABLE nf_rfqs ADD COLUMN shape_share_token TEXT;
      ALTER TABLE nf_rfqs ADD COLUMN dfm_score INTEGER;
      ALTER TABLE nf_rfqs ADD COLUMN dfm_process TEXT;
      CREATE INDEX IF NOT EXISTS idx_rfqs_share_token ON nf_rfqs(shape_share_token);
    `,
  },
  {
    version: 22,
    name: 'airwallex_billing',
    sql: `
      -- Airwallex customer mapping
      CREATE TABLE IF NOT EXISTS nf_aw_customers (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL UNIQUE,
        aw_customer_id  TEXT NOT NULL UNIQUE,
        created_at      INTEGER NOT NULL
      );

      -- Airwallex subscriptions
      CREATE TABLE IF NOT EXISTS nf_aw_subscriptions (
        id                    TEXT PRIMARY KEY,
        user_id               TEXT NOT NULL,
        product               TEXT NOT NULL,
        aw_subscription_id    TEXT NOT NULL UNIQUE,
        aw_customer_id        TEXT NOT NULL,
        plan                  TEXT NOT NULL,
        status                TEXT NOT NULL DEFAULT 'active',
        current_period_start  INTEGER NOT NULL,
        current_period_end    INTEGER NOT NULL,
        cancelled_at          INTEGER,
        created_at            INTEGER NOT NULL,
        updated_at            INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_aw_subs_user ON nf_aw_subscriptions(user_id, status);

      -- Airwallex invoices
      CREATE TABLE IF NOT EXISTS nf_aw_invoices (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL,
        product          TEXT NOT NULL,
        aw_invoice_id    TEXT NOT NULL UNIQUE,
        aw_customer_id   TEXT NOT NULL,
        plan             TEXT NOT NULL,
        base_amount_krw  INTEGER NOT NULL DEFAULT 0,
        usage_amount_krw INTEGER NOT NULL DEFAULT 0,
        total_amount_krw INTEGER NOT NULL DEFAULT 0,
        currency         TEXT NOT NULL DEFAULT 'KRW',
        status           TEXT NOT NULL DEFAULT 'open',
        description      TEXT,
        paid_at          INTEGER,
        created_at       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_aw_inv_user ON nf_aw_invoices(user_id, created_at);

      -- Payment attempts with smart retry
      CREATE TABLE IF NOT EXISTS nf_aw_payment_attempts (
        id             TEXT PRIMARY KEY,
        invoice_id     TEXT NOT NULL,
        user_id        TEXT NOT NULL,
        aw_intent_id   TEXT,
        status         TEXT NOT NULL,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        error_message  TEXT,
        next_retry_at  INTEGER,
        attempted_at   INTEGER NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES nf_aw_invoices(id)
      );
      CREATE INDEX IF NOT EXISTS idx_aw_retry ON nf_aw_payment_attempts(status, next_retry_at);

      -- Usage events (per product, per billing cycle)
      CREATE TABLE IF NOT EXISTS nf_usage_events (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        product     TEXT NOT NULL,
        metric      TEXT NOT NULL,
        quantity    INTEGER NOT NULL DEFAULT 1,
        cycle_start INTEGER NOT NULL,
        metadata    TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_cycle ON nf_usage_events(user_id, product, cycle_start);
      CREATE INDEX IF NOT EXISTS idx_usage_metric ON nf_usage_events(user_id, metric, cycle_start);

      -- BI analytics: all Airwallex API response data
      CREATE TABLE IF NOT EXISTS nf_billing_analytics (
        id         TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        product    TEXT NOT NULL,
        invoice_id TEXT,
        payload    TEXT NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_billing_analytics_event ON nf_billing_analytics(event_type, recorded_at);
      CREATE INDEX IF NOT EXISTS idx_billing_analytics_user  ON nf_billing_analytics(user_id, recorded_at);

      -- Add Airwallex customer ID to users table
      ALTER TABLE nf_users ADD COLUMN aw_customer_id TEXT;
    `,
  },
  {
    version: 23,
    name: 'country_billing',
    sql: `
      -- 한국 전자세금계산서
      CREATE TABLE IF NOT EXISTS nf_tax_invoices_kr (
        id                TEXT PRIMARY KEY,
        invoice_id        TEXT NOT NULL,
        user_id           TEXT NOT NULL,
        mgt_key           TEXT NOT NULL UNIQUE,
        buyer_biz_reg_no  TEXT NOT NULL,
        buyer_corp_name   TEXT NOT NULL,
        supply_amount_krw INTEGER NOT NULL,
        tax_amount_krw    INTEGER NOT NULL,
        total_amount_krw  INTEGER NOT NULL,
        status            TEXT NOT NULL DEFAULT 'issued',
        nts_send_dt       TEXT,
        created_at        INTEGER NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES nf_aw_invoices(id)
      );
      CREATE INDEX IF NOT EXISTS idx_tax_inv_user ON nf_tax_invoices_kr(user_id, created_at);

      -- 사용자 결제 국가/통화 프로필 (구독 시 저장)
      CREATE TABLE IF NOT EXISTS nf_user_billing_profile (
        user_id         TEXT PRIMARY KEY,
        country         TEXT NOT NULL DEFAULT 'KR',
        currency        TEXT NOT NULL DEFAULT 'KRW',
        biz_reg_no      TEXT,
        corp_name       TEXT,
        ceo_name        TEXT,
        biz_address     TEXT,
        biz_email       TEXT,
        tax_exempt      INTEGER NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL
      );

      -- Toss 빌링키 (한국 자동결제)
      CREATE TABLE IF NOT EXISTS nf_toss_billing_keys (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL UNIQUE,
        billing_key  TEXT NOT NULL,
        customer_key TEXT NOT NULL,
        method       TEXT NOT NULL,
        card_info    TEXT,
        created_at   INTEGER NOT NULL
      );

      -- 인보이스에 통화/국가 컬럼 추가
      ALTER TABLE nf_aw_invoices ADD COLUMN country TEXT;
      ALTER TABLE nf_aw_invoices ADD COLUMN display_currency TEXT;
      ALTER TABLE nf_aw_invoices ADD COLUMN display_amount REAL;

      -- 구독에 국가/통화 컬럼 추가
      ALTER TABLE nf_aw_subscriptions ADD COLUMN country TEXT;
      ALTER TABLE nf_aw_subscriptions ADD COLUMN currency TEXT;
    `,
  },
  {
    version: 24,
    name: 'add_notifications',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_notifications (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        type       TEXT NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT,
        link       TEXT,
        read       INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON nf_notifications(user_id, read, created_at);
    `,
  },
  {
    version: 25,
    name: 'add_user_id_to_webhook_events',
    sql: `ALTER TABLE nf_webhook_events ADD COLUMN user_id TEXT;`,
  },
  {
    version: 26,
    name: 'add_sso_config_and_subscription_billing_period',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_sso_config (
        id           TEXT PRIMARY KEY DEFAULT 'singleton',
        provider     TEXT,
        entity_id    TEXT,
        sso_url      TEXT,
        certificate  TEXT,
        client_id    TEXT,
        client_secret TEXT,
        issuer       TEXT,
        enabled      INTEGER NOT NULL DEFAULT 0,
        updated_at   INTEGER NOT NULL
      );
      -- billing_period column for subscriptions created via Toss/direct payment
      ALTER TABLE nf_aw_subscriptions ADD COLUMN billing_period TEXT;
    `,
  },
  {
    version: 27,
    name: 'create_nf_files',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_files (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        storage_key  TEXT NOT NULL,
        filename     TEXT NOT NULL,
        mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes   INTEGER NOT NULL DEFAULT 0,
        category     TEXT NOT NULL DEFAULT 'general',
        ref_type     TEXT,
        ref_id       TEXT,
        created_at   INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES nf_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_files_user ON nf_files(user_id);
      CREATE INDEX IF NOT EXISTS idx_files_ref ON nf_files(ref_type, ref_id);
    `,
  },
  {
    version: 28,
    name: 'rbac_orgs_roles',
    sql: `
      -- 조직 (기업 단위)
      CREATE TABLE IF NOT EXISTS nf_orgs (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        slug            TEXT UNIQUE,
        business_number TEXT,
        plan            TEXT NOT NULL DEFAULT 'free',
        country         TEXT NOT NULL DEFAULT 'KR',
        owner_id        TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES nf_users(id) ON DELETE CASCADE
      );

      -- 조직 멤버
      CREATE TABLE IF NOT EXISTS nf_org_members (
        id         TEXT PRIMARY KEY,
        org_id     TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'member',
        joined_at  INTEGER NOT NULL,
        FOREIGN KEY (org_id) REFERENCES nf_orgs(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES nf_users(id) ON DELETE CASCADE,
        UNIQUE(org_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_org_members_user ON nf_org_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_org_members_org ON nf_org_members(org_id);

      -- 제품별 역할
      CREATE TABLE IF NOT EXISTS nf_user_roles (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        product    TEXT NOT NULL,
        role       TEXT NOT NULL,
        org_id     TEXT,
        granted_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES nf_users(id) ON DELETE CASCADE,
        UNIQUE(user_id, product, role)
      );
      CREATE INDEX IF NOT EXISTS idx_user_roles_user ON nf_user_roles(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_roles_product ON nf_user_roles(product, role);

      -- nf_users에 global role 추가
      ALTER TABLE nf_users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

      -- 구독/인보이스에 org_id 추가
      ALTER TABLE nf_aw_subscriptions ADD COLUMN org_id TEXT;
      ALTER TABLE nf_aw_invoices ADD COLUMN org_id TEXT;
    `,
  },
  {
    version: 29,
    name: 'org_invites',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_org_invites (
        id          TEXT PRIMARY KEY,
        org_id      TEXT NOT NULL,
        email       TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT 'member',
        token       TEXT NOT NULL UNIQUE,
        status      TEXT NOT NULL DEFAULT 'pending',
        expires_at  INTEGER NOT NULL,
        invited_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (org_id) REFERENCES nf_orgs(id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by) REFERENCES nf_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_org_invites_org ON nf_org_invites(org_id, status);
      CREATE INDEX IF NOT EXISTS idx_org_invites_token ON nf_org_invites(token);
    `,
  },
  {
    version: 30,
    name: 'user_avatar_url',
    sql: `ALTER TABLE nf_users ADD COLUMN avatar_url TEXT;`,
  },
  {
    version: 31,
    name: 'user_profile_fields',
    sql: `
      ALTER TABLE nf_users ADD COLUMN language TEXT;
      ALTER TABLE nf_users ADD COLUMN country TEXT;
      ALTER TABLE nf_users ADD COLUMN timezone TEXT;
      ALTER TABLE nf_users ADD COLUMN phone TEXT;
      ALTER TABLE nf_users ADD COLUMN company TEXT;
      ALTER TABLE nf_users ADD COLUMN job_title TEXT;
      ALTER TABLE nf_users ADD COLUMN signup_source TEXT;
      ALTER TABLE nf_users ADD COLUMN last_login_at INTEGER;
      ALTER TABLE nf_users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE nf_users ADD COLUMN signup_ip TEXT;
      ALTER TABLE nf_users ADD COLUMN last_login_ip TEXT;
    `,
  },
  {
    version: 32,
    name: 'login_history',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_login_history (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        ip          TEXT NOT NULL,
        country     TEXT,
        user_agent  TEXT,
        method      TEXT NOT NULL DEFAULT 'email',
        success     INTEGER NOT NULL DEFAULT 1,
        risk_level  TEXT NOT NULL DEFAULT 'normal',
        risk_reason TEXT,
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES nf_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_login_history_user ON nf_login_history(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_login_history_ip ON nf_login_history(ip, created_at);

      CREATE TABLE IF NOT EXISTS nf_security_alerts (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        alert_type  TEXT NOT NULL,
        severity    TEXT NOT NULL DEFAULT 'medium',
        details     TEXT,
        resolved    INTEGER NOT NULL DEFAULT 0,
        resolved_by TEXT,
        resolved_at INTEGER,
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES nf_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_security_alerts_user ON nf_security_alerts(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_security_alerts_unresolved ON nf_security_alerts(resolved, created_at);
    `,
  },
  {
    version: 33,
    name: 'unified_services',
    sql: `
      ALTER TABLE nf_users ADD COLUMN services TEXT NOT NULL DEFAULT '["nexyfab"]';
      ALTER TABLE nf_users ADD COLUMN signup_service TEXT DEFAULT 'nexyfab';
      ALTER TABLE nf_users ADD COLUMN nexyfab_plan TEXT;
      ALTER TABLE nf_users ADD COLUMN nexyflow_plan TEXT NOT NULL DEFAULT 'free';
      ALTER TABLE nf_users ADD COLUMN oauth_provider TEXT;
      ALTER TABLE nf_users ADD COLUMN oauth_id TEXT;
      ALTER TABLE nf_users ADD COLUMN account_type TEXT DEFAULT 'personal';
      ALTER TABLE nf_users ADD COLUMN business_reg_number TEXT;
      ALTER TABLE nf_users ADD COLUMN industry TEXT;
      ALTER TABLE nf_users ADD COLUMN employee_size TEXT;
      ALTER TABLE nf_users ADD COLUMN terms_agreed_at INTEGER;
      ALTER TABLE nf_users ADD COLUMN privacy_agreed_at INTEGER;
      ALTER TABLE nf_users ADD COLUMN age_confirmed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE nf_users ADD COLUMN marketing_agreed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE nf_users ADD COLUMN marketing_agreed_at INTEGER;
      ALTER TABLE nf_users ADD COLUMN updated_at INTEGER;

      -- nexyfab_plan을 기존 plan 값으로 동기화
      UPDATE nf_users SET nexyfab_plan = plan;

      -- login_history에 service 컬럼 추가
      ALTER TABLE nf_login_history ADD COLUMN service TEXT NOT NULL DEFAULT 'nexyfab';

      -- security_alerts에 service 컬럼 추가
      ALTER TABLE nf_security_alerts ADD COLUMN service TEXT DEFAULT 'nexyfab';
    `,
  },
  {
    version: 34,
    name: 'embed_configs_and_indexes',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_embed_configs (
        token           TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL,
        allowed_origins TEXT NOT NULL DEFAULT '[]',
        features        TEXT NOT NULL DEFAULT '[]',
        rfq_auto_submit INTEGER NOT NULL DEFAULT 1,
        branding        TEXT NOT NULL DEFAULT '{}',
        status          TEXT NOT NULL DEFAULT 'active',
        created_at      INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_plan ON nf_users(plan);
      CREATE INDEX IF NOT EXISTS idx_users_role ON nf_users(role);
      CREATE INDEX IF NOT EXISTS idx_users_last_login ON nf_users(last_login_at);
      CREATE INDEX IF NOT EXISTS idx_users_locked_until ON nf_users(locked_until);
      CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON nf_verification_codes(expires_at);
      CREATE INDEX IF NOT EXISTS idx_embed_configs_user ON nf_embed_configs(user_id);
    `,
  },
  {
    version: 35,
    name: 'nf_factories',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_factories (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        name_ko         TEXT,
        region          TEXT NOT NULL DEFAULT 'KR',
        processes       TEXT NOT NULL DEFAULT '[]',
        min_lead_time   INTEGER NOT NULL DEFAULT 7,
        max_lead_time   INTEGER NOT NULL DEFAULT 30,
        rating          REAL NOT NULL DEFAULT 4.0,
        review_count    INTEGER NOT NULL DEFAULT 0,
        price_level     TEXT NOT NULL DEFAULT 'medium',
        certifications  TEXT NOT NULL DEFAULT '[]',
        description     TEXT,
        description_ko  TEXT,
        contact_email   TEXT,
        contact_phone   TEXT,
        website         TEXT,
        status          TEXT NOT NULL DEFAULT 'active',
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_factories_region ON nf_factories(region, status);
      CREATE INDEX IF NOT EXISTS idx_factories_status ON nf_factories(status);
    `,
  },
  {
    version: 36,
    name: 'rfq_assigned_factory',
    sql: `
      ALTER TABLE nf_rfqs ADD COLUMN assigned_factory_id TEXT;
      ALTER TABLE nf_rfqs ADD COLUMN assigned_at INTEGER;
      CREATE INDEX IF NOT EXISTS idx_rfqs_factory ON nf_rfqs(assigned_factory_id);
    `,
  },
  {
    version: 37,
    name: 'nf_contracts',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_contracts (
        id                      TEXT PRIMARY KEY,
        project_name            TEXT NOT NULL,
        status                  TEXT NOT NULL DEFAULT 'contracted',
        partner_email           TEXT,
        factory_name            TEXT,
        deadline                TEXT,
        contract_amount         REAL,
        commission_rate         REAL,
        base_commission_rate    REAL,
        gross_commission        REAL,
        plan_deduction          REAL,
        final_charge            REAL,
        is_first_contract       INTEGER DEFAULT 0,
        first_contract_discount REAL DEFAULT 0,
        commission_status       TEXT,
        completed_at            TEXT,
        completion_requested    INTEGER DEFAULT 0,
        completion_requested_at TEXT,
        customer_email          TEXT,
        customer_contact        TEXT,
        quote_id                TEXT,
        plan                    TEXT,
        progress_percent        INTEGER DEFAULT 0,
        progress_notes          TEXT,
        created_at              TEXT NOT NULL,
        updated_at              TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_contracts_partner  ON nf_contracts(partner_email);
      CREATE INDEX IF NOT EXISTS idx_contracts_status   ON nf_contracts(status);
      CREATE INDEX IF NOT EXISTS idx_contracts_customer ON nf_contracts(customer_email);
    `,
  },
  {
    version: 38,
    name: 'webhook_events_payload',
    sql: `ALTER TABLE nf_webhook_events ADD COLUMN payload TEXT;`,
  },
  {
    version: 39,
    name: 'nf_settlements',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_settlements (
        id                    TEXT PRIMARY KEY,
        contract_id           TEXT NOT NULL UNIQUE,
        project_name          TEXT NOT NULL,
        factory_name          TEXT NOT NULL DEFAULT '',
        contract_amount       REAL NOT NULL DEFAULT 0,
        commission_rate       REAL NOT NULL DEFAULT 0,
        gross_commission      REAL NOT NULL DEFAULT 0,
        plan_deduction        REAL NOT NULL DEFAULT 0,
        final_charge          REAL NOT NULL DEFAULT 0,
        is_first_contract     INTEGER NOT NULL DEFAULT 0,
        first_contract_discount REAL NOT NULL DEFAULT 0,
        status                TEXT NOT NULL DEFAULT 'pending',
        invoice_number        TEXT,
        invoiced_at           TEXT,
        paid_at               TEXT,
        notes                 TEXT NOT NULL DEFAULT '',
        created_at            TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_settlements_contract ON nf_settlements(contract_id);
      CREATE INDEX IF NOT EXISTS idx_settlements_status   ON nf_settlements(status);
    `,
  },
  {
    version: 40,
    name: 'quotes_partner_response_columns',
    sql: `
      ALTER TABLE nf_quotes ADD COLUMN estimated_days INTEGER;
      ALTER TABLE nf_quotes ADD COLUMN partner_note TEXT;
      ALTER TABLE nf_quotes ADD COLUMN responded_at INTEGER;
      ALTER TABLE nf_quotes ADD COLUMN responded_by TEXT;
    `,
  },
  {
    version: 41,
    name: 'nf_inquiries',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_inquiries (
        id            TEXT PRIMARY KEY,
        action        TEXT NOT NULL DEFAULT 'send_contact',
        name          TEXT NOT NULL,
        email         TEXT NOT NULL,
        project_name  TEXT NOT NULL,
        budget        TEXT,
        message       TEXT NOT NULL DEFAULT '',
        phone         TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        admin_note    TEXT,
        rfq_id        TEXT,
        shape_id      TEXT,
        material_id   TEXT,
        volume_cm3    REAL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_inquiries_email  ON nf_inquiries(email);
      CREATE INDEX IF NOT EXISTS idx_inquiries_status ON nf_inquiries(status);
      CREATE INDEX IF NOT EXISTS idx_inquiries_action ON nf_inquiries(action);
    `,
  },
  {
    version: 42,
    name: 'factories_partner_profile_and_contracts_attachments',
    sql: `
      ALTER TABLE nf_factories ADD COLUMN partner_email TEXT;
      ALTER TABLE nf_factories ADD COLUMN tech_exp TEXT;
      ALTER TABLE nf_factories ADD COLUMN match_field TEXT;
      ALTER TABLE nf_factories ADD COLUMN capacity_amount TEXT;
      ALTER TABLE nf_factories ADD COLUMN partner_type TEXT;
      CREATE INDEX IF NOT EXISTS idx_factories_partner_email ON nf_factories(partner_email);
      ALTER TABLE nf_contracts ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 43,
    name: 'nf_users_sso_sub',
    sql: `
      ALTER TABLE nf_users ADD COLUMN sso_sub TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_users_sso_sub
        ON nf_users(sso_sub) WHERE sso_sub IS NOT NULL;
    `,
  },
  {
    version: 44,
    name: 'nf_quote_remind_log_and_email_templates',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_quote_remind_log (
        id          TEXT    PRIMARY KEY,
        quote_id    TEXT    NOT NULL,
        recipient   TEXT    NOT NULL,
        sent_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nf_quote_remind_log_quote
        ON nf_quote_remind_log(quote_id);
      CREATE TABLE IF NOT EXISTS nf_email_templates (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT '일반',
        content     TEXT NOT NULL,
        variables   TEXT NOT NULL DEFAULT '[]',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
    `,
  },
  {
    version: 45,
    name: 'nf_partner_tokens_and_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_partner_tokens (
        id          TEXT PRIMARY KEY,
        partner_id  TEXT NOT NULL,
        email       TEXT NOT NULL,
        company     TEXT NOT NULL DEFAULT '',
        token_hash  TEXT NOT NULL UNIQUE,
        expires_at  INTEGER NOT NULL,
        used        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nf_partner_tokens_email
        ON nf_partner_tokens(email, used);
      CREATE TABLE IF NOT EXISTS nf_partner_sessions (
        id              TEXT PRIMARY KEY,
        session_hash    TEXT NOT NULL UNIQUE,
        partner_id      TEXT NOT NULL,
        user_id         TEXT,
        email           TEXT NOT NULL,
        company         TEXT NOT NULL DEFAULT '',
        expires_at      INTEGER NOT NULL,
        created_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nf_partner_sessions_hash
        ON nf_partner_sessions(session_hash);
    `,
  },
  {
    version: 46,
    name: 'nf_simulations',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_simulations (
        id          TEXT PRIMARY KEY,
        share_code  TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        inputs      TEXT NOT NULL DEFAULT '{}',
        results     TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nf_simulations_share ON nf_simulations(share_code);
      CREATE INDEX IF NOT EXISTS idx_nf_simulations_expires ON nf_simulations(expires_at);
    `,
  },
  {
    version: 47,
    name: 'nf_error_logs',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_error_logs (
        id         TEXT PRIMARY KEY,
        level      TEXT NOT NULL DEFAULT 'error',
        message    TEXT NOT NULL,
        stack      TEXT,
        context    TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nf_error_logs_created ON nf_error_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_nf_error_logs_level   ON nf_error_logs(level);
    `,
  },
  {
    version: 48,
    name: 'nf_reviews',
    sql: `
      CREATE TABLE IF NOT EXISTS nf_reviews (
        id                  TEXT PRIMARY KEY,
        contract_id         TEXT NOT NULL,
        partner_email       TEXT NOT NULL,
        reviewer_email      TEXT NOT NULL,
        rating              INTEGER NOT NULL,
        cat_deadline        INTEGER NOT NULL DEFAULT 0,
        cat_quality         INTEGER NOT NULL DEFAULT 0,
        cat_communication   INTEGER NOT NULL DEFAULT 0,
        comment             TEXT NOT NULL DEFAULT '',
        reviewed_at         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_partner  ON nf_reviews(partner_email);
      CREATE INDEX IF NOT EXISTS idx_reviews_contract ON nf_reviews(contract_id);
    `,
  },
  {
    version: 49,
    name: 'nf_releases',
    sql: `
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
        created_at           INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nf_releases_latest ON nf_releases(is_latest);
    `,
  },
  {
    version: 50,
    name: 'nf_releases_download_counters',
    sql: `
      ALTER TABLE nf_releases ADD COLUMN dl_win_x64     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE nf_releases ADD COLUMN dl_mac_aarch64 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE nf_releases ADD COLUMN dl_mac_x64     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE nf_releases ADD COLUMN dl_linux_x64   INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

function runMigrations(db: Database.Database): void {
  // migrations 테이블 보장
  db.exec(`
    CREATE TABLE IF NOT EXISTS nf_schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set<number>(
    (db.prepare('SELECT version FROM nf_schema_migrations').all() as { version: number }[])
      .map((r) => r.version),
  );

  const insert = db.prepare(
    'INSERT INTO nf_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    if (m.sql) {
      db.exec(m.sql);
    }
    insert.run(m.version, m.name, Date.now());
  }
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nf_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      email_verified INTEGER NOT NULL DEFAULT 0,
      project_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nf_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      shape_id TEXT,
      material_id TEXT,
      scene_data TEXT,
      thumbnail TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES nf_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS nf_rfqs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_email TEXT,
      shape_id TEXT,
      shape_name TEXT,
      material_id TEXT,
      quantity INTEGER DEFAULT 1,
      volume_cm3 REAL,
      surface_area_cm2 REAL,
      bbox TEXT,
      dfm_results TEXT,
      cost_estimates TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      quote_amount REAL,
      manufacturer_note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nf_shares (
      token TEXT PRIMARY KEY,
      user_id TEXT,
      mesh_data_base64 TEXT NOT NULL,
      metadata TEXT,
      expires_at INTEGER NOT NULL,
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nf_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      position TEXT NOT NULL,
      text TEXT NOT NULL,
      author TEXT NOT NULL,
      author_plan TEXT,
      type TEXT NOT NULL DEFAULT 'comment',
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nf_orders (
      id TEXT PRIMARY KEY,
      rfq_id TEXT,
      user_id TEXT NOT NULL,
      part_name TEXT NOT NULL,
      manufacturer_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      total_price_krw REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed',
      steps TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      estimated_delivery_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nf_collab_sessions (
      session_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      cursor TEXT,
      color TEXT NOT NULL,
      last_ping INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nf_audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_id TEXT,
      metadata TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nf_verification_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nf_sso_config (
      org_id TEXT PRIMARY KEY,
      provider TEXT,
      entity_id TEXT,
      sso_url TEXT,
      certificate TEXT,
      client_id TEXT,
      issuer TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_user ON nf_projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_rfqs_user ON nf_rfqs(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_project ON nf_comments(project_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON nf_audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_collab_project ON nf_collab_sessions(project_id);
  `);

  // ─── Schema migrations ────────────────────────────────────────────────────────
  runMigrations(db);

  // Seed test accounts (development only)
  if (process.env.NODE_ENV !== 'production') {
    const seedUser = db.prepare(
      `INSERT OR IGNORE INTO nf_users (id, email, name, password_hash, plan, role, email_verified, created_at, updated_at, signup_source, language, country, timezone, company, last_login_at, login_count)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'email', 'ko', 'KR', 'Asia/Seoul', ?, ?, 0)`
    );
    const now = Date.now();
    seedUser.run('test-user-001', 'test@nexysys.com', '테스트 사용자', '$2b$12$JGmaUOTctnIZ1RcrdT8C1ORhsfwWqJt2r3viNvuqoiMuL9MDSGZ.C', 'pro', 'user', now, now, 'Nexysys Lab', now);
    seedUser.run('test-user-003', 'orgadmin@nexysys.com', '고객사관리자', '$2b$12$0Z4QvmQghxWktNGTxKIm1.ode.QnGiGmRkLV0OCBatB414pyY/on2', 'pro', 'user', now, now, 'Nexysys Lab', now);
    seedUser.run('test-user-fab-customer', 'customer@nexyfab.com', 'NexyFab 고객사', '$2b$12$N5FtAmV7Atwo39QBY7s9GuJRa5V5AwSXEnAQznlCNIug3Crxo8NwG', 'pro', 'user', now, now, '테스트 고객사', now);
    seedUser.run('test-user-fab-partner', 'partner@nexyfab.com', 'NexyFab 파트너사', '$2b$12$/LPNm26UpyY/y7Oxke9X8e8OrfF2tC53MQwqsjtyGxos0CcAF9cKy', 'pro', 'user', now, now, '테스트 파트너사', now);

    // Seed RBAC roles for test accounts
    const seedRole = db.prepare(
      `INSERT OR IGNORE INTO nf_user_roles (id, user_id, product, role, org_id, granted_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    );
    seedRole.run('role-test-001-fab', 'test-user-001', 'nexyfab', 'customer', now);
    seedRole.run('role-test-001-flow', 'test-user-001', 'nexyflow', 'member', now);
    seedRole.run('role-test-003-flow', 'test-user-003', 'nexyflow', 'org_admin', now);
    seedRole.run('role-fab-customer', 'test-user-fab-customer', 'nexyfab', 'customer', now);
    seedRole.run('role-fab-partner', 'test-user-fab-partner', 'nexyfab', 'partner', now);
  }

  // Seed demo audit entries if empty
  const count = (
    db.prepare('SELECT COUNT(*) as c FROM nf_audit_log').get() as { c: number }
  ).c;
  if (count === 0) {
    const now = Date.now();
    const MIN = 60_000;
    const insert = db.prepare(
      `INSERT OR IGNORE INTO nf_audit_log (id, user_id, action, resource_id, metadata, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run('aud-001', 'ent-user-001', 'project.create', 'proj-abc123', JSON.stringify({ name: 'AL6061 브래킷 v2', shapeId: 'lBracket' }), '203.0.113.42', now - 90 * MIN);
    insert.run('aud-002', 'ent-user-001', 'rfq.submit', 'rfq-0421', JSON.stringify({ partName: 'AL6061 브래킷', quantity: 50, materialId: 'al6061' }), '203.0.113.42', now - 60 * MIN);
    insert.run('aud-003', 'ent-user-002', 'export.stl', 'proj-def456', JSON.stringify({ fileName: 'flange_dn50.stl', fileSizeBytes: 204800 }), '198.51.100.17', now - 30 * MIN);
    insert.run('aud-004', 'ent-user-001', 'project.share', 'proj-abc123', JSON.stringify({ shareToken: 'abc123', expiresInHours: 72 }), '203.0.113.42', now - 10 * MIN);
  }
}

// ─── DB Stats (for health check) ─────────────────────────────────────────────

export function getDbStats(): { sizeBytes: number; walSizeBytes: number; pageCount: number } {
  const db = getDb();
  try {
    const pageCount = (db.pragma('page_count', { simple: true }) as number) ?? 0;
    const pageSize = (db.pragma('page_size', { simple: true }) as number) ?? 4096;
    return {
      sizeBytes: pageCount * pageSize,
      walSizeBytes: 0, // WAL size not directly queryable without fs
      pageCount,
    };
  } catch {
    return { sizeBytes: 0, walSizeBytes: 0, pageCount: 0 };
  }
}
