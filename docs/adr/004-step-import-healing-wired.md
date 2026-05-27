# 004 — Wire the existing STEP import healing pipeline into the importer

**Status:** accepted
**Date:** 2026-05-27
**Author:** gomd999
**Risk tier:** P1 (changes the geometry returned by importStepFile; opt-out flag preserves the prior behavior)

## Context

Wave 1 W13-14 (ADR-001) calls for "STEP import healing — gap fill,
edge merge, face orient — on SW export 50 files". Reading the code
shows:

- **Healing pipeline already exists** —
  `src/app/[lang]/shape-generator/stepImport/importHealingPipeline.ts`
  exports `healImportedMesh(positions, indices, options)` which runs
  weld → sliver removal → boundary sew → hole fill → normal orient →
  manifold report. Unit tested + burn-in tested
  (`healingStress.burnin.test.ts`, 5 safety properties incl. monotonic
  improvement, watertight on combined defects, sliver removal, flip
  reorientation, deterministic, degenerate-input safety).
- **stepImporter never calls it** — `io/stepImporter.ts:117-118`
  merges meshes via `BufferGeometryUtils.mergeGeometries` and returns
  the raw result. `grep -rn 'healImportedMesh' src/app/[lang]/shape-generator/io/`
  before this ADR returns nothing.

So the W13-14 "implementation" was always wiring, not creation.

## Decision

`importStepFile` runs the healing pipeline by default on the merged
mesh. Behavior:

1. Pull positions / indices from the merged `BufferGeometry`.
2. Call `healImportedMesh(positions, indices, options.healingOptions)`.
3. Replace the merged geometry with a fresh `BufferGeometry` built
   from `result.mesh.positions` + `result.mesh.indices` and recompute
   vertex normals (the healing pipeline reorients faces, so we trust
   `computeVertexNormals` to emit consistent normals on the fixed
   topology).
4. Surface the report on `StepImportResult.healingReport` so the UI
   can show e.g. "Healed: 240 verts welded, 3 holes filled".
5. Emit a `reportInfo('step_import', 'healing_applied', report)`
   telemetry event so the Sentry rule baselines can see real-world
   healing rates.

Opt-out via `importStepFile(buffer, { healingEnabled: false })`. Two
callers warrant this:
- The Wave 1 W4-5 viewer roundtrip matrix (we want raw exporter output
  to debug round-trip bugs without healing masking them).
- Future A/B comparison tests.

We do **not** change the healing pipeline itself; it stays the
already-tested module.

We do **not** alter the `parts[]` array (per-mesh sub-geometries) —
healing is applied to the merged whole only. Per-part healing would
be more granular but invalidates the merged-whole report and the
manifold guarantee is across the whole assembly anyway.

## Consequences

### Positive

- SW / Inventor / NX STEP files arrive watertight + manifold by
  default. The 50-file SW-export validation from W13-14 can now be
  meaningful (W14 fixture work fills it in).
- Wave 0 geometry invariants (`assertManifold`, `assertWatertight`)
  pass on the imported result; downstream features (boolean / fillet /
  mate solver) can trust the input.
- Telemetry signal — pre-W3 the healing pipeline was dead code; now
  every import emits a report we can baseline against.

### Negative

- **Geometry mutation** — pre-W14 `importStepFile` returned exactly
  what occt-import-js parsed. Now it returns a healed version. Any
  caller that relies on the exact triangle count / vertex order of
  the raw OCCT parse breaks. We surveyed — no such caller exists in
  src/ — but external integrations (Tauri desktop bridge, Yjs collab
  state) might serialize geometry expecting prior shape.
- **CPU cost** — healing runs in JS (no WASM); welds 100k-vert meshes
  in ~50-200 ms based on burn-in. Per-import latency increase is
  noticeable on cold pages; acceptable because import is a one-time
  click, not a hot path.
- **Hides upstream bugs** — if occt-import-js outputs a malformed
  mesh and healing silently fixes it, we lose the signal to file an
  upstream bug. Mitigation: the telemetry report logs welded /
  sliver / flip counts; spikes indicate a parser regression.

### Neutral

- `healingReport` is opt-in to read; existing callers of
  `importStepFile` continue to work because `StepImportResult.healingReport`
  is an optional new field.

## Alternatives considered

- **Per-mesh healing instead of merged** — rejected. The merged
  result is the only thing the consumer interacts with; per-mesh
  healing produces conflicting reports and complicates the API.
- **Healing as opt-IN** (default off) — rejected because the entire
  ADR-001 W13-14 promise is "professional-grade STEP import". If
  healing is off by default it's not professional-grade.
- **Run healing in OCCT itself** (replicad.healShape) — deferred to
  Wave 2. The JS pipeline is already paid for; switching kernels for
  healing in W14 risks regressions on the same surface the rest of
  Wave 1 is validating.

## Rollout

- [x] Add healing call in `importStepFile` after merge.
- [x] Add `healingEnabled` / `healingOptions` to `StepImportOptions`.
- [x] Add `healingReport` to `StepImportResult`.
- [x] Verify tsc + lint clean.
- [ ] **Manual smoke (next dev session)** — drop a SolidWorks STEP
  export onto shape-generator, confirm `result.healingReport` shows
  realistic counts in DevTools.
- [ ] **W14 fixture work** — gather 50 SW STEP fixtures, measure
  pre-heal vs post-heal manifold rate. Add a vitest test that runs
  the fixtures through `importStepFile` and asserts ≥ 99 %
  `isWatertight` after healing. (Deferred to a follow-up commit;
  fixture collection is the long pole.)

## Reversal

`git revert <this commit>` removes the healing call from the importer.
The healing pipeline module stays — it's still unit-tested + burn-in
tested, just unused by `importStepFile`. No schema change, no migration.

For callers that need raw OCCT output without revert:
`importStepFile(buffer, { healingEnabled: false })`.

## References

- Code: `src/app/[lang]/shape-generator/io/stepImporter.ts`
- Code: `src/app/[lang]/shape-generator/stepImport/importHealingPipeline.ts`
- Code: `src/app/[lang]/shape-generator/stepImport/healingStress.burnin.test.ts`
- Linked ADRs: `001-marketplace-freeze-cad-focus.md`,
  `002-step-export-route-a-validation.md`,
  `003-occt-default-on.md`
- Wave 0: `src/lib/geometry/invariants.ts` — invariants the healed
  output now satisfies.
