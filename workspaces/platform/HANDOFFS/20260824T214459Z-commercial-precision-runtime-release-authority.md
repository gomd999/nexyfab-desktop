# Platform handoff: commercial Precision runtime release authority

- Created: `2026-08-24T21:44:59Z`
- Branch: `scope/platform`
- Base head: `d9c514590bdf05e432fa8f4f4e94b6a77a1fcafc`
- Shared path-classification prerequisite: `2d28b695`
- Integration target: `integration/nexyfab`
- State: `LOCAL_GATE_CURRENT / 30x7_LOCAL_CANDIDATE / COMMERCIAL_RUNTIME_HOLD`

## Summary

The former commercialization gate did not require deployed Precision runtime
evidence, and live `/api/health/release` treated production plus
`NEXYFAB_COMMERCIAL_MODE=1` as a runtime PASS. That allowed source tests and an
operator flag to stand in for proof of the durable AI-to-Precision execution
boundary.

This unit adds a derived, immutable, HMAC-attested commercial Precision runtime
receipt. Private Beta requires all PostgreSQL/Redis/object-storage/outbox/lease,
native execution, exactly-three-output, signed receipt/callback,
authoritative-persistence, workspace-CAS, and negative attack checks. GA adds
multi-instance exclusion, expired-lease and crash recovery,
`VERIFIED_UNKNOWN` no-replay behavior, credential rotation, production-only
observation, and same-deployment binding. Supporting database, object-storage,
worker, negative-campaign, and recovery documents are byte/hash bound under a
contained, non-symlink evidence root.

The offline commercialization gate now requires the Private Beta decision for
mechanical Private Beta and the GA decision for commercial GA. The live release
endpoint independently requires a fresh signed GA receipt bound to its exact
build, Git head, Railway deployment, migration `2026082502` checksum, execution
contract v3, five evidence roles, and all 20 checks. Missing, tampered, stale,
or release-transplanted receipts cannot promote the endpoint.

The mechanical local runtime campaign was also rerun. All 30 required features
passed all seven local axes (210/210) and the local readiness receipt is
`LOCAL_CANDIDATE`. Its claim boundary remains local: it is not a substitute for
independent STEP interoperability, expert review, or manufacturing pilots.

## Changed paths

- `scripts/build-commercial-precision-runtime-evidence.mjs`
- `scripts/build-commercial-precision-runtime-evidence.test.mjs`
- `scripts/commercialization-readiness-gate.mjs`
- `scripts/commercialization-readiness-gate.test.mjs`
- `src/lib/releaseHealthEvidence.ts`
- `src/app/api/health/release/route.ts`
- `src/app/api/health/release/route.test.ts`
- `docs/evidence/release/commercial-precision-runtime-evidence.json`
- `docs/evidence/cad-independent/local/mechanical-core-feature-axis-evidence.json`
- `docs/evidence/cad-independent/local/mechanical-core-runtime-260813/**`
- `docs/evidence/cad-independent/mechanical-core-feature-local-readiness-260813.json`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260824T214459Z-commercial-precision-runtime-release-authority.md`

## Verification

- [x] Commercial runtime builder and commercialization gate: `40/40` PASS.
- [x] Release-health focused Vitest: `10/10` PASS.
- [x] TypeScript: PASS.
- [x] Local mechanical runtime generation and refresh: 30/30 features,
  210/210 axes PASS.
- [x] Local mechanical readiness gate: `LOCAL_CANDIDATE`, zero local blockers.
- [x] Platform workspace ownership, full source ESLint, and TypeScript: PASS.
- [ ] Final integrated regression run is the next integration step.

## Remaining work and risks

- The committed commercial Precision runtime receipt is deliberately `HOLD`
  because no external observation root or evidence-signing secret was supplied.
- Provision isolated native workers, Ed25519 worker keys, callback/lease
  secrets, Redis, and private object storage on the exact staging build; run the
  Private Beta canary and negative campaign; then issue the bound receipt.
- Before GA, repeat on the exact production deployment with multi-instance,
  expiry, crash, `VERIFIED_UNKNOWN`, and credential-rotation campaigns.
- External provider credential rotation, three distinct external verifier
  identities, independent CAD interoperability/expert review, 20 blind
  challenges, and three manufacturing pilots remain release blockers and must
  not be inferred from source or local evidence.
