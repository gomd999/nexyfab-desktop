# Wave 1 GA — operational checklist

Companion to [ADR-009](./adr/009-wave-1-ga-gate.md). Run top to bottom;
each step blocks the next. The whole sequence is ~10 calendar days
including the burn-in window.

## 0. Prereqs

- [ ] Railway CLI installed and logged in (`railway whoami` returns user).
- [ ] `gh` CLI authenticated against `gomd999/nexyfab-desktop`.
- [ ] R2 bucket created in Cloudflare with API tokens stored in
      Railway env (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
      `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`).
- [ ] `JWT_SECRET` env set identically on Railway worker service AND
      main app deploy. (Same secret = the worker accepts the main
      app's worker-token mint.)

## 1. Provision the worker on Railway

```bash
cd occt-worker
railway init               # if not already linked to a service
railway up                 # deploys from current directory
```

After deploy completes, get the public URL:

```bash
railway domain             # copies the *.railway.app URL
curl https://<worker-url>/health
```

Expected response (cold start may take ~30s for WASM load):

```json
{
  "service": "nexyfab-occt-worker",
  "occt": "ready",
  "pool": {
    "size": 2,
    "ready": 2,
    "busy": 0,
    "queueDepth": 0,
    "memory": { "aggregateHeapUsedMb": 80, "maxSlotHeapUsedMb": 50 }
  }
}
```

If `occt: starting` persists past 60s → check Railway logs for
`replicad-opencascadejs` WASM load errors.

## 2. Merge the PR stack

Order matters — auto-retarget kicks in when a parent merges. Total: 22 PRs.

```bash
# Stack A — main base
gh pr merge 2  --squash --admin   # W3 + W6 (huge — 18 commits)
gh pr merge 3  --squash --admin   # docs
gh pr merge 4  --squash --admin   # worker scaffold + boolean
gh pr merge 5  --squash --admin   # main wrapper + r2-fetch

# Stack B — worker chain (auto-retargets to main as #4 lands)
gh pr merge 6  --squash --admin   # thread pool
gh pr merge 7  --squash --admin   # fillet/chamfer/shell
gh pr merge 8  --squash --admin   # extrude/revolve
gh pr merge 9  --squash --admin   # slot recycling
gh pr merge 10 --squash --admin   # soak + mem metrics
gh pr merge 11 --squash --admin   # polygon profile
gh pr merge 12 --squash --admin   # SVG parser
gh pr merge 13 --squash --admin   # Bezier flattening
gh pr merge 14 --squash --admin   # arc → cubic
gh pr merge 15 --squash --admin   # sweep/loft/pattern/mirror
gh pr merge 16 --squash --admin   # chained R2 input

# Stack C — wrapper chain (auto-retargets to main as #5 lands)
gh pr merge 17 --squash --admin   # 6 chainable wrappers
gh pr merge 18 --squash --admin   # 4 sketch wrappers
gh pr merge 19 --squash --admin   # boolean server hook
gh pr merge 20 --squash --admin   # boolean UI wire
gh pr merge 21 --squash --admin   # fillet/chamfer/shell hooks
gh pr merge 22 --squash --admin   # FCS UI handlers
```

After each merge, verify main is green:
```bash
gh run list --branch main --limit 1
```

## 3. Redeploy the main app

```bash
cd nexyfab.com/new
railway up
```

Set `NEXT_PUBLIC_OCCT_WORKER_URL=https://<worker-url>` in Railway
env for the main app deploy.

## 4. Soak gate (4 hours)

```bash
cd occt-worker
npm run soak -- --duration=14400 --ops-per-sec=1 --sample-every=60 | tee soak-$(date +%Y%m%d).log
```

The soak driver runs in-process (loads its own pool); doesn't
exercise the HTTP path. To soak the deployed worker too, use:

```bash
# (W17 follow-up: add a remote soak mode that drives the HTTP API)
```

Pass criterion (printed at end of log):
```
[soak] heap Q4 mean: <X>MB
[soak] heap Q1 mean: <Y>MB
[soak] heap growth ratio (Q4/Q1): <≤ 2.0> x
[soak] PASS
```

If FAIL, the recycling policy isn't bounding heap. Tune
`OCCT_MAX_OPS_PER_SLOT` lower (default 50 → try 25).

## 5. External CAD compat matrix (Task #29)

Run the 20 fixtures locally through Shape Generator's STEP export,
then open each in 5 viewers:

| Fixture | Onshape | Fusion 360 | SolidWorks | FreeCAD | Onshape Mobile |
|---|---|---|---|---|---|
| `cube-100mm.step` | ☐ | ☐ | ☐ | ☐ | ☐ |
| `cyl-cut-50r.step` | ☐ | ☐ | ☐ | ☐ | ☐ |
| `…18 more…` | | | | | |

Mark each cell ✓ (opens + measurement correct) or ✗ (open fails or
geometry wrong). Tally to `docs/wave-1-compat-matrix.md`.

Pass criterion: ≥ 70% ✓ across all 100 cells (gate #3 in ADR-009).

## 6. External engineer outreach (Task #28)

Contact ≥ 1 SW/Fusion power-user. Provide:
- Production URL
- 3-5 representative fixtures
- 30-min onboarding call

Capture their session feedback in `docs/wave-1-ext-feedback-{name}.md`.

Pass criterion: zero kernel crashes reported (gate #4 in ADR-009).

## 7. Burn-in (7 calendar days)

Open Wave 1 to internal dogfood:
- Set Sentry alert: `server_boolean_unavailable` rate > 5% per hour
  → page on-call.
- Set Sentry alert: `pool.recycles` climbing > 10/hour → investigate
  kernel instability.
- Track `server_boolean_path_ok` event count per day in Grafana.

Pass criterion: 7 consecutive days within thresholds (gate #5).

## 8. GA announce or hold

After gate review (target: 2026-09-24, W17 end):

- **All 5 gates pass** → tag `wave-1-ga`, public announce, ADR-010
  starts (Wave 2 entry).
- **1-2 fail** → Wave 1.1 patch cycle. P1 fixes only; no scope creep.
- **3+ fail** → escalate to kernel-strategy ADR (paid license?).
