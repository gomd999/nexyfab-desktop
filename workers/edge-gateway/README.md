# NexyFab Edge Gateway

This Worker is the fixed public ingress for the modular platform. It owns request identity, host validation and deterministic routing only. Authentication, project authorization, billing and CAD business rules remain authoritative in Core API.

Deployment is intentionally disabled until a staging environment provides `CORE_API_ORIGIN`, `STUDIO_ORIGIN`, `EDGE_HANDLER_ORIGIN`, `ALLOWED_HOSTS`, `BUILD_ID`, and the `GATEWAY_SHARED_SECRET` secret. The committed Wrangler file contains no production origin or secret.

The runtime fails closed when any required origin is invalid, the host allowlist
is empty, `GATEWAY_SHARED_SECRET` is shorter than 32 characters, or the build ID
is missing/placeholder. Gateway health returns 503 and lists only configuration
field names; it never returns secret values.

Route behavior:

- pages and assets -> Studio Web
- ordinary `/api/*` -> Core API
- `/api/docs`, `/api/og`, `/api/webhooks` -> Edge Handler origin
- gateway health -> handled locally

The gateway removes client-supplied forwarding and gateway headers, rejects recursive origins, and fails closed when a route owner has no origin binding.
