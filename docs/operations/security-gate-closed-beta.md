# Closed Beta security gate

The Next.js 16 request gate in `src/proxy.ts` protects the application without
changing existing accounts, password hashes, database rows, or customer files.

## Modes

Set `SECURITY_GATE_MODE` at runtime:

- `shadow` (default): evaluate policies and emit sampled `would_block` logs,
  but preserve the existing response path.
- `enforce`: return the policy response (404, 405, 413, or 429).
- `off`: bypass only the new compatibility gate. Existing admin elevation and
  expert-studio routing remain unchanged.

Unknown and empty values fail safe to `shadow`, not `enforce`.

## Observed policies

- legacy upload path: `/uploads/*`
- unsafe methods: `TRACE`, `CONNECT`
- request size from a valid `Content-Length` header
- per-instance IP and route-bucket rate limits

The shadow logger never records query strings, cookies, authorization headers,
request bodies, file names below the pathname, or customer identifiers. The
same method/path/reason is sampled at most once every five minutes per process.

## Closed Beta rollout

1. Deploy with `SECURITY_GATE_MODE=shadow`.
2. Observe at least one representative beta usage cycle.
3. Inventory every `/uploads/*` reference before enabling path enforcement.
4. Confirm no normal request would be blocked by method, size, or rate policy.
5. Enable `enforce` only in a canary environment/account cohort.
6. Return to `shadow` immediately if login, project open, download, sharing,
   RFQ, quote, or partner workflows regress.

Do not use `enforce` as a substitute for route-level authentication,
authorization, CSRF protection, webhook verification, or private storage.

## Rollback

Changing `SECURITY_GATE_MODE=enforce` to `shadow` restores compatibility without
a database migration or file change. `off` is an emergency bypass for the new
gate only. Neither mode changes existing persistent data.

## Legacy PHP exception

`/send-mail.php` and `/search.php` always return 404 in every mode. Next.js does
not execute these files as PHP, so serving them could disclose source code and
embedded credentials. The source files remain untouched for compatibility and
forensic review, but must never be published as static assets.

The historical reCAPTCHA secret embedded in `public/send-mail.php` must be
rotated in the reCAPTCHA administration console. Repository changes cannot
invalidate an already disclosed external credential. After rotation, keep the
replacement only in `RECAPTCHA_SECRET_KEY`; do not place it in `public/`.

## New private files

New uploads through `/api/nexyfab/files` use keys beginning with `private/`.
Local development stores them below ignored `data/private-storage/`; S3/R2
stores them without returning a public object URL. Downloads continue through
the authenticated file endpoints. Existing non-private keys are still read
from their original locations and are not moved, renamed, or deleted.

Do not configure the `private/` object prefix as publicly readable at the
bucket/CDN layer. Object access should be available only to the application
credential, which issues five-minute signed URLs after authorization.

Large STEP uploads use a five-minute signed PUT under `private/files/{userId}`.
The completion endpoint verifies the authenticated prefix and authoritative
object size before creating an `nf_files` row; size-mismatch objects are
deleted. Configure an object-store lifecycle rule to remove uncommitted
`private/files/` multipart/direct-upload objects after 24 hours. The lifecycle
must not target objects referenced by `nf_files` and must not move or rewrite
legacy Closed Beta keys.

## Required production controls

The release preflight now requires `REDIS_URL`, both reCAPTCHA keys,
`RECAPTCHA_ALLOWED_HOSTNAMES`, a separate `SCAD_AGENT_SESSION_SECRET`, and an
explicit `SECURITY_GATE_MODE`. Configure
the log platform to parse lines prefixed with `[security-event]`; the remainder
is JSON and contains no query strings, credentials, request bodies, or full
customer file paths.
