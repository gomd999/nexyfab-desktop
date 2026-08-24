# AI Design V4-V8 implementation handoff

- Producer scope: `scope/ai-design`
- Date: 2026-08-24 KST
- Status: `AI_SCOPE_IMPLEMENTATION_COMPLETE_EXTERNAL_EVIDENCE_HOLD`
- Implementation boundary: only `worktrees/ai-design`
- Precision CAD and integration changes: MD dependencies only; their implementation files were not modified

## Outcome

The planned V4 through V8 AI Design producer work is implemented and connected in sequence. The implementation remains concept-design authority only. It does not claim exact CAD, manufacturability, standards compliance, physical validation, or commercial release readiness.

The public complex-workspace API now returns both the V4 authoritative read model and the renderer-neutral V8 UX contract. The three complex-product scenarios pass through the real V4 command path. Commercial rollout remains `HOLD` until durable infrastructure and independent evidence are supplied by their owners.

## V4 - server-authoritative complex workflow

- Added bounded `WorkspaceCommandV3` client commands:
  - `ATTACH_PRODUCT_STRUCTURE`
  - `ATTACH_CROSS_DOMAIN_GRAPH`
  - `RESOLVE_INTENT_CONFLICT`
  - `RUN_COMPLEX_CRITICS`
  - `REQUEST_PRECISION_VERIFICATION`
- Kept `RECORD_PRECISION_RECEIPT` as a separate server-only command; the browser route rejects it.
- Added complex CAS aggregate/store, replay detection, immutable sidecars, partition artifacts, gauge/constraint binding artifacts, signed critic bundles, Precision requests, and signed receipt validation.
- Product structure attachment generates complete bounded partitions by default, or validates supplied definitions. Gauge and cross-domain bindings are scope-checked and stored immutably.
- Precision scope now validates structure nodes, interfaces, stored partitions, and runtime gauges before issuing a request.
- Conflict resolution clears stale critic evidence; rerunning critics creates traceable fresh evidence.
- Stale revisions, forged signatures, expired receipts, content/revision/scope mismatches, and replay conflicts fail closed.
- Added authenticated, origin/rate-limit/project-access guarded routes:
  - `/api/nexyfab/ai-design/workspace-session/complex-actions`
  - `/api/nexyfab/ai-design/workspace-session/complex-workspace`
- `machine-assembly`, `mold-tooling`, and `electromechanical-enclosure` now pass structure/constraint attach, complex critic, Precision request, and read-model projection through V4 commands while exact/manufacturing remain `NOT_RUN`/`false`.

## V5 - rights-safe engineering knowledge

- Added append-only `KnowledgeSourceRegistryV1` with owned/licensed/public-domain/permissioned/unknown/restricted policy, allowed-use scope, tenant/project binding, expiry, and approval checks.
- Unknown, restricted, expired, unapproved, cross-tenant, and disallowed-use sources fail closed.
- Added independently authored `ConceptCardV1` with edition/version, principles, assumptions, applicability/forbidden conditions, jurisdictions, bounded formula metadata, units, source hashes, review date, and independent-authorship attestation.
- Raw source text, tables/screenshots, images, geometry, and model-facing raw content are excluded.
- Added non-executable `EngineeringRuleDslV1`. Activation requires an approved Concept Card, bounded declarative clauses/units, human approval, schema validation, and passing deterministic golden cases.
- Added immutable `KnowledgeRetrievalReceiptV1`; it records rights decisions and card/source digests without source content.

## V6 - bounded MADR

- Added Architect, Constraint, Assembly, Safety, and Cost roles using one typed proposal/critique contract.
- Enforced finite round, call, cost, duration, concurrency, retry, and per-turn timeout budgets.
- Recorded input/output digests, model-selection receipt digests, rationale, risks, requested inputs, and termination reasons.
- Consensus is concept evidence only. Missing input becomes `NEEDS_INPUT`; provider failure, timeout, cancellation, cost/call/time limits, and maximum rounds terminate explicitly.
- Added durable-worker/UI recovery projection for every termination state.
- Added external holdout comparison gate. MADR remains disabled by default until caller-defined minimum cases show externally reviewed quality improvement without leak-risk growth.
- The in-memory session store fails closed for commercial deployment.

## V7 - rights-cleared topology retrieval

- Added content-addressed, tenant/project-scoped topology asset catalog and explicit use grants tied to V5 rights records.
- Indexed generalized counts, feature kinds/relations, interface patterns, domain tags, aspect ratios, symmetry, unit system, and coordinate-frame metadata.
- Raw geometry, vertices, B-rep, and direct model access are always excluded from retrieval results.
- Added grant expiry, tombstones, deterministic index digest/regeneration, tenant isolation, and commercial persistence fail-closed behavior.
- Added weighted similarity plus `ALLOW` / `HUMAN_REVIEW` / `BLOCK` near-copy policy.
- Added candidate lineage binding connecting retrieval receipt, selected asset/grant/source digests, candidate artifact digest, and `ProductStructureGraph` digest.
- Added external holdout gate; retrieval remains disabled by default until independently reviewed quality improves without leak-risk increase.

## V8 - complex UX, scale, localization, and evidence

- Added V8 UX consumption contract with:
  - 5,000-node assembly-tree virtualization capped at 200 visible rows;
  - 256-partition progressive windows capped at 32;
  - stable selection/gauge draft keys and visible heatmap partial updates;
  - mobile modal bottom sheet, 44 px targets, decimal numeric editing, sticky actions, and reconnect/stale/conflict/interruption recovery;
  - AI-view undo/redo capability with Precision commits/receipts explicitly non-undoable;
  - keyboard tree navigation, screen-reader labels/live regions, non-color status text, reduced motion, 200% zoom/reflow, Arabic RTL;
  - Korean, English, Japanese, Chinese, Spanish, and Arabic engineering terminology and trust labels.
- The complex-workspace route accepts validated locale, connection, tree window, and partition window parameters and returns `{ model, ux }` with `private, no-store`.
- Added a copyright-safe synthetic maximum-scale campaign covering:
  - 5,000 product-structure nodes;
  - 10,000 product-structure edges;
  - 2,000 cross-domain nodes;
  - 5,000 cross-domain edges;
  - 256 complete partitions.
- Added append-only release-evidence ledger for mechanical, architecture, interior, civil, and landscape. Per-domain targets are 20 independent cases, 3 deterministic campaigns, 2 expert reviews, and 3 physical pilots (140 accepted entries total).
- Failed or unverified entries do not count. Meeting all targets only yields `ELIGIBLE_FOR_HUMAN_RELEASE_REVIEW`; it never grants exact/manufacturing authority.

## Copyright and unauthorized-copy boundary

- The implementation uses independently written concepts, metadata, declarative rules, and synthetic fixtures only.
- It does not copy manual prose, screenshots, tables, proprietary geometry, source models, or generated executable TypeScript from reference material.
- Licensed/permissioned use requires a rights reference hash and explicit allowed use. Unknown/restricted rights fail closed.
- Topology retrieval returns generalized patterns and provenance digests, not source geometry.
- Near-copy output is blocked or sent to human review before use.

## Verification evidence

- Focused V4-V8 regression: 10 files / 33 tests passed.
- Full AI Design/API regression: 48 files / 167 tests passed.
- TypeScript: `npm run typecheck` passed.
- Common accuracy: 11 files / 62 tests passed; candidate-manifest Node suite 7/7 passed.
- Production build: `npm run build` passed; 298 static pages generated and bundle budget passed.
- After the final scope-derived partition storage-key hardening, the 4 directly affected files / 10 tests and TypeScript typecheck passed again.
- Maximum synthetic scale campaign passed; the focused run measured about 1.5 seconds on this workstation. This is a measurement, not a release SLO.
- `git diff --check` passed; only line-ending warnings were emitted.
- `npm run workspace:check -- ai-design` was executed. Branch, shared paths, and new-path classification were correct, but preflight remained blocked by three pre-existing `platform`-owned deletions:
  - `adminlink/index.php`
  - `public/search.php`
  - `public/send-mail.php`
  This implementation did not create, modify, revert, stage, or otherwise alter those deletions. Because preflight stopped, its nested type/common checks were `NOT_RUN`; both were run separately and passed as recorded above.
- Build warning: `REDIS_URL` is unset, so build-time route collection reports in-memory rate limiting. This is an integration deployment dependency, not an AI Design correctness claim.

## Precision CAD consumer contract - MD dependency

Precision CAD should consume the V4 read model and V8 UX contract, then implement and evidence the following without changing AI authority:

1. Bind actual React/Three.js assembly selection, tree expansion, gauges, gizmos, numeric entry, bottom sheets, focus management, zoom/reflow, and partial heat updates to stable IDs from the producer.
2. Resolve partition, structure-node, interface, and gauge scopes to authoritative B-rep/FeatureTree entities.
3. Execute rollback-safe exact operations and keep AI-view undo separate from exact CAD history.
4. Produce a scoped, revision/content-bound, expiring `nexyfab.ai-design-precision-verification-receipt.v1` for the corresponding request. `manufacturingReleaseReady` must remain `false`.
5. Run browser/component and round-trip E2E for `machine-assembly`, `mold-tooling`, and `electromechanical-enclosure`, including stale revision, interruption, reconnect, forged/expired receipt, and failed exact scope.
6. Return actual interference, tolerance, STEP, FEA/CAM, and manufacturing evidence only through separately authoritative contracts. AI Design must not infer these statuses.

## Integration consumer contract - MD dependency

Integration should supply:

1. Transactional PostgreSQL CAS implementations for runtime/complex aggregates, immutable artifacts, knowledge records, MADR sessions, topology catalog, release evidence, durable jobs, and ordered outbox.
2. Object storage with rights-aware retention/tombstones and no raw restricted content in model prompts or retrieval receipts.
3. Durable model-provider workers for MADR, cancellation/timeout propagation, retry/dead-letter handling, and telemetry.
4. Redis-backed distributed rate limits, secret rotation, and production receipt key management.
5. Independent holdout data and reviewers for MADR/topology gates, plus all 140 verified release-evidence targets. Synthetic unit tests do not satisfy this gate.
6. Baseline latency/cost/UX measurements before establishing an operational SLO; no arbitrary performance target is asserted here.

## Remaining gates

- `AI Design code/contracts`: complete for the scoped V4-V8 plan.
- `Commercial durable deployment`: `HOLD` pending integration implementations.
- `Actual screen/component binding`: `HOLD` pending Precision CAD consumer work.
- `Independent holdout/expert/physical evidence`: `HOLD`; no fabricated evidence was added.
- `Exact CAD verification`: `NOT_RUN` unless a valid Precision receipt is supplied per request.
- `Manufacturing release`: always `false` in this scope.

## Key producer files

- `src/lib/ai/aiDesignWorkspaceCommandV3.ts`
- `src/lib/ai/aiDesignComplexWorkspaceService.ts`
- `src/lib/ai/aiDesignComplexProjectionBindings.ts`
- `src/lib/ai/aiDesignKnowledgeGovernance.ts`
- `src/lib/ai/aiDesignBoundedMadr.ts`
- `src/lib/ai/aiDesignTopologyRetrieval.ts`
- `src/lib/ai/aiDesignComplexWorkspaceUxV2.ts`
- `src/lib/ai/aiDesignComplexScaleCampaign.ts`
- `src/lib/ai/aiDesignReleaseEvidenceLedger.ts`

## Next action

Integration should first replace all commercial fail-closed in-memory stores and configure Redis/key management. In parallel, Precision CAD can bind the V8 renderer contract and implement the signed exact-receipt round trip. Only after both are operational should independent holdout, expert, and physical-pilot evidence be collected and the governed rollout gate reevaluated.
