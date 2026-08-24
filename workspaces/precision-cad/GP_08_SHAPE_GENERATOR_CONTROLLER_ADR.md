# GP-08 Shape Generator controller boundary ADR

Date: 2026-08-24

Status: accepted for the GP-08 foundation slice; broader feature-command
decomposition continues behind the same contracts.

## Decision

`ShapeGeneratorInner.tsx` remains the React orchestration adapter, while
persistence, access policy, and agent-truth decisions move into precision-owned
pure controllers. This slice does not change the canonical authority model and
does not give an agent commit authority.

The extracted boundaries are:

- `studioViewController`: deterministic view snapshot/default restore, finite
  camera pairing, offset clamping, and accessor/proxy-safe input handling.
- `globalVariablePersistenceController`: persist only variable names and raw
  expressions; the existing single expression resolver remains authoritative
  for evaluated values.
- `assemblySnapshotController`: detached assembly snapshot/restore with body
  selection validation and cloned mutable collections.
- `shapeGeneratorAccessController`: stable capability categories and a
  fail-closed read-only policy. New shell tools default to document mutation.
- `agenticCadContractViewModel`: accepts only an exact GP-07 UI envelope and
  validated plan/dry-run/policy/preview receipts. Generic run completion never
  becomes CAD PASS.

## Read-only enforcement

`?readonly=1` now blocks persistence and document mutation at the execution
boundary, not only by hiding chrome:

- local recovery/autosave/session markers and scene dirty/autosave are disabled;
- save, cloud-save, open, undo/redo, edit, transform, and sketch mutation
  shortcuts are blocked while camera/view/measurement shortcuts remain;
- shell tools, sheet-metal tools, AI candidate application, feature/sketch
  mutation events, assembly mate edits, PDM restore, Studio handoff, STEP/file
  import, CAM execution, material/geometry drops, and direct canvas edit
  callbacks are denied;
- empty-canvas creation guidance and the mutable sketch palette are not exposed.

Export and bounded inspect/view operations remain allowed. This is a UI/runtime
capability boundary, not an authorization substitute for the canonical server.

## Agent truth UI

The precision-owned `AgenticCadContractSummary` is rendered above the legacy
AI-owned agent panel. It supports the six product locales and Arabic RTL, never
renders raw tool output/issues, and always displays `NOT_AUTHORITATIVE · HOLD`.
A valid sandbox receipt may display `SANDBOX_PASS`, but `cadPass` remains false,
authoritative commit remains unavailable, and release remains HOLD.

The current legacy controller does not yet emit the versioned
`agenticCadContract` envelope, so the production UI correctly begins at
`NOT_RUN · HOLD`.

## Verification

- controller/access/autosave/agent contract focused regressions pass;
- GP-07 plan, dry-run, policy, and canonical-preview validators pass;
- six-locale and Arabic RTL summary tests pass;
- TypeScript workspace typecheck passes.

## Residual HOLD

- `ShapeGeneratorInner.tsx` is still large; feature edit, sketch history, URL
  routing, event registration, and export orchestration need further controller
  slices as their domain pilots are closed.
- Trusted approval consumption, lock TOCTOU recheck, authoritative revision
  commit, and durable one-time approval remain integration-owned.
- The AI-owned controller still has permissive generic success semantics. The
  precision summary prevents that signal from being represented as CAD truth,
  but the shared controller/panel must be hardened in its owning scope.
- Query-only URL navigation, shell palette click selection, and fullscreen
  storage failure remain separately tracked behavioral defects.

## Copyright and provenance

The controller contracts and tests are original clean-room implementations
derived from general CAD safety, persistence, and authorization concepts. No
manual prose, proprietary UI layout, source code, or branded workflow was
copied.
