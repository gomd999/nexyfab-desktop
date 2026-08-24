# AI Design ↔ Precision CAD integration contract

- Contract version: `ai-design-precision-cad/v1`
- Created: `2026-08-24`
- Producer scope: `scope/ai-design`
- Consumer scope: `scope/precision-cad`
- Integration target: `integration/nexyfab`
- Status: `PLANNED` contract; implementation claims are explicitly marked below
- Immutability: this file is a versioned handoff. Amendments must create a new
  dated file rather than changing this file.

## Purpose and operating loop

This handoff binds the AI design flow to Precision CAD through versioned Markdown
contracts and machine-readable packages/artifacts. It does not grant either
scope ownership of the other scope's implementation.

The delivery loop is:

1. **Plan-based verification** — verify the plan, current scope boundaries,
   package schemas, compatibility, security, and acceptance evidence before
   implementation.
2. **Implementation** — implement only the approved ownership slice. Simple,
   deterministic execution may be assigned to Luna; independent work may run in
   parallel when its inputs and owned paths do not overlap. Parallel work must
   converge through the same versioned package and verification gates.
3. **Inspection and adjustment** — inspect runtime behavior, artifacts, tests,
   UX behavior, and rollback evidence; adjust the plan or implementation and
   repeat the gates until acceptance criteria are met.

The Luna assignment is an execution aid, not an authority change: design
decisions, contract changes, safety review, and final acceptance remain with the
owning scope and integration owner.

## Current evidence versus planned work

### IMPLEMENTED (evidenced in ai-design scope)

- AI design owns model providers, prompting, orchestration, refinement, and AI
  design flows.
- Cross-scope exchange is required to use versioned packages and artifacts.
- The AI domain-accuracy flow has a fail-closed contract and deterministic SCAD
  model-output parsing in the existing ai-design handoff history.
- Existing ai-design handoffs identify Precision CAD as the owner of CAD-kernel
  and exact-geometry implementation.

These statements describe the current ai-design handoff evidence only; they do
not assert that the selector, gauge, preview/commit flow, or Precision CAD
consumer described below already exists.

### PLANNED (this contract)

- A model-selector receipt consumed by the AI design flow.
- Explicit separation of CAD selection from AI model selection.
- A versioned 3D gauge direct-manipulation event contract.
- Preview, commit, rollback, and verification lifecycle artifacts.
- Desktop/mobile UX behavior and accessibility acceptance evidence.
- API/artifact versioning and compatibility rules.
- Concept-only, copyright-safe output policy and acceptance tests.

## Ownership boundary

### AI Design owns

- Provider/model catalog, model capability metadata, model selection UX state,
  prompt/orchestration policy, concept-level suggestions, and AI-generated
  intent packages.
- Model-selector receipt production and validation of receipts it issues.
- Concept-only transformations and provenance/policy metadata.
- AI-side preview requests and interpretation of CAD result artifacts.

### Precision CAD owns

- CAD selection state, exact geometry, constraints, topology, kernel operations,
  units/tolerances, deterministic geometry validation, and CAD-side commit or
  rollback execution.
- The 3D viewport/gauge hit testing, manipulators, snapping, coordinate-frame
  conversion, and interaction-to-geometry mapping.
- CAD result artifacts and evidence that exact geometry is valid.

### Integration owns

- Shared registry/path decisions, cross-scope wiring, release ordering, and
  final end-to-end evidence.
- Resolving incompatible contract versions; neither scope silently changes the
  other's package schema.

## Selection contract

CAD selection and AI model selection are separate state machines. A CAD target
identifies the design entity or geometry context; an AI model selection receipt
identifies the provider/model policy used to produce a concept or intent. A CAD
selection must never implicitly select a model, and changing the model must not
silently change the selected CAD entity.

Illustrative receipt shape (normative fields, exact serialization is PLANNED):

```json
{
  "contract": "ai-design/model-selection-receipt/v1",
  "receiptId": "opaque-id",
  "model": { "provider": "opaque", "name": "opaque", "revision": "opaque" },
  "capabilities": ["concept-intent"],
  "policy": { "conceptOnly": true, "copyrightSafe": true },
  "createdAt": "RFC-3339",
  "provenance": { "promptDigest": "sha256:..." }
}
```

Consumers must reject an unknown major contract version, a missing model
revision, a false/absent `conceptOnly` policy, or a receipt whose provenance
cannot be linked to the request. Secrets and provider credentials must never be
included.

## 3D gauge direct-manipulation event contract

The gauge emits intent events; it does not mutate exact geometry. Precision CAD
validates and applies the intent using its own units, constraints, and kernel.
The event contract is PLANNED and must be versioned as
`precision-cad/gauge-intent/v1`.

Required event concepts:

- stable `eventId`, `sessionId`, and monotonic `sequence`;
- selected CAD entity reference and selection revision;
- operation (`translate`, `rotate`, or `scale`), axis/frame, signed delta, and
  declared unit;
- pointer/device modality and viewport transform revision;
- `preview: true|false` and an idempotency key;
- source model receipt ID when the gesture follows an AI suggestion (never model
  credentials or raw private prompt data).

The consumer must reject stale selection revisions, out-of-order sequences,
unsupported frames/units, duplicate non-idempotent commits, and deltas outside
the declared safety bounds. Unknown fields may be retained for forward
compatibility but must not change geometry semantics.

## Preview → commit → rollback → verification

1. **Preview:** AI Design or the viewport requests a candidate change. Precision
   CAD returns a preview artifact with the unchanged baseline revision, proposed
   delta, warnings, and a deterministic digest. Preview is non-persistent.
2. **Commit:** only an explicit user/integration commit against the same baseline
   and idempotency key may persist the change. The result includes the new CAD
   revision and artifact digest.
3. **Rollback:** a failed validation, cancellation, stale baseline, or explicit
   user rollback restores the last committed revision. Rollback evidence must
   identify the source commit/preview and resulting revision.
4. **Verification:** geometry validity, units/tolerances, artifact digest,
   selection continuity, and policy/provenance checks run after commit and after
   rollback. Verification failure is fail-closed and leaves the last known valid
   revision active.

Lifecycle artifacts are PLANNED and should use distinct types such as
`preview`, `commit`, `rollback`, and `verification`; a preview artifact must not
be accepted as a committed CAD result.

## API and artifact versioning

- Contract identifiers use `owner/name/v<major>`; additive compatible fields may
  increment a minor schema version in package metadata.
- Major-version incompatibility is explicit and fail-closed.
- Every request/result pair carries `requestId`, `contract`, `createdAt`,
  `baselineRevision`, and a content digest.
- Artifacts are immutable by digest. Corrections create a new artifact and link
  `supersedes`; consumers do not mutate received artifacts in place.
- Compatibility tests must cover old consumer/new producer and new consumer/old
  producer behavior before integration.

## Desktop and mobile UX requirements

### Desktop (PLANNED)

The model selector, CAD selection indicator, and gauge affordances are visually
distinct. Keyboard focus, modifier-key constraints, numeric entry, undo/redo,
preview/commit controls, and an always-visible validation state are required.

### Mobile (PLANNED)

Touch targets must be appropriately sized, gestures must expose axis/frame and
delta feedback, accidental commit must be prevented by an explicit confirmation,
and preview/rollback must remain reachable without relying on hover or a
keyboard. Orientation and interrupted-session recovery must preserve the
selection and receipt IDs or clearly reset them.

## Copyright-safe concept-only policy

AI output exchanged through this contract is concept-level intent, not a copied
design or a claim of ownership. `conceptOnly: true` and `copyrightSafe: true`
are mandatory for model receipts used by this flow. Do not ingest or reproduce
third-party proprietary geometry, logos, trade dress, or restricted training
content. Preserve provenance and policy decisions in artifacts; route any
licensed or user-supplied material through an explicit future contract.

## Acceptance tests and evidence

The following are PLANNED acceptance tests; a checkbox is not evidence until a
run ID, command, and artifact path are recorded by the owning scope/integration:

- [ ] CAD selection remains unchanged when only the AI model changes.
- [ ] AI model receipt is consumed, validated, and linked to the resulting
  concept/intent artifact.
- [ ] Gauge preview is non-persistent and carries the correct baseline digest.
- [ ] Commit rejects stale revisions, duplicate keys, invalid units, and unsafe
  deltas.
- [ ] Rollback restores the last valid revision and produces evidence.
- [ ] Verification failure is fail-closed with no partial geometry mutation.
- [ ] Desktop keyboard/pointer and mobile touch flows meet the UX requirements.
- [ ] Major-version mismatch and malformed/secret-bearing packages are rejected.
- [ ] Concept-only and copyright-safe policy is enforced and provenance is
  retained.
- [ ] Parallel implementation slices converge with no ownership-path overlap;
  Luna-executed simple tasks have equivalent review and evidence.

## Handoff checklist

Before integration, AI Design supplies the finalized model receipt schema,
example concept/intent packages, policy/provenance tests, and consumer-facing
compatibility notes. Precision CAD supplies gauge event validation, preview /
commit / rollback / verification artifacts, geometry safety evidence, and
viewport UX evidence. Integration records the end-to-end run, resolves any
version mismatch, and links all immutable artifacts.

This document is a coordination contract, not proof that the planned features
are implemented. A future handoff must replace each `PLANNED` item with linked
code/tests/evidence or document the remaining gap.
