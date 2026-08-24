# NexyFab FEA worker

Isolated asynchronous precision-FEA service. The web service submits bounded,
owner-scoped Redis jobs and only polls their state; numerical assembly and solve
run in a memory-limited child process here.

## Railway service

- Recommended service name: `nexyfab-fea-worker`
- Dockerfile: `services/fea-worker/Dockerfile` (repository-root build context)
- Start command: image default `node server.mjs`
- Liveness: `GET /api/health/live` (process only; does not restart-loop on Redis outages)
- Readiness: `GET /api/health/ready` or `GET /healthz` (requires Redis and an immutable build ID)
- Metrics: `GET /metrics` (keep the service private to the Railway project)
- Required variable: `REDIS_URL`
- Required shared CAD-runtime boundary: `CAD_RUNTIME_EXTERNAL_WORKER=1`
- Recommended precision budget: `NEXYFAB_FEA_PRECISE_BUDGET_MS=60000`

The image defaults to one concurrent solve. Raise `FEA_WORKER_CONCURRENCY` only
after memory p95 proves that two `--max-old-space-size=1024` solver children plus
the worker process fit the Railway service limit.

## Seven-day observations

Collect `queued`, `processing`, `active`, `completed`, `failed`, `cancelled`,
`retried`, `recovered`, `timedOut`, `memoryKilled`, and `uptimeMs` from `/metrics`,
along with Railway CPU/memory and service cost. Alert on a growing queue, any
`memoryKilled`, repeated lease recovery, or precision failure-rate regression.

Jobs retain a 24-hour Redis result, accept at most three pending jobs per owner,
retry transient failures at most three attempts, and recover an expired processing
lease after a worker crash. A result can never claim expert approval or direct
manufacturing readiness; those fields remain `null` and `false` respectively.
