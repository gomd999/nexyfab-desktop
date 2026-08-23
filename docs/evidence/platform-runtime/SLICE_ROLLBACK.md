# Slice staging rollback drill

This procedure records a reversible staging drill. It does not authorize a
production rollback and it never treats captured targets as executed evidence.

1. Confirm the staging evidence and immutable targets are still valid with
   `npm run platform:slices:rollback:check`.
2. Print a fresh non-secret template with
   `npm run platform:slices:rollback:template`. Compare all seven current and
   rollback deployment IDs and image digests with the Railway dashboard.
3. Freeze staging writes and run the dashboard rollback in a coordinated
   window. After every service transition, verify its health endpoint and stop
   the drill on the first HOLD or identity mismatch.
4. For every service, record the observed rollback deployment ID, image digest,
   health result, and timestamp in `slice-rollback-execution.json`.
5. Restore the captured current deployment set. Record the restored deployment
   ID, image digest, health result, and timestamp for all seven services.
6. Set the top-level and per-target `execution` fields to `PASS`, then run
   `npm run platform:slices:rollback:require-pass` and
   `npm run platform:slices:readiness -- --require-pass`.

The validator requires both the previous target observation and the restored
current observation for every service. A partial rollback, missing restore,
changed digest, stale receipt, or failed health probe remains fail-closed. Do
not place tokens, cookies, environment values, or dashboard URLs containing
credentials in the receipt.
