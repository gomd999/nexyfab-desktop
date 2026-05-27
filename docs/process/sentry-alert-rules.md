# Sentry Alert Rules

**Status:** runbook · **Drafted:** 2026-05-26 (Wave 0 Day 5)

Code-side instrumentation now forwards key events to Sentry. These rules
must be created in the Sentry web UI (Sentry's API can also do it, but
the UI is faster for a one-time setup). Replace `nexyfab` with the actual
project slug.

## Where each event comes from

| Event | Sentry tags / fingerprint | Emitted by |
|---|---|---|
| Engine fallback (OCCT → mesh-CSG) | `telemetrySource: csg`, level `warning` | `boolean.ts:298` (reportWarning), forwarded by `telemetry.ts:report` |
| Other shape-generator errors | `telemetrySource: <source>`, level `error`/`warning` | All `reportError`/`reportWarning` calls |
| Server Action ID mismatch | fingerprint `stale-client-server-action`, tag `staleClient` | `instrumentation-client.ts` stale-client handler |
| Generic ErrorBoundary | tag `source: ErrorBoundary` | `src/components/nexyfab/ErrorBoundary.tsx` |
| API errors / latency | Sentry's auto-instrumentation | All `/api/*` routes |

## Alert rules to create

### 1. Engine fallback rate > 1%

Catches: OCCT B-rep engine starts failing in prod and silently falling
back to mesh-CSG, which produces wrong geometry on some inputs.

```
When: An event is captured
If:   event.tags.telemetrySource equals "csg"
And:  event.level equals "warning"
And:  event count in 60 minutes >= 50           (~1% of typical traffic)
Then: Send notification to #ops-alerts Slack
      Cooldown: 4 hours
```

### 2. Server Action ID mismatch > 10/h

Catches: Encryption key rotated mid-deploy, or rolling-deploy window
serving mixed builds. Should be near-zero after Wave 0 Day 4 fix.

```
When: An event is captured
If:   event.fingerprint equals "stale-client-server-action"
And:  event count in 60 minutes >= 10
Then: Send notification to #ops-alerts Slack
      Cooldown: 1 hour
```

### 3. p99 API latency > 2s

Catches: a route slowing down (DB query regression, OCCT worker
saturation, etc.).

```
When: A performance issue is detected
If:   transaction.op equals "http.server"
And:  p99 duration > 2000ms in 15 minutes
Then: Send notification to #ops-alerts Slack
      Cooldown: 30 minutes
```

### 4. ErrorBoundary trip > 5/h

Catches: a React subtree crashing repeatedly — usually a regression in a
specific feature panel.

```
When: An event is captured
If:   event.tags.source equals "ErrorBoundary"
And:  event count in 60 minutes >= 5
Then: Send notification to #ops-alerts Slack
      Cooldown: 1 hour
```

### 5. Sentry budget — error rate spike

Catches: total error rate jumps 1.5× over baseline (catches anything we
didn't pre-instrument).

```
When: A new high-priority issue is created
If:   issue.is_new equals true
And:  issue.level in ["error", "fatal"]
And:  issue.users_affected >= 5 in 30 minutes
Then: Send notification to #ops-alerts Slack
      Cooldown: 30 minutes
```

## Setup checklist for the user

- [ ] Create Slack channel `#ops-alerts` (or reuse existing).
- [ ] In Sentry → Settings → Integrations → Slack, install Slack app
      and authorize `#ops-alerts`.
- [ ] In Sentry → Alerts → Create Alert, add each of the 5 rules above.
- [ ] Test rule #2 by clearing `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` on
      staging and deploying — Sentry should fire within ~5 min when an
      old tab submits a form.

## When to revisit

- After Wave 1 deploys: tune thresholds based on real traffic baseline.
- After each P0 incident: add a rule for the failure mode if it isn't
  already covered.
