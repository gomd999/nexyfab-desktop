# NexyFab CAD Job Orchestrator

This Cloudflare unit separates transport, orchestration, execution and release evidence:

1. authenticated HTTP ingress validates the shared CAD job contract;
2. a per-job Durable Object prevents conflicting reuse and concurrent duplicate enqueue;
3. Cloudflare Queue persists delivery and sends exhausted retries to a DLQ;
4. idempotent Workflow creation coordinates authorization, compute and receipt commit;
5. Core API remains authoritative for tenants, projects, artifacts and accepted receipts.

Queue and Workflow state can never produce an execution or release `PASS`. The Worker returns `execution: NOT_RUN` for transport receipts. A compute receipt becomes authoritative only after Core API revalidates project scope, immutable input/output artifacts, trusted worker and kernel identities, authorization token and receipt SHA-256. Release verification remains `NOT_RUN` after compute acceptance.

Deployment remains disabled until staging bindings, secrets, queues, DLQ, Workflow, Durable Object migration and all compute origins are provisioned and exercised.
