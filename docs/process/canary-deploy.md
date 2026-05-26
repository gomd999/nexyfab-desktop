# Canary Deploy Strategy

**Status:** active (Wave 0) · **Adopted:** 2026-05-26

True percentage-based canary (5% → 100% traffic split) requires
infrastructure we don't currently pay for. This runbook documents the
Wave 0 *manual canary* — staging smoke before prod promote — and the
options to upgrade to automated % canary later.

## Wave 0 — Manual canary (active now)

Every prod deploy flows through staging first.

```
local → wip branch → staging deploy → 60-min smoke → main → prod deploy
                                            │
                                            └─ failure: hold here, fix on wip
```

### Per-deploy procedure

1. **Open PR** with the change. 24-hour self-review delay
   (`self-review-policy.md`).

2. **Deploy to staging** before merging:
   ```bash
   railway environment staging
   railway up --service nexyfab.com --detach
   ```

3. **Smoke test on staging** (15-60 min depending on diff size).
   Walk through the 5 scenarios in
   `docs/strategy/smoke-test-3d-2026-05-13.md` plus anything the diff
   specifically touches. Watch Sentry for the staging project.

4. **Promote to prod** only if all of:
   - Staging smoke green
   - Staging Sentry error rate ≤ baseline (last 1h vs prior 1h)
   - No new error signatures unique to this build
   ```bash
   git merge wip/session-snapshot     # squash or rebase per repo policy
   git push origin main
   railway environment production
   railway up --service nexyfab.com --detach
   ```

5. **Watch prod for 1 hour after deploy.** If Sentry error rate jumps
   ≥ 1.5×, roll back (`git revert <merge-commit> && railway up`).

### What "smoke green" means

- 5 scenarios from `smoke-test-3d-2026-05-13.md` all pass on staging URL
- No console errors during the run (warnings OK)
- Network tab: no `/api/...` 5xx
- 3D viewport renders within 5s on a fresh load

## Wave 2+ — Automated % canary (deferred)

When the user base is large enough that "1 hour of prod observation"
isn't fast enough to catch regressions, upgrade.

### Option A — Cloudflare Load Balancer (~$5/mo + per-request)

- Define a pool with two origins: `prod-A` (current Railway service)
  and `prod-B` (a parallel Railway service running the new build).
- Set weights: 95/5 for canary, 0/100 for full rollout.
- Automated health checks on each origin.
- Best for: real % split with origin health detection.

### Option B — Cloudflare Worker traffic split (free tier covers it)

- Worker reads a `canary_fraction` from KV.
- Routes by `Math.random() < canary_fraction` to canary origin else prod.
- Sticky session via cookie so the same user doesn't flip.
- Best for: free, scriptable, but no origin health detection.

### Option C — Vercel-style preview deploys via Railway PR environments

- Each PR gets its own Railway env (paid feature).
- Internal testers hit the preview URL.
- Not a real canary (no end-user traffic) but useful for design partner
  validation before main merge.

## Rollback drill (quarterly)

Every quarter, do one **intentional rollback** in staging to keep the
muscle memory:

```bash
# In staging
railway environment staging
git revert HEAD --no-edit
railway up --service nexyfab.com --detach
# Time how long until staging URL serves the reverted code.
# Target: ≤ 10 min including detection.
```

Record the time in `docs/postmortem/rollback-drill-YYYY-MM-DD.md`. If
the time exceeds the target, fix the bottleneck before the next drill.

## Open questions for the user

- [ ] Approve $5-15/mo for Cloudflare Load Balancer when Wave 2 starts?
- [ ] Or build the Worker traffic-split (Option B) in Wave 1?
- [ ] How many design partners do we expect by Wave 3? That sizes the
      preview-env need (Option C).
