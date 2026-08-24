# AI Design workspace UI consumption handoff

- Producer: `scope/ai-design`
- Consumer: `scope/precision-cad`
- Contract date: `2026-08-24` (Asia/Seoul)
- Contract family: `ai-design-precision-cad/v1`
- Status: AI Design state/view-model/screen binding implemented; Precision CAD visual consumer pending
- Supersedes for new integration work:
  `20260824T043323+0900-ai-design-direct-edit-implementation.md`
- Immutability: corrections or extensions require another dated handoff file.

## Scope result

AI Design now supplies a headless, fail-closed UI state package for text,
image, sketch, 2D drawing, 3D selection, generation, candidate review,
parametric editing, Precision CAD verification, and mobile recovery. This
handoff does not modify Precision CAD and does not claim that its React or
Three.js UI already consumes the package.

| Consumer concern | AI Design producer | Precision CAD responsibility |
| --- | --- | --- |
| Unified intake | `DesignIntentCheckpointV1` | Convert UI/import events into provenance-bound sources and facts |
| Workflow | `AiDesignWorkflowState` | Render current/next actions; never skip guards |
| Candidate review | `CandidateComparisonViewModel` | Render up to three comparable candidates and evidence states |
| Direct edit | `GaugeViewModelV1` plus direct-edit proposal | Render/hit-test the gauge and perform exact CAD operations only after commit |
| Workspace | `AiDesignWorkspaceViewModel` | Subscribe once and render model, explanation, edit, and verification state |
| Screen slots | `AiDesignScreenBindingV1` | Bind named regions/actions to desktop and mobile components |
| Mobile recovery | `AiDesignMobileRecoveryState` | Persist validated resume data and discard interrupted dirty gestures |
| Exact result | Precision receipt guard | Produce bound geometry/topology evidence and the new revision |

## Implemented producer contracts

### Unified design-intent checkpoint

`src/lib/ai/designIntentCheckpoint.ts` accepts `text`, `image`, `sketch`,
`drawing_2d`, and `selection_3d` through one checkpoint. Project, revision,
source hashes, provenance, rights, user-confirmed facts, imported authority,
AI assumptions, missing fields, conflicts, and follow-up questions are
explicit. Readiness is derived and validated rather than trusted. Merges reject
project/revision/hash conflicts and do not silently promote an AI assumption to
user or imported authority.

### Complete workflow and recovery

`src/lib/ai/aiDesignWorkflow.ts` covers:

```text
EMPTY -> UNDERSTANDING -> NEEDS_INPUT -> READY_TO_GENERATE -> GENERATING
      -> CANDIDATE_REVIEW -> PARAMETRIC_EDIT -> PRECISION_PENDING
      -> PRECISION_VERIFYING -> VERIFIED
```

`STALE`, `BLOCKED`, `FAILED`, and `CANCELLED` are explicit guarded states.
Understanding, candidate, and verification completions require bound PASS
evidence with the expected digest and source. Cancellation/failure records and
restores the exact resumable stage.

`src/lib/ai/aiDesignMobileRecovery.ts` supplies `peek`, `half`, and `expanded`
bottom-sheet states, safe-area and keyboard constraints, low-data mode,
selection preservation, interruption-safe gesture discard, and one-use resume
tokens bound to workflow revision, checkpoint, operation, and timestamp.

### Candidate and gauge view models

`src/lib/ai/designCandidateComparison.ts` limits comparison to three
candidates. Metric/evidence status is one of `verified`, `failed`, `unknown`,
or `not_run`; conceptual recommendation never manufactures VERIFIED evidence.
Whole or partial apply fails closed on stale, scope, and verification errors.

`src/lib/ai/gaugeViewModel.ts` supports length, radius, diameter, angle,
translation, rotation, fillet, chamfer, and draft views. Each gauge binds the
selection, base revision, current/target/delta values, unit, snap, range,
axis/frame, confirmation need, and invalidated tracks. Non-finite, out-of-range,
and invalid snap values are rejected before a proposal is produced.

### Unified workspace and screen binding

`src/lib/ai/aiDesignWorkspaceViewModel.ts` composes checkpoint, workflow,
interaction, model selection, candidate comparison, gauges, direct-edit
proposal, change explanation, mobile state, and Precision CAD receipt. It emits
one `READY`, `ATTENTION`, or `BLOCKED` safety state plus panels, primary action,
warnings, issues, and a compact low-data payload.

The workspace preserves both `baseRevisionToken` and the accepted Precision
CAD `revisionToken`. A `VERIFIED` workspace is impossible without an accepted
receipt whose geometry and topology evidence both PASS.

`src/lib/ai/aiDesignScreenBinding.ts` maps that workspace to stable regions:
`header`, `intake`, `canvas`, `candidates`, `assistant`, `verification`,
`action_bar`, and `mobile_sheet`. It also exposes the model selector, gauge
overlay, Precision badge, enabled actions, and the preview/commit/stale safety
rules.

## Precision CAD visual consumer checklist

1. Subscribe the actual workspace screen to `AiDesignWorkspaceViewModel`; do
   not reconstruct independent model, candidate, or verification truth in UI
   components.
2. Bind desktop regions from `AiDesignScreenBindingV1`; bind mobile to
   `header`, `canvas`, `action_bar`, and `mobile_sheet`.
3. Keep AI model selection independent of CAD entity selection. Changing or
   falling back a model must preserve the selected entity and gauge identity.
4. Convert text/image/sketch/drawing/selection events to source records with
   content hashes and rights/provenance status. An unknown or prohibited right
   blocks generation.
5. Display `unknown` and `not_run` distinctly from `verified`; never infer a
   green/PASS state from a recommendation.
6. Render one primary gauge and numeric-entry fallback. Preview remains local
   and non-persistent; an explicit commit is required.
7. Revalidate project, selection, topology, units, base revision, bounds,
   confirmation, idempotency, and proposal digest at the exact CAD boundary.
8. After exact execution, return the v1 receipt and result revision. Show an
   authoritative Precision badge only when the guard accepts geometry and
   topology PASS evidence.
9. On backgrounding, offline transition, camera conflict, or interruption,
   discard a dirty in-progress gesture and preserve only validated selection
   and resume state.
10. Keep 44 px minimum touch targets, keyboard-safe bottom-sheet sizing,
    numeric input, non-color-only statuses, and reduced-motion behavior.

## Executable user scenarios

`src/lib/ai/aiDesignUserScenarios.ts` is the acceptance manifest;
`src/lib/ai/aiDesignUserScenarios.test.ts` executes its contract composition.

| Scenario ID | Required result |
| --- | --- |
| `multimodal-to-verified-precision` | All five input kinds reach an authoritative Precision result with base/result revision continuity |
| `mobile-interruption-resume` | Dirty gesture is discarded, selection retained, and generation resumes at the exact stage |
| `model-fallback-preserves-cad-selection` | Explicit fallback is shown without changing CAD selection or gauge identity |

The consumer and integration branches should reuse these IDs in component/E2E
evidence so cross-scope failures remain traceable.

## Current producer evidence

- Targeted AI Design contracts: 11 test files, 59 tests passed.
- Workspace TypeScript typecheck passed.
- `npm run workspace:check -- ai-design` passed: expected/current branch
  `scope/ai-design`, no shared or foreign path violations, no unclassified new
  paths, 11 common-accuracy files / 62 tests passed, and 7 candidate-manifest
  node tests passed.

## Copyright, provenance, and authority boundary

Only general CAD/design methodology concepts are represented. No manual or
encyclopedia prose, diagrams, tables, formulas, examples, UI artwork, or source
geometry is copied. A source record must identify its provenance and usage
rights; `unknown` or prohibited rights fail closed. `conceptOnly` and
`copyrightSafe` model-policy flags are workflow constraints, not proof that a
third-party artifact is licensed. Exact geometry, kernel execution, topology,
and final manufacturing verification remain Precision CAD authority.
