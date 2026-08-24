# AI Design model selection and direct-edit implementation handoff

- Producer: `scope/ai-design`
- Consumer: `scope/precision-cad`
- Contract date: `2026-08-24` (Asia/Seoul)
- Contract family: `ai-design-precision-cad/v1`
- Status: AI Design producer implemented; Precision CAD consumer pending
- Previous planning contract:
  `20260824T120000Z-precision-cad-ai-design-contract.md`
- Immutability: amend this handoff by adding a new dated file.

## Implemented in AI Design

### Model selection

- Pure deterministic selection policy for `auto`, `quality`, `balanced`,
  `fast`, and `manual` modes.
- Simple execution is routed to Luna when entitlement and required capability
  checks allow it.
- Plan, vision, reasoning, structured-output, precision-intent, latency, risk,
  provider, allowlist, and denylist constraints are evaluated before selection.
- Manual selection fails closed. Automatic fallback is explicit in
  `nexyfab.model-selection-receipt.v1`; it is never silent.
- Every receipt declares `conceptOnly: true`, `copyrightSafe: true`, and
  `exactGeometryAuthority: false`.
- Authenticated model catalog/selection API:
  `GET|POST /api/nexyfab/ai-design/model-selection`.

Source:

- `src/lib/ai/modelSelectionPolicy.ts`
- `src/app/api/nexyfab/ai-design/model-selection/route.ts`

### Gauge/direct manipulation producer

- `nexyfab.direct-manipulation-intent.v1`
- `nexyfab.direct-manipulation-proposal.v1`
- Stable intent, gesture, session, sequence, idempotency, project, selection,
  viewport, coordinate-frame, device, and revision identities.
- Explicit absolute/delta measurement semantics and `mm`, `deg`, or unitless
  units.
- Feature parameter, sketch dimension, face offset/draft, edge fillet/chamfer,
  occurrence translation, and occurrence rotation bindings.
- Finite/range checks, normalized axes, selected-part confinement, topology
  reference confinement, and stale-revision rejection.
- Derived/ambiguous selections and AI assumptions require a confirmation bound
  to the exact proposal and base revision before commit readiness.
- AI-suggested gestures require a model receipt whose policy is concept-only,
  copyright-safe, and explicitly lacks exact-geometry authority.
- Preview is non-mutating. Commit only reaches `READY_FOR_CAD`; AI Design never
  claims that exact geometry changed.
- Commit readiness requires a rollback snapshot ID, SHA-256, and matching base
  revision.
- Request and proposal artifacts are canonical-JSON SHA-256 bound.
- Authenticated, CSRF-checked, project-access-checked, bounded API:
  `POST /api/nexyfab/ai-design/direct-edit`.

Source:

- `src/lib/ai/directManipulation.ts`
- `src/lib/ai/directManipulationSchema.ts`
- `src/lib/ai/directManipulationDigest.ts`
- `src/lib/ai/aiEditTransaction.ts`
- `src/app/api/nexyfab/ai-design/direct-edit/route.ts`

### Precision CAD receipt guard

AI Design accepts downstream results only through
`nexyfab.precision-cad-direct-edit-receipt.v1`. The guard binds the receipt to
the proposal ID, intent ID, project, idempotency key, base revision, and exact
proposal SHA-256. It rejects:

- missing or malformed result/rollback hashes;
- a rejected operation that changed revision;
- an apply result whose revision did not advance;
- unbound PASS/FAIL evidence;
- a VERIFIED claim without geometry and topology PASS evidence;
- verification failures that do not fail closed;
- rollback without its source receipt.

Source: `src/lib/ai/precisionCadDirectEditReceipt.ts`.

### Headless desktop/mobile UX contract

- Concept, parametric, and precision tracks with pending, verified, stale, and
  blocked states.
- Change reason, affected artifacts/tracks, reverification need, and actions.
- Desktop rail/split and mobile bottom-sheet/stacked presentation.
- One-finger edit versus two-finger camera arbitration.
- Mobile long-press edit lock, explicit editing state, and X/Y/Z axis lock.
- Minimum 44 px touch targets and finite/ranged numeric-entry fallback.
- Cancellation and checkpoint-based resume.
- Reduced-motion, non-color status semantics, and state announcements.
- Compact low-data payload without geometry bytes or verbose explanations.

Source: `src/lib/ai/aiDesignInteractionContract.ts`.

## Required Precision CAD consumer work

No Precision CAD file was changed by this handoff. The consumer should:

1. Add the visual AI model selector and persist the selected receipt ID without
   changing CAD selection state.
2. Render the 3D gauge/manipulator and construct the v1 intent using the
   authoritative CAD selection, viewport revision, coordinate frame, units,
   and current model revision.
3. Compute the exact intent SHA-256 and call the AI Design direct-edit API for
   preview/commit planning.
4. Keep preview local and non-persistent. A preview response is not a CAD
   success receipt.
5. Recheck project, selection, topology, units, base revision, safety limits,
   confirmation, and proposal SHA-256 inside Precision CAD before execution.
6. Persist an idempotency ledger keyed by project and idempotency key. A retry
   must return the original receipt and must not execute geometry twice.
7. Translate supported `CadEditOperation` values to exact-kernel operations.
   Unknown operations fail closed.
8. Produce the v1 result receipt with immutable artifact hashes, rollback
   binding, new revision, and bound geometry/topology evidence.
9. Do not emit VERIFIED until exact geometry and topology checks pass. DFM may
   remain `NOT_RUN`, but must never be represented as PASS.
10. Implement desktop pointer/keyboard and mobile touch/bottom-sheet rendering
    against the headless interaction contract.

## Wire-level integration order

```text
Precision selection + gauge
  -> direct-manipulation intent + SHA-256
  -> AI Design preview proposal
  -> user review/explicit confirmation when required
  -> AI Design READY_FOR_CAD proposal + SHA-256
  -> Precision CAD idempotency/revision/topology recheck
  -> exact CAD execution or fail-closed rejection
  -> Precision CAD receipt
  -> AI Design receipt guard
  -> geometry/topology status shown to the user
```

## Acceptance evidence completed in AI Design

- Targeted Vitest: 7 files, 44 tests passed.
- TypeScript workspace typecheck passed.
- `npm run workspace:check -- ai-design` passed with no shared, foreign, or
  unclassified path violations.
- The workspace check also passed 11 common accuracy test files (62 tests) and
  7 candidate-manifest node tests.

## Acceptance evidence still required from Precision CAD/integration

- Visual model selector and gauge interaction tests.
- Authoritative revision/topology recheck at the exact CAD boundary.
- Durable duplicate-commit/idempotency evidence.
- Exact face/edge/feature operation mapping and kernel result evidence.
- Preview non-persistence, commit, rollback, and verification lifecycle test.
- Desktop keyboard/pointer, mobile touch/orientation/interruption, accessibility,
  and low-bandwidth end-to-end evidence.

## Copyright and provenance boundary

This implementation uses general design-method concepts only. It contains no
copied manual prose, diagrams, tables, examples, or encyclopedia text. Source
model receipts require concept-only and copyright-safe policy flags. Precision
CAD must not treat those flags as proof of third-party license ownership; user
or licensed source artifacts require their own provenance contract.
