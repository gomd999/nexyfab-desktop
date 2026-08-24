# Backend + Frontend Platform handoff: platform audit hardening

- Created: 2026-08-23T18:36:29.399Z
- Branch: `scope/platform`
- Head: `4b38f98c47dff86dd9cc866e4f4f981d5a1389e2`
- Integration target: `integration/nexyfab`
- Release state: `BLOCKED`

## Summary

Completed a repository-wide audit and implemented the remediations owned by the
platform scope. Public quick-quote uploads and three development scripts holding
an exposed OpenAI-pattern credential were removed from the working tree. Edge,
collaboration, FEA, and job-orchestration boundaries now fail closed or preserve
durable delivery state. Security evidence, operational documentation, and a
single platform quality runner were added or refreshed.

## Changed paths

- `.dockerignore`
- `README.md`
- `ask_deepseek.py` (removed)
- `ask_deepseek2.py` (removed)
- `ask_deepseek_3d_review.py` (removed)
- `public/uploads/quick-quote/*.stp` (15 duplicate tracked uploads removed; 15,429,420 bytes)
- `collab-worker/README.md`
- `collab-worker/cloudflare/index.ts`
- `collab-worker/server.js`
- `collab-worker/server.test.js`
- `services/fea-worker/README.md`
- `services/fea-worker/server.ts`
- `services/fea-worker/server.test.ts`
- `services/fea-worker/vitest.config.mts`
- `workers/edge-gateway/README.md`
- `workers/edge-gateway/src/index.ts`
- `workers/edge-gateway/src/index.test.ts`
- `workers/job-orchestrator/src/core.ts`
- `workers/job-orchestrator/src/core.test.ts`
- `scripts/scan-secrets.mjs`
- `workspaces/platform/run-quality.mjs`
- `docs/evidence/security/dependency-audit-260810.json`
- `docs/evidence/security/route-security-matrix-260810.json`
- `docs/evidence/security/route-security-matrix-260810.md`
- `docs/evidence/security/secret-scan-260810.json`
- `docs/evidence/security/supply-chain-manifest-260810.json`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/DECISIONS.md`
- `workspaces/platform/HANDOFFS/20260823T183629Z-platform-audit-hardening.md`

## Key behavior changes

- Docker contexts exclude `public/uploads/`, and the build output no longer has
  `.next/standalone/public/uploads`. The one remaining standalone STEP file is
  the deliberate `public/examples/acu_part-1_main_body.stp` sample.
- The edge gateway requires valid origins, an exact host allowlist, a 32+ byte
  shared secret, and a non-placeholder immutable build ID. Production origins
  require HTTPS; health fails closed and does not expose secret values.
- The Node and Cloudflare collaboration relays enforce production HS256 tokens,
  expiry, subject, optional document binding, exact HTTPS origins, safe document
  IDs, bounded payloads, and per-room connection limits. Development remains
  anonymous unless strict auth is explicitly requested.
- FEA liveness no longer depends on Redis. Readiness requires Redis and a build
  identity, numeric runtime settings are bounded, and metrics fail closed when
  the dependency is unavailable.
- A queue write is never rolled back after it becomes durable; ledger
  confirmation is retried and partial confirmation is reported without causing
  duplicate client enqueue.
- Secret scanning covers tracked files and non-ignored commit candidates,
  includes common environment/config files, excludes its self-referential output,
  and fails if a text candidate is too large to inspect.

## Verification

- [x] `npm run workspace:check -- platform` (ownership, lint, and typecheck pass)
- [x] `npm run build` (Next.js 16.3.0 production build and bundle budget pass)
- [x] Platform quality suites: 53 tests passed across Core API, edge/job workers,
  collaboration, OpenSCAD, and FEA
- [x] Platform architecture validation: PASS
- [x] Route security matrix: 607 route files, 837 handlers, zero gaps
- [x] Dependency audit: zero known vulnerabilities
- [x] CycloneDX supply-chain evidence: 1,005 components, zero vulnerabilities
- [x] Versioned-candidate secret scan: zero working-tree findings and zero skipped files
- [x] `public/uploads` absent from source and standalone build output
- [x] `git diff --check`

## Integration-owned follow-up

1. Treat the removed credential as compromised: rotate/revoke it immediately,
   inspect provider usage/audit logs, and coordinate a backup-aware history
   rewrite. The three paths appear across 13 reachable commits; the secret value
   must never be printed into logs or review comments.
2. Purge the removed upload objects from Git history and any build/CDN caches,
   verify whether they contain customer data, and record the retention incident.
   `public/uploads/quick-quote` appears across 12 reachable commits.
3. Harden `.github/workflows/release-desktop.yml`: validate the version as SemVer,
   pass metadata through environment/files instead of interpolating expressions
   into shell/heredoc bodies, and pin all actions to reviewed commit SHAs. Remove
   the floating `trufflesecurity/trufflehog@main` reference repository-wide.
4. Expand CI path filters to include `workers/**`, `services/**`,
   `collab-worker/**`, and `cron-worker/**`; run the platform quality entrypoint
   and restore a bounded/sharded full Vitest lane.
5. Add a shared package script/registry check for
   `node workspaces/platform/run-quality.mjs`. Add `ws` as a direct collaboration
   dependency and align exact Node/npm, Next, ESLint config, and Node type versions.
6. Extract the FEA worker's Precision CAD UI import into a versioned shared
   contract/package. Split the 12,700-line, 500KB+ Precision CAD component in its
   owning scope.
7. Move the large generated evidence corpus to a hashed external artifact store
   with small committed manifests, then retire tracked ignored legacy artifacts
   under an integration-controlled baseline update.

## External/runtime blockers

- `npm run platform:runtime:gate` remains `HOLD/NOT_RUN` because live observation
  evidence is absent.
- Slice readiness remains `BLOCKED`: the current platform source fingerprint does
  not match the recorded local runtime image.
- Rollback evidence is `INVALID` because the staging digest mismatches, and the
  native staging rollback has not been executed.
- Bind a staging legacy origin, production Redis, immutable image/build IDs, and
  all worker secrets/origin allowlists; rebuild the current platform image.
- Complete authenticated staging parity, Postgres/R2 restore, queue DLQ recovery,
  collaboration snapshot recovery, and independent rollback drills.
- The main app token issuer must enforce project/document access before issuing
  collaboration tokens, and collaboration persistence/snapshot recovery remains
  unfinished.

Release promotion must remain disabled until these external and integration-owned
items produce passing evidence.
