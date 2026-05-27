# Wave 1 — Sentry alert configuration

ADR-009 gate #5 (7-day burn-in) requires Sentry rules wired to the
telemetry events emitted from `src/lib/occt-server-client.ts` and
`src/app/[lang]/shape-generator/features/`. Copy the snippets below
into the Sentry project's "Alert Rules" page.

## Events emitted

| Event | Source | Meaning |
|---|---|---|
| `csg.server_boolean_ok` | `serverDispatch` | Round-trip succeeded; meta has triangles/manifold |
| `csg.server_{op}_unavailable` | `serverDispatch` catch | 4xx/5xx/network — server path skipped |
| `csg.server_{op}_path_ok` | `tryServerBoolean` / `tryServerOp` | Server result parsed back into geometry |
| `csg.server_{op}_fallback` | `tryServerOp` | Server failed but local fallback ran successfully |
| `csg.server_{op}_network` | `serverDispatch` finally | Network error wrapped as ServerOcctUnavailableError |

`{op}` ∈ `{boolean, fillet, chamfer, shell, mirror, pattern, extrude, revolve, sweep, loft}`.

## Alerts

### A1 — Server unavailable rate (P1)

```
Trigger: event count of csg.server_*_unavailable
  > 5% of (csg.server_*_unavailable + csg.server_*_ok)
  over any 15-minute window
Action: page on-call (Slack #ops-alerts)
Reason: Worker degraded — most users falling back to local. Investigate
        Railway health, R2 connectivity, kernel crashes.
```

### A2 — Pool recycle rate climbing (P1)

Sampled from `/health`'s `pool.recycles` counter via a Grafana exporter
(or polled directly):

```
Trigger: derivative(pool.recycles) > 10 per hour
Action: page on-call
Reason: Kernel instability — slots are crashing faster than the
        op-count policy would dictate (default 50 ops/recycle).
        Check Sentry for replicad WASM errors.
```

### A3 — Server op timeout rate (P1)

```
Trigger: event count where csg.server_*_unavailable AND tag status=504
  > 1% over any 1-hour window
Action: page on-call
Reason: OCCT WASM is getting stuck — bad input or pathological topology.
        Look at the requestId trail in Sentry breadcrumbs.
```

### A4 — Heap growth ratio (P2)

Polled from `/health` `pool.memory.aggregateHeapUsedMb` via Grafana
hourly samples; computed Q4/Q1 ratio on a 4-hour window:

```
Trigger: ratio(window-Q4-mean / window-Q1-mean) > 2.0
Action: Slack #ops-alerts (no page; investigate next business day)
Reason: Recycling policy isn't bounding heap. Tune
        OCCT_MAX_OPS_PER_SLOT lower.
```

### A5 — Bad params spike (P2)

```
Trigger: event count of csg.server_*_unavailable AND tag status=400
  > 50 per hour
Action: Slack #ops-alerts
Reason: Client is sending malformed params at unusual rate — likely
        a UI regression that's serialising garbage.
```

### A6 — Worker token mint failures (P2)

```
Trigger: HTTP 500 rate on /api/nexyfab/worker-token > 1% over 1 hour
Action: Slack #ops-alerts
Reason: signJWT failing (JWT_SECRET misconfigured?) or DB lookup in
        getAuthUser failing. Without worker tokens, every server
        path skips back to local — silent degradation.
```

## Dashboard panels

Pin to the NexyFab Wave 1 dashboard:

1. **Server vs local share** — stacked area of `server_*_path_ok`
   count vs total boolean/fillet/chamfer/shell apply events.
   Healthy: > 80% server for large hosts.
2. **Pool capacity** — `pool.ready` / `pool.size` from /health.
   Healthy: 100% during business hours, may dip to ~50% during
   recycle bursts.
3. **Heap aggregate** — `pool.memory.aggregateHeapUsedMb`.
   Healthy: stable line ±20%; rising stairstep = recycling bug.
4. **Op latency p50/p99** — `serverElapsedMs` from `*_ok` events.
   Healthy: p50 < 500ms, p99 < 3s for hosts under 100×100×100.

## Telemetry → Sentry mapping

The shape-generator telemetry helpers (`reportInfo`, `reportWarning`,
`reportError` in `src/app/[lang]/shape-generator/lib/telemetry.ts`)
already pipe to Sentry's `captureMessage` / `captureException` —
no extra wiring needed. Alert rules above match the message strings
verbatim.
