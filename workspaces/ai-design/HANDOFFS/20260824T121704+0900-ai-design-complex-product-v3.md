# AI Design complex-product V3 handoff

- Producer scope: `scope/ai-design`
- Consumer scopes: `scope/precision-cad`, `integration/nexyfab`
- Date: 2026-08-24 KST
- Status: AI Design V3 implementation complete; Precision CAD work is contract-only in this handoff
- Supersedes for current consumption: the `PLANNED` complex-product portions of earlier AI Design ↔ Precision CAD notes; immutable earlier handoffs remain historical records

## Outcome

AI Design now supports complex-product concept planning as a hierarchy rather than a flat candidate list. It can represent assemblies, subassemblies, components, cross-part interfaces, multi-domain constraints, explicit conflict resolution, graph partitions, assembly-bound gauges, change-impact heatmaps, and signed multi-critic concept evidence.

This is not an exact-CAD or manufacturing-release claim. AI Design keeps exact geometry, detailed tolerances, interference, STEP round-trip, FEA/CAM, physical testing, and manufacturing verification at `NOT_RUN` until authoritative Precision CAD/domain evidence is returned.

## Implemented producer contracts

### Product structure and interfaces

- `nexyfab.ai-design-product-structure-graph.v1`
- `nexyfab.ai-design-assembly-interface-contract.v1`
- project/session/revision binding and SHA-256 graph/contract digests
- one assembly root; explicit parent and matching `contains` edge for every descendant
- assembly/subassembly/component/interface nodes and cross-part mechanical, electrical, fluid, spatial, or data interfaces
- orphan, cycle, invalid parent kind, endpoint, duplicate, revision, and size checks
- up to 5,000 structure nodes and 10,000 edges per graph
- interface exact-geometry/manufacturing authority is fixed to `not_run` in the AI-produced contract

### Cross-domain intent and explicit resolution

- `nexyfab.ai-design-cross-domain-constraint-graph.v1`
- mechanical, electrical, fluid, control, thermal, software, and safety domains
- up to 2,000 nodes and 5,000 edges with a content-derived SHA-256 digest
- conflicting values from different domains become a conflict node retaining every alternative and provenance; no value is selected automatically
- deterministic transitive invalidation increments the graph revision and changes its digest
- `nexyfab.ai-design-intent-resolution-command.v1` accepts only an explicit alternative selection or explicit new value
- `nexyfab.ai-design-intent-resolution-artifact.v1` binds project/session, expected graph revision/hash, selected value, rationale, provenance, impact, lineage, result hash, and artifact digest
- the reference resolution store is append-only, replay-safe, scope-bound, and deliberately unavailable in commercial mode

### Hierarchical candidates and partitions

- `nexyfab.ai-design-hierarchical-candidate-artifact.v1`
- `nexyfab.ai-design-graph-partition.v1`
- assembly/subassembly/component candidate lineage with parent/child consistency and cycle checks
- up to 256 partitions and 2,000 nodes per partition
- complete/partial graph coverage, explicit shared boundary nodes, and deterministic boundary-edge calculation
- partition exact/manufacturing states remain `not_run`

### Actual conceptual critics

The server now runs seven critics for every candidate published through the action route:

1. authority guard;
2. intent traceability;
3. assembly integrity;
4. interface completeness;
5. cross-domain consistency;
6. candidate diversity;
7. change safety.

Each result is bounded to `evidenceScope: concept`, HMAC-signed, expiry-bound, candidate/checkpoint/scope-bound, and immutably stored in `nexyfab.ai-design-multi-critic-bundle.v1`. A critic can return `PASS`, `FAIL`, or `NOT_RUN`; its `PASS` never becomes exact geometry or manufacturing evidence.

Candidate publication requires the core authority, intent, and diversity critics to be ready. Assembly, interface, cross-domain, and change critics remain `NOT_RUN` when their sidecars are not yet supplied, then can be rerun against the richer sidecars.

### Durable execution contract

- `nexyfab.durable-generation-job.v1` covers idempotent enqueue, CAS revision, leases, heartbeat, cancellation, bounded retries/backoff, terminal state, and dead letter.
- `nexyfab.transactional-outbox-contract.v1` covers project/session scope, transaction ID, aggregate sequence CAS, row CAS, ordered leasing, deduplication, retry/backoff, delivery acknowledgement, and dead letter.
- both in-memory adapters are reference-only and fail closed in commercial mode.

Integration must implement these contracts in the same PostgreSQL transaction as the authoritative workspace mutation. The in-memory adapters are not a substitute for commercial durability.

## Complex workspace UI contract

Precision CAD should consume `createAiDesignComplexWorkspaceViewModel(...)` as a read-only view model. It extends the V2 workspace with:

- a flattened assembly tree with depth, path, child count, selection, and change heat;
- interface cards that keep Precision verification visibly pending;
- an issue center for unresolved cross-domain conflicts and an explicit resolution action;
- assembly-bound fine/coarse gauges with subtree/interface scope and affected-node counts;
- artifact/reverification heatmap rows;
- per-candidate critic status separated from engineering verification;
- desktop tabs for assembly, interfaces, constraints, gauges, impact, and evaluation;
- mobile bottom sheets for the same areas plus recovery, a sticky action bar, and 44 px minimum touch targets.

Model selection/change explanation and generation state remain in the nested V2 view model. Private provider deployment IDs are not exposed.

## Precision CAD consumer work — MD contract only

No file under `worktrees/precision-cad` was modified. Precision CAD owns the following implementation:

1. Render the assembly tree, interface selection, heatmap overlay, critic badges, and assembly gauge controls from the V3 view model.
2. Preserve `structureNodeId`, `interfaceId`, `partitionId`, `candidateId`, project/session, and baseline CAD revision when the user enters the 3D viewport.
3. Treat a gauge operation as a preview intent. AI Design does not mutate B-rep/topology or persist exact geometry.
4. Before commit, show affected nodes, affected artifacts, invalidated evidence, and the ordered reverification plan; subtree/interface edits require explicit confirmation.
5. Execute commit/rollback in Precision CAD with its existing authoritative selection, topology-remap, idempotency, and revision contracts.
6. Return separate immutable Precision receipts keyed to the AI structure/interface/partition IDs. Do not mutate the AI-produced `not_run` interface or partition manifest in place.
7. Keep exact geometry, topology, interference, tolerance, STEP, manufacturing, and release states fail-closed when a receipt is missing, stale, out of scope, or digest-mismatched.
8. Record browser E2E evidence for desktop mouse/keyboard/numeric entry, mobile touch/bottom-sheet/recovery, stale revision, failed commit/rollback, and interrupted session.

### Required round-trip mapping

| AI Design field | Precision CAD consumer use | Required return binding |
| --- | --- | --- |
| `ProductStructureGraphV1.graphDigest` | assembly snapshot identity | receipt input graph digest |
| `nodeId` | selection tree and component/subassembly scope | exact occurrence/part reference plus baseline revision |
| `AssemblyInterfaceContractV1.interfaceId` | interface selection and pending badge | separate interface verification receipt |
| `partitionId` / `partitionDigest` | partial-load and affected-region scope | exact artifact digest and partition verification receipt |
| `gaugeId` / `bindingId` / `parameterId` | 3D manipulator and numeric editor | preview/commit/rollback receipt chain |
| `affectedArtifactIds` / reverification steps | preflight and heatmap | step-by-step exact verification results |
| critic bundle digest | concept rationale/evaluation display | never reused as CAD or manufacturing PASS |

## Executable acceptance scenarios

The AI Design producer now runs these scenario IDs end to end through structure, domain constraints, graph partitions, candidate manifests, signed critics, assembly gauge binding, and mobile/desktop projection:

- `machine-assembly` — servo machining cell;
- `mold-tooling` — multi-cavity injection mold;
- `electromechanical-enclosure` — outdoor motion-control enclosure.

These are reviewed synthetic fixtures, not copied commercial products. For all three, concept review is ready while Precision CAD verification and manufacturing release remain `NOT_RUN`/false. Precision CAD and integration should reuse the same scenario IDs for round-trip E2E evidence.

## Copyright and provenance boundary

- The implementation uses abstract engineering methods, independently named synthetic fixtures, schemas, validation rules, and mathematical graph operations.
- No manual text, proprietary geometry, brand design, drawing, logo, or trade dress was copied into generated code or fixtures.
- Input provenance and rights remain mandatory. Restricted or unknown-rights sources fail closed before generation.
- Candidate output is concept-only and independently worded. Exact reproduction of a referenced protected product is outside this contract.
- Source hashes bind provenance without embedding source content in manifests.

## Remaining integration work

- PostgreSQL implementations for workspace CAS, resolution lineage, critic bundles, durable jobs, outbox, and idempotency records
- object storage/retention/deletion policy for stage and candidate artifacts
- leased background worker that advances stages and critics without a browser holding the request open
- observability and dead-letter operations
- actual Precision CAD React/Three.js consumer and round-trip receipt persistence
- complex holdout campaigns and authoritative domain checks for exact CAD, tolerance, interference, STEP, FEA/CAM, manufacturability, and physical validation

## Validation evidence

- AI Design V1–V3 and API regression: 38 test files / 137 tests passed.
- V3 includes three executable complex-product scenarios; all passed.
- TypeScript typecheck passed.
- `npm run workspace:check -- ai-design` passed.
- `git diff --check` passed; only repository line-ending warnings were emitted.

## Main producer files

- `src/lib/ai/aiDesignProductStructureGraph.ts`
- `src/lib/ai/aiDesignCrossDomainConstraintGraph.ts`
- `src/lib/ai/aiDesignIntentResolution.ts`
- `src/lib/ai/aiDesignHierarchicalCandidatePartition.ts`
- `src/lib/ai/aiDesignMultiCriticEvaluation.ts`
- `src/lib/ai/aiDesignComplexEvaluationService.ts`
- `src/lib/ai/aiDesignDurableGenerationJob.ts`
- `src/lib/ai/aiDesignTransactionalOutbox.ts`
- `src/lib/ai/aiDesignComplexWorkspaceViewModel.ts`
- `src/lib/ai/aiDesignComplexProductScenarios.ts`
- `src/lib/ai/aiDesignWorkspaceActionService.ts`
- `src/app/api/nexyfab/ai-design/workspace-session/actions/route.ts`
