# B1 Face Provenance — Current State and Deep-Impl Path

Status snapshot: 2026-05-12. Coarse provenance is wired and works for the
DFM ↔ FeatureTree highlight flow described in the memory. The "deep" per-face
implementation (each output triangle/face knows which feature produced it) is
still open work — multi-day, behind STEP AP242 in priority.

## What works today

`src/app/[lang]/shape-generator/features/pipelineManager.ts` tags every
post-feature `BufferGeometry` with `userData.lastFeatureId = f.id` in both the
sync loop (`pipelineManager.ts:141`) and the async loop
(`pipelineManager.ts:220`). `analysis/dfmAnalysis.ts` reads that field and
fills every emitted `DFMIssue.targetFeatureId` with it. `DFMPanel`'s 🌳
button calls `setHighlightedFeatureId` on the issue's target, and the
`FeatureTree` row glows for ~4s (the original B1 flow from the 2026-05-08
memory).

That coverage is "always correct" — every DFM issue points to the most-recent
feature that touched the geometry — but it's coarse. If a single feature
emits issues on multiple regions, they all point to the same feature row.

## What deep B1 would require

Per-face provenance means each output face (or triangle group) carries an
id of the feature that produced *it specifically*. The hard cases:

1. **Boolean ops (cut/union/subtract)** — output faces split into:
   - faces inherited from the base solid
   - faces inherited from the tool solid
   - new faces along the intersection curve

2. **Fillet / chamfer / shell** — the rounded/swept faces are new and clearly
   belong to the fillet feature; the unaffected faces still belong to upstream
   features.

3. **CSG mesh path vs OCCT B-rep path** — both pipelines exist in the repo
   and would each need provenance hooks. The mesh path can attach a
   per-triangle index attribute; OCCT propagates face labels through its
   own kernel and we'd need to read those back.

## Prior art already in the repo

`src/lib/ai/scad-agent/faceIdRegistry.ts` ships a `FaceIdRegistry` plus
`assignPrimitiveFaceIds` / `recordPropagation` / `resolveFaceIndex` for the
*scad-agent* tool flow. It is not currently consumed by the shape-generator
pipeline. The data model is the natural starting point for a deep B1 — adapt
the registry to be keyed off `BufferGeometry.uuid` (or our `stampGeoId`),
and propagate through `featureMap[f.type].apply()` instead of through the
scad-agent's `recordPropagation` calls.

## Suggested implementation order

1. **Introduce `BufferAttribute` for face-feature id on every output geometry**
   (a `Uint32Array` indexed by triangle index). Default-fill with
   `lastFeatureId` so downstream consumers see no behavior change.

2. **Cut/union/subtract** — when `applyCSG()` returns, walk the
   tri-index → which-input-mesh map (CSG.js / replicad both expose this)
   and copy the face-feature id from the relevant input attribute.

3. **Fillet / chamfer / shell** — these features add new faces. Tag the
   newly-emitted triangle range with the current feature id; copy the
   pre-existing attribute through for the untouched triangles.

4. **OCCT B-rep path** — read OCCT's own face labels via
   `OcctImportJs.GetFaceUserDefinedLabels` (or the equivalent in our
   wrapper), map them back into the same `Uint32Array` attribute.

5. **DFM analyzer** — when an issue is emitted for triangles
   `[i0..i1]`, look up the face-feature id at any triangle in that range
   instead of falling back to `lastFeatureId`.

6. **Tests** — boolean burn-in test: cut a labelled cylinder from a labelled
   box, then assert that the wall triangles still carry the box's feature id
   while the new bore-wall triangles carry the cylinder feature's id.

## Risk

The mesh-path implementation is doable. The OCCT-path implementation depends
on what `occt-import-js` actually exposes for face labels — if it strips
them on conversion, we need a different binding or a pre-conversion read
pass. Estimate: 3–5 days for mesh path + tests, plus an OCCT-path spike
before committing to OCCT coverage.

## Right-now decision

Keep the coarse `lastFeatureId` provenance — it is correct and ships a working
DFM-to-FeatureTree highlight flow. Schedule deep B1 alongside (or after) the
STEP AP242 round-trip work, since both touch the OCCT WASM layer and a single
focused session can validate both.
