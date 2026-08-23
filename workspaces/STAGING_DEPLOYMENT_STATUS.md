# Scope staging deployment status

Recorded: 2026-08-23

## Outcome

The Railway `staging` environment now runs seven independently built and health-gated deployables from the `nexycad-commercial` runtime repository. Public Studio and proxied Core health checks return HTTP 200, and the end-to-end Preview smoke passed through member authentication, document creation, Exact CAD execution, STEP download, and SHA-256 verification.

This is a runtime-topology pass, not yet a direct deployment of the three NexyFab capability-wrapper commits. The NexyFab source remains organized by the `platform`, `precision-cad`, and `ai-design` workspaces, while the deployable runtime boundary remains the sibling commercial repository.

| NexyFab scope | Railway staging deployables | Staging result |
| --- | --- | --- |
| Platform | `source-ingestion`, `core-api`, `collaboration`, `studio-web` | PASS |
| Precision CAD | `exact-cad-kernel`, `job-control` | PASS after kernel identity alignment |
| AI Design | `analysis-worker` | Live probe PASS; model readiness intentionally HOLD |

## Evidence

- Machine-readable deployment evidence: `docs/evidence/platform-runtime/slice-deployment-staging.json`
- Aggregated readiness receipt: `docs/evidence/platform-runtime/slice-deployment-readiness.json`
- Runtime source: `nexycad-commercial@c6218eae1f9365f32b151abf26b78241a5afc6be`
- NexyFab source under evaluation: `359fb0579a9495a235daf2d5418648545af39b5e`
- Full runtime verification: 691 tests passed before staging deployment.

## Holds that must remain explicit

1. `registrationMode` is `OPEN`; closed-beta activation requires an approved bootstrap-owner and invitation policy.
2. Railway native rollback to an arbitrary previous deployment is dashboard-only. Seven previous deployment IDs and image digests are captured, but the staging rollback drill has not been executed.
3. The NexyFab capability-wrapper commit is not directly present in the commercial runtime images. A versioned handoff or direct package dependency must bind it before claiming slice-source deployment.
4. Analysis intentionally reports `MODEL_NOT_RUN`; live AI admission remains disabled.
5. A verify-only deployment check against the existing `nexyfab.com` staging service was blocked by missing/current-revision mechanical feature and interoperability receipts. The service remained on `candidate-20260822-006`; no bypass deploy was attempted.

The blocked direct deploy is not a Docker failure. `nexyfab/core-api:6b9feb55` was built locally with immutable digest `sha256:f00a9b07d95f5844ee1c71725244c5600f927e48efe9658f1a8a6fdf5dd78a77`; its live health returned the complete `6b9feb555e12fcfd69d8cd35d5113aba71f71a7b` build ID and `/platform-status/` returned HTTP 200.

Do not enable automatic promotion or any production `deployEnabled` flag while these holds remain.
