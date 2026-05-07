# Environment Variables Setup

Complete guide for all required environment variables, grouped by service.

Copy `.env.example` to `.env.local` (development) or set these in your Railway/Cloudflare dashboard (production).

---

## Required for Production

### Application

```env
NEXT_PUBLIC_APP_URL=https://nexyfab.com
NEXT_PUBLIC_SITE_URL=https://nexyfab.com
NODE_ENV=production
```

### Database

```env
# Option A — Railway Volume (SQLite)
# Mount a Railway Volume to /data, then set:
DATA_ROOT=/data
# Or specify full path:
# NEXYFAB_DB_PATH=/data/nexyfab.db

# Option B — PostgreSQL (Neon, Supabase, Railway Postgres)
DATABASE_URL=postgresql://user:password@host:5432/nexyfab?sslmode=require
```

### Authentication

```env
# 32+ char random string: openssl rand -base64 32
JWT_SECRET=

# 32+ char random string for cron job auth
CRON_SECRET=

# bcrypt hash of admin password: node -e "require('bcryptjs').hash('pw',12).then(console.log)"
ADMIN_PASSWORD_HASH=
ADMIN_SECRET=
```

### Stripe (Payment — Global)

```env
STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

> Get the webhook secret from Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret.
> Register `https://nexyfab.com/api/stripe/webhook` as the endpoint URL.

### Airwallex (Payment — Alternative Global)

```env
AIRWALLEX_CLIENT_ID=
AIRWALLEX_API_KEY=
AIRWALLEX_WEBHOOK_SECRET=
# "prod" for production, anything else = sandbox
AIRWALLEX_ENV=prod
```

### Toss Payments (Korea)

```env
NEXT_PUBLIC_TOSS_CLIENT_KEY=
TOSS_SECRET_KEY=
TOSS_WEBHOOK_SECRET=
```

### Email (SMTP)

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@nexyfab.com
SMTP_PASS=
SMTP_FROM=noreply@nexyfab.com
ADMIN_EMAIL=admin@nexyfab.com
# Comma-separated notification recipients (defaults to ADMIN_EMAIL)
SEND_MAIL_RECIPIENTS=admin@nexyfab.com
```

> For AWS SES: set `SMTP_HOST=email-smtp.ap-northeast-2.amazonaws.com`, `SMTP_PORT=587`,
> `SMTP_USER=<SES access key>`, `SMTP_PASS=<SES secret key>`.

### Cloudflare R2 (File Storage)

```env
# R2 endpoint format: https://<account_id>.r2.cloudflarestorage.com
S3_ENDPOINT=
S3_BUCKET=nexyfab
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
# Optional: public bucket URL for direct access (otherwise signed URLs are used)
# S3_PUBLIC_URL=https://pub-xxx.r2.dev
```

### AI APIs

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

QWEN_API_KEY=
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### reCAPTCHA v3

```env
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=
```

### Market Data

```env
ALPHAVANTAGE_API_KEY=
```

### Monitoring (Sentry)

```env
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=nexyfab-web
SENTRY_AUTH_TOKEN=
```

### Redis (Optional — Production Rate Limiting)

```env
# rediss:// for TLS (Railway Redis uses rediss://)
REDIS_URL=rediss://user:password@host:port
```

### Nexysys SSO

```env
NEXYSYS_AUTH_URL=https://auth.nexysys.com
```

### CORS (Optional)

```env
# Comma-separated allowed origins for partner/external API calls
# CORS_ALLOWED_ORIGINS=https://partner.example.com,https://app.example.com
```

---

## Minimal Local Development

For local development you only need:

```env
JWT_SECRET=any-32-char-dev-secret-here-ok
CRON_SECRET=any-32-char-dev-cron-secret-ok
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

SQLite will be used automatically (no `DATABASE_URL` needed).
Stripe/Airwallex/Toss calls will fail gracefully if keys are absent.
Email falls back to console.log when `SMTP_HOST` is not set.

---

## Nexyfab API — STEP (B-Rep) & OpenSCAD bridge

| Variable | Default | Purpose |
|----------|---------|---------|
| `BREP_WORKER_URL` | (unset) | Base URL of OCCT/tessellate worker; `POST {base}/tessellate` with JSON `filename`, `base64`, `jobId`. |
| `BREP_WORKER_TIMEOUT_MS` | `120000` | HTTP timeout for worker `fetch` (ms, min 5000). |
| `BREP_MAX_QUEUE_DEPTH` | `200` | Max **pending** jobs (Redis + in-memory queue) before `503` + `QUEUE_FULL` on async STEP import. |
| `NEXT_PUBLIC_SERVER_STEP_IMPORT` | (set) | Client: set to `0` to disable server STEP preview and use browser-only import. |
| `OPENSCAD_BIN` | (PATH) | OpenSCAD CLI binary path when not on `PATH` (see `JSCAD_OPENSCAD_BRIDGE.md`). |

Local mock worker (development): `nexyfab.com/new/services/brep-worker-mock` — run `npm install && node server.mjs`, then `BREP_WORKER_URL=http://127.0.0.1:8787`.

Verbose API logs (STEP worker retries, CLI failures): `NF_API_DEBUG=1`.

### Enterprise / ops

```env
# Log CAD pipeline actions (STEP/OpenSCAD) to nf_audit_log for Free tier too (default: Pro+ only).
NEXYFAB_CAD_AUDIT_ALL=0

# Optional — shown in GET /api/nexyfab/enterprise/status
NEXYFAB_SUPPORT_EMAIL=support@example.com
NEXYFAB_SLA_STATUS_URL=https://status.example.com
NEXYFAB_ENTERPRISE_DOCS_URL=https://docs.example.com/enterprise
```

SCIM provisioning stub: `GET|POST /api/enterprise/scim/*` returns `501` until directory sync is implemented.

---

## Generating Secrets

```bash
# JWT_SECRET / CRON_SECRET
openssl rand -base64 32

# ADMIN_SECRET
openssl rand -hex 16

# ADMIN_PASSWORD_HASH (replace 'yourpassword')
node -e "require('bcryptjs').hash('yourpassword', 12).then(console.log)"
```

---

## Railway Deployment Checklist

1. Set all **Required for Production** vars in Railway Dashboard → Variables
2. Add a Railway Volume mounted at `/data` and set `DATA_ROOT=/data`
3. Register Stripe webhook endpoint: `https://nexyfab.com/api/stripe/webhook`
4. Register Airwallex webhook endpoint: `https://nexyfab.com/api/billing/webhook`
5. Verify `STRIPE_WEBHOOK_SECRET` and `AIRWALLEX_WEBHOOK_SECRET` match the dashboard values
6. Run `railway up` from `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\new`
