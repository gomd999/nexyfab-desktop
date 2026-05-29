# Phase 3 Hands-on — Awareness Latency Runbook

**Status:** runbook (manual execution required — CI does not have a
live collab worker)
**Spec:** `e2e/collab-awareness-latency.spec.ts`
**Closes:** 1 of 4 Phase 3 hands-on items per
`docs/wave-2-phase-3-exit.md` §7
**Budget:** ADR-012 §8 — peer cursor / awareness p95 ≤ 200 ms across
10 emit→observe round-trips

This is the **manual run procedure** for the awareness-latency
Playwright spec. The spec itself is committed and auto-skips in default
CI (it requires three concurrent env flags + a deployed worker URL),
so this runbook is the canonical procedure for closing the hands-on
gate before flag-graduation.

---

## 1. Pre-flight

Verify each line resolves to "yes" before starting.

- [ ] `occt-collab-worker` is live → `curl -s
      https://occt-collab-worker.gomd999.workers.dev/healthz` returns
      `{"ok":true,"service":"occt-collab-worker",...}`
- [ ] You have the JWT secret used by both the main app + the worker
      (`grep JWT_SECRET ~/Downloads/nexysys_1/.env`)
- [ ] Test signup endpoint is callable (Playwright `authenticatedRequest`
      will create 2 fresh users — rate limit is 5/min/IP, this fits)
- [ ] Playwright browsers installed: `npx playwright install chromium`
- [ ] The build you'll point Playwright at has CRDT enabled +
      debug-hook enabled (see §2 below)

---

## 2. Build the app with the required flags

The spec needs three NEXT_PUBLIC_* flags baked into the build (these
are inlined at build time; setting them at runtime won't help):

| Env var | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_NEXYFAB_CRDT` | `1` | Enables `?crdt=v2` opt-in path |
| `NEXT_PUBLIC_OCCT_COLLAB_WS_URL` | `wss://occt-collab-worker.gomd999.workers.dev` | Worker URL; spec checks both peers can reach it |
| `NEXT_PUBLIC_NEXYFAB_COLLAB_DEBUG` | `1` | Exposes `window.__nexyfabAwareness` (debug hook the spec measures against) |

Build:

```bash
cd nexyfab.com/new
NEXT_PUBLIC_NEXYFAB_CRDT=1 \
NEXT_PUBLIC_OCCT_COLLAB_WS_URL=wss://occt-collab-worker.gomd999.workers.dev \
NEXT_PUBLIC_NEXYFAB_COLLAB_DEBUG=1 \
npm run build
```

Start the server:

```bash
npm run start    # next start, listens on :3000
```

(On Windows PowerShell, the env-var syntax is `$env:NEXT_PUBLIC_NEXYFAB_CRDT='1'; ...; npm run build`.)

Sanity-check the build:
- Open `http://localhost:3000/en/shape-generator?crdt=v2` in a browser
- Open DevTools console → type `window.__nexyfabAwareness` → must
  return an `Awareness` object (NOT `undefined`)
- If undefined, the build is missing
  `NEXT_PUBLIC_NEXYFAB_COLLAB_DEBUG=1` — rebuild

---

## 3. Run the spec

```bash
E2E_BASE_URL=http://localhost:3000 \
NEXT_PUBLIC_NEXYFAB_CRDT=1 \
NEXT_PUBLIC_OCCT_COLLAB_WS_URL=wss://occt-collab-worker.gomd999.workers.dev \
NEXT_PUBLIC_NEXYFAB_COLLAB_DEBUG=1 \
npx playwright test e2e/collab-awareness-latency.spec.ts --project=chromium
```

The first three env vars are inlined into the test runner so the
`test.skip()` guards don't fire. Without all three you'll see the spec
silently skip.

Expected output (success):

```
Running 1 test using 1 worker
[awareness-latency] samples=10 p50=42ms p95=78ms max=112ms
  ✓ p95 awareness propagation ≤ 200ms across 10 samples (3.4s)
1 passed (3.4s)
```

Capture the `[awareness-latency]` log line — that's the **gate
evidence** that goes into the exit memo.

---

## 4. Failure triage

### "Only N/10 samples reached Bob — channel may be down"

Worker isn't routing awareness messages between rooms. Check:
- `wrangler tail occt-collab-worker --format pretty` while the spec
  runs — should see `ws:open → docId/...` lines + awareness binary frames
- Browser DevTools Network tab — both peers must show the
  `wss://collab.nexyfab.com/ws/<docId>` connection in green
- JWT secret mismatch → worker returns 401 on connect. Re-push:
  `grep JWT_SECRET ../../../.env | cut -d= -f2- | npx wrangler secret put JWT_SECRET --env production`

### "p95 exceeded ADR-012 §8 budget"

Awareness is propagating but slowly. Most common causes:
- Slow network between client + worker (test from same region as the
  worker's primary datacenter)
- Worker is cold-starting on each request — pre-warm by hitting
  `/healthz` × 3 before running the spec
- Awareness throttle is set too aggressive — check
  `collab/awarenessThrottle.ts` `THROTTLE_MS` constant (should be ≤
  100 ms; lower if the budget is critical)

### "awareness debug hook not exposed"

Build didn't include `NEXT_PUBLIC_NEXYFAB_COLLAB_DEBUG=1`. Rebuild.

---

## 5. Recording the result for the exit memo

After a successful run, append to `docs/wave-2-phase-3-exit.md` §7:

```markdown
### 1. Awareness latency p95 — ✅ Closed (YYYY-MM-DD)
Run: e2e/collab-awareness-latency.spec.ts
Build: NEXT_PUBLIC_NEXYFAB_CRDT=1, NEXT_PUBLIC_OCCT_COLLAB_WS_URL=wss://...
Result: samples=10 p50=Xms p95=Yms max=Zms (budget 200ms — PASS)
```

When all 4 hands-on items close, draft the flag-graduation PR per
`docs/wave-2-phase-3-exit.md` §6.

---

## 6. CI gating (future)

Once we have a dedicated test-account pair seeded in the staging
worker (avoiding the signup-rate-limit risk), this spec can move into
the nightly E2E lane:

- Add to `.github/workflows/integration-smoke.yml`
- Gate on a `secrets.NEXYFAB_COLLAB_LATENCY_ENABLED=1` repo variable
- Build the test bundle with the 3 env vars
- Run the spec against the staging deploy

Until that lands, this remains a manual gate.

---

## 7. Cross-references

- `e2e/collab-awareness-latency.spec.ts` — the spec
- `src/app/[lang]/shape-generator/collab/CollabProvider.tsx` — debug
  hook implementation
- `docs/wave-2-phase-3-exit.md` §7 — hands-on items
- `docs/wave-2-phase-3-w11-burnin.md` — Q1 burn-in evidence
  (complementary)
- `docs/adr/012-wave-2-phase-3-crdt-integration-and-direct-edit.md` §8
  — perf budget canonical source
- `occt-collab-worker/README.md` — worker architecture
- `.env.example` — `NEXT_PUBLIC_NEXYFAB_COLLAB_DEBUG` doc
