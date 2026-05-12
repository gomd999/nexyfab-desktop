# STEP Export Gating — Current State and AP242 Compatibility Path

Status snapshot: 2026-05-12. The `canExportStepCleanly()` UI guard is wired
and in production (see `CommandToolbar.tsx:1446`, `ShapeGeneratorInner.tsx:6798`).
General-mesh STEP export remains the open work the 2026-05-08 R2 burn-in
flagged as blocking.

## Decision today

The toolbar STEP button is enabled only when **either**:

1. the geometry carries an OCCT B-rep handle (`userData.occtHandle`), so we
   round-trip through the OCCT kernel itself; OR
2. the geometry is a `THREE.BoxGeometry`, so we use the
   `remapAp214NxCubeToBox` AP214 NX-cube fast path which round-trips byte-
   for-byte through `occt-import-js`.

For everything else (cylinders, spheres, sweep/loft results, CSG output,
hand-written meshes) the button is greyed out with a tooltip. STL / GLB /
OBJ remain available because their importers don't share the AP242
fragility we are gating against.

This matches the R2 burn-in finding (`docs/strategy/RAILWAY_CRON_SETUP.md`
era — see `project_nexyfab_3d_burnin.md` memory entry, 2026-05-08):

> Cylinder/Sphere/Sweep results: hand-written AP242 `COORDINATES_LIST +
> TRIANGULATED_FACE` is rejected by `occt-import-js` with `STEP parsing
> failed: Unknown error`. BoxGeometry's AP214 fast path is the only mesh
> shape that round-trips cleanly.

## Source pointers

- `src/app/[lang]/shape-generator/io/stepExporter.ts:44` —
  `canExportStepCleanly()` predicate.
- `src/lib/cad/remapAp214NxCubeToBox.ts` — AP214 NX-cube fast path for
  THREE.BoxGeometry.
- `src/app/[lang]/shape-generator/features/occtEngine.ts` — `exportOcctStep()`
  for the OCCT-handle path.
- `src/app/[lang]/shape-generator/__tests__/step.roundTrip.test.ts` — R2
  round-trip evidence; `pipeline.occt.burnin.test.ts` covers Q1.

## To open the export to general meshes

Two routes; either works, but route A is the cleaner long-term answer.

### Route A — emit STEP through the OCCT WASM kernel

Every shape can be re-meshed into an OCCT B-rep representation via the
existing `occtEngine.fromMesh()` path, then `exportOcctStep()` produces a
file the OCCT importer will accept because the same kernel wrote it. The
work is to call `fromMesh` on geometries that lack `occtHandle` and cache
the resulting handle on `userData` so subsequent exports skip the
conversion. Cost: ~3 days. Risk: re-meshing introduces small precision
deltas on round-trip; covered by an extended R2 test.

### Route B — hand-roll a strict AP242 emitter that occt-import-js accepts

Probe `occt-import-js` against minimal `COORDINATES_LIST` + `TRIANGULATED_FACE`
samples (a single triangle, a single tetra, etc.) and reverse-engineer what
shape the importer actually wants. Update the emitter in `stepExporter.ts:50`
to match. Cost: ~2 days *if* the importer is well-behaved; can balloon if
its rejection logic is opaque. Risk: ties us to one importer's quirks; a
second viewer may reject the same payload.

### Recommendation

Route A. The OCCT kernel ships with the app already (the `prebuild` script
copies `occt-import-js.wasm` into `public/`), and a B-rep-first export path
plays nicely with downstream consumers (NX, CATIA, Fusion) that prefer real
ADVANCED_FACE-based STEP over tessellated approximations. Combine the work
with the deep B1 face-provenance pass (`docs/strategy/b1-face-provenance.md`)
— both need OCCT face-label propagation, so a single focused session pays
off twice.

## Right-now decision

Ship behind the gate. `canExportStepCleanly()` plus the greyed-out toolbar
button is correct — users export real STEP from box / OCCT geometry and get
a clear "STL/GLB only for this shape" tooltip elsewhere. Re-evaluate after
Route A lands or whenever a customer requests cylinder/sphere STEP.
