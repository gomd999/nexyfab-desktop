# Staging Environment Setup — Railway

**Status:** runbook · **Drafted:** 2026-05-26 (Wave 0 Day 3)
**Required before:** Wave 1 deploys, canary rollouts, smoke verification

Railway currently has **only `production`**. A staging environment is
required so deploys can be smoke-tested against a real running service
before promoting to prod. This runbook captures the decisions the user
must make and the exact commands to run after each is made.

## Decisions you must make first

### D1 — Database strategy

| Option | Cost | Realism | Risk |
|---|---|---|---|
| **A. Fresh empty Postgres** in staging | +$5/mo | Low — won't catch data-shape bugs | Lowest blast radius |
| **B. Read-only replica** of prod (Railway snapshot restore) | +$5/mo + snapshot quota | High — real data shape | Stale data; restore drift |
| **C. Share prod DB** (staging app → prod DB) | $0 | Highest realism | **Dangerous** — bad staging code writes to prod tables |
| **D. Nightly dump → staging restore** cron | +$5/mo | High | Snapshot lag (≤24h) |

**Recommendation:** **A** for Wave 0 (cheapest, fastest), then upgrade to
**D** in Wave 3+ when stakes get higher.

### D2 — Domain

| Option | Setup |
|---|---|
| `nexyfab-staging.up.railway.app` (Railway default) | Free, instant |
| `staging.nexyfab.com` (Cloudflare CNAME) | 5 min CF setup |

**Recommendation:** Railway default for Wave 0. Custom subdomain when
external testers join.

### D3 — Env vars

Most env vars can be copied from prod. The protected-state variables below
must differ:

| Var | Prod value | Staging value |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://nexyfab.com` | `https://nexyfab-staging.up.railway.app` |
| `DB_URL` / `DATABASE_URL` | prod | per D1 above |
| `REDIS_URL` | prod | separate staging Redis |
| `JWT_SECRET` | prod secret | **different** secret (so prod tokens are invalid in staging) |
| `S3_BUCKET` | prod bucket | separate staging bucket |

Required runtime differences when the provider is configured:
- `DODO_*` — separate credentials/product IDs and `DODO_MODE=test`
- `TOSS_*` — separate `test_` credentials
- `STRIPE_*` — separate `sk_test_` credentials
- `NEXYFAB_CAD_INDEPENDENT_MODE=1` — fail closed if distributed quota is unavailable

Optional differences:
- `AIRWALLEX_*` — sandbox
- `RESEND_API_KEY` — separate sender domain or send to `/dev/null` via test API key
- `SENTRY_DSN` — separate project so staging noise doesn't pollute prod issues

## Commands (after decisions)

```bash
# 1. Create the env, duplicating prod's service layout
railway environment new staging --duplicate production

# 2. Link the local CLI to staging for the next commands
railway environment staging

# 3. Override the three required env vars (D3 above)
railway variables --set NEXT_PUBLIC_SITE_URL=https://nexyfab-staging.up.railway.app
railway variables --set JWT_SECRET=$(openssl rand -hex 32)
# DB_URL handled per D1 (new Postgres service or restore from snapshot)

# 4. Fail closed if staging still shares protected production state or live payment keys
npm run staging:isolation:check

# 5. Deploy the current branch
railway up --service nexyfab.com --detach

# 6. After deploy succeeds, verify URL
railway domain --service nexyfab.com
```

## Smoke verification on staging (one-time)

After first deploy, walk through these 5 scenarios from
`docs/strategy/smoke-test-3d-2026-05-13.md`:

1. Sketch → Extrude (radial menu)
2. Boolean cut + B1 face provenance
3. Face click + Mate
4. STEP export (Route A)
5. File import + Auto Drawing

If all 5 pass on staging, staging is ready to become the canary target
for Wave 1.

## Cost tracking

Add staging cost to monthly budget review. Expected: $5-15/mo extra on
top of prod (compute + small DB).

## Tearing it down

If staging proves too costly or unused:

```bash
railway environment delete staging
```

This is reversible only by recreating — not destructive of code, but
loses any data unique to the staging DB.
