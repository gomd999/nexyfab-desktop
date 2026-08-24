# GP-11 canonical sketch preflight and planar-face geometry ADR

- Status: `IMPLEMENTED_BOUNDED_GEOMETRY_EXACT / RELEASE_HOLD`
- Date: `2026-08-24`
- Owner: `scope/precision-cad`
- Depends on: `GP_02_CANONICAL_V2_ADR.md`,
  `GP_03_REVISION_JOURNAL_ADR.md`, `GP_05_FEATURE_REGISTRY_EXECUTION_ADR.md`
- Release effect: the native planar-face receipt qualifies only the bounded
  geometry-exact `cad.mechanical.sketch` registry entry. Structural,
  numeric-only, and native geometry passes remain distinct and do not establish
  a fully constrained sketch, native solver authority, canonical commit, or
  product release decision.

## Decision

The first canonical sketch boundary is intentionally smaller than the existing
interactive sketch model. `nexyfab.precision-cad.canonical-sketch-preflight.v1`
accepts only one bounded, strictly convex, connected closed loop made from line
segments on an explicit `XY`, `XZ`, or `YZ` plane.

The request is bound to project ID, document ID, current revision ID, revision
sequence, canonical content SHA-256, and sketch ID. The gate snapshots only
plain data descriptors and rejects extra or missing keys, symbols, hidden
properties, accessors, exotic prototypes, proxies, cycles, invalid numbers,
oversized graphs, and unsafe identifiers before geometry is considered.

Structural acceptance requires:

- 3 to 128 finite, bounded, uniquely identified points;
- 3 to 128 uniquely identified line segments;
- valid endpoint references and no coincident endpoint identity;
- no duplicate undirected segment;
- degree two at every point and one connected cycle containing every point;
- finite non-zero signed area;
- strict convexity with no collinear turn; and
- no intersection between non-adjacent segments.

Accepted points and lines are sorted with locale-independent identifier order.
The loop traversal and SHA-256 are deterministic across input array ordering.
The result stays `PRECHECK_PASS / STRUCTURAL_ONLY / release: HOLD`; its verifier
reconstructs and revalidates the request and compares the complete canonical
result, rather than trusting a caller-provided hash or status.

## Explicit exclusions

The strict schema rejects constraints, dimensions, expressions, arcs, circles,
ellipses, splines, NURBS, holes, nested loops, open chains, construction
geometry, projected geometry, external references, and multiple profiles. It
also does not accept the existing sketch solver's saved `satisfied` flag as
evidence.

These exclusions are deliberate. The structural preflight itself does not run
either solver, prove equation residuals, establish dual-solver parity, generate
an OCCT wire or face, check kernel tolerances, or resolve persistent topology
references. A separate geometry receipt now performs the narrow native face
step described below. It does not change the structural schema; only the
separate registry handler qualifies the verified preflight as bounded
geometry-exact input.

## Numeric-only constraint slice

`nexyfab.precision-cad.canonical-sketch-constraint-solve.v1` now adds one
strict adapter after the structural preflight. It accepts only `fixed` point,
`horizontal` line, `vertical` line, and two-point `coincident` constraints.
Dimensions, expressions, units, unsupported constraint types, missing or
duplicate references, duplicate semantic constraints, and an empty effective
residual set fail closed.

The adapter sorts identifiers deterministically, fixes the solver iteration and
tolerance budgets internally, executes the existing LM solver twice, compares
status, degrees of freedom, finite residual, point identity, and coordinates,
and feeds the solved points back through the canonical structural preflight.
It rejects unsatisfied, redundant, inconsistent, over-defined, non-finite,
non-deterministic, or structurally invalid output. Its verifier reruns both
solves from the supplied source and compares the complete canonical receipt;
recomputed attacker-controlled hash fields cannot substitute for replay.

This slice reports `SOLVER_PASS / NUMERIC_ONLY / release: HOLD`. It is useful
for deterministic agent preview and for detecting unsafe solver candidates,
but it deliberately reuses the existing interactive numerical solver behind a
stricter adapter. It does not establish a native solver identity, dual-solver
parity, exact constraint satisfaction, canonical commit authority, or
commercial qualification.

## Native planar-face geometry receipt

`nexyfab.precision-cad.canonical-sketch-occt-geometry.v1` now consumes one
verified structural preflight pass for an XY, XZ, or YZ strict-convex line loop.
The `cad.mechanical.sketch` registry entry points to
`occt.sketch.convex-line-loop-planar-face`, whose parameter contract is the
`CanonicalSketchPreflightPass` itself. Execution loads the trusted Node OCCT
runtime internally, requires the authoritative registry decision to allow that
exact handler, constructs one actual planar face on the requested principal
plane, performs detailed B-Rep inspection, exports STEP, re-imports it, and
repeats the geometry checks. Stub, missing handler, registry hold, malformed
preflight, invalid face, or STEP mismatch returns `HOLD`.

The `GEOMETRY_PASS / ACTUAL_NODE_OCCT_PLANAR_FACE_STEP` receipt binds the
project, document, current revision triplet, sketch ID, canonical sketch hash,
principal plane, trusted runtime identity hash, analytic area and perimeter,
boundary-edge count, STEP hash, and receipt hash. Native and re-imported shapes
must each be one valid planar face with zero solid volume, the exact line-loop
edge count, matching area, zero span normal to the selected plane, all edges on
the boundary, and no non-manifold edge.

This receipt completes the narrow geometry-only `cad.mechanical.sketch`
graduation, taking the internal mechanical surface at that slice to 27/30. The
later bounded delete-face, versioned sweep-path, and two-member weldment slices
raise the enumerated GP-10 candidate surface to 30/30 bounded exact; they do not
broaden this sketch contract or change overall release `HOLD`. The sketch
receipt is not constraint evidence: it consumes the structural preflight rather
than the numeric-only solver result, has no dimension/expression grammar, and does not
prove zero degrees of freedom, fully constrained status, dual-solver parity,
native solver authority, curve or nested-loop exactness, or general sketch
semantics. It does not commit a canonical revision or make a manufacturing or
commercial claim. `release` remains `HOLD` and `commercialReleaseReady` remains
false.

## Next constraint-qualified slice

Any later constraint-qualified sketch version must bind all of the following to
the same current canonical revision:

1. a versioned constraint and dimension expression grammar with dimensional
   units, finite evaluation, dependency-cycle rejection, and bounded resources;
2. deterministic solver input and output, residual tolerances, degree-of-
   freedom accounting, and explicit under/over/inconsistent status;
3. independent parity checks for the supported constraint subset;
4. ordered profile extraction with orientation and inner-loop semantics;
5. the implemented native OCCT planar-face receipt plus constraint-bound replay;
6. edit, regenerate, undo, save/reopen, and stale-reference campaigns; and
7. an immutable receipt whose status cannot be supplied by the caller.

Until that slice exists, agentic tools may use the structural preflight,
numeric-only solver, and planar-face receipt only for their separately stated
purposes. They must not combine their PASS labels into a claim that the sketch
is fully constrained, constraint-exact, generally sketch-exact, manufacturable,
or committed. The registry EXACT label must always be presented with its bounded
geometry-only handler contract.

## i18n and agentic boundary

Issue codes are stable machine values, not user-facing English. UI and agent
surfaces must map those codes through the Precision CAD translation namespace
and provide a deterministic remediation field separately. Localized strings
must never participate in the canonical or receipt hash. Plane identifiers,
units, numeric geometry, status, verification, and blocker codes remain stable
machine values; locale formatting is display-only. Agent-provided geometry is
treated exactly like any other untrusted request and cannot provide its own
solver, runtime, verifier, registry status, revision authority, or release
decision.

## Clean-room and rights rule

This contract is independently derived from general graph, planar geometry,
numerical-safety, and content-addressing concepts plus behavior already present
in this repository. External manuals and the local CAD encyclopedia may be used
only to identify broad capabilities or validation questions. Their wording,
diagrams, tables, taxonomy, UI arrangement, algorithms, source, sample values,
and fixtures are not copied. Any source with unclear license or provenance is
excluded rather than adapted.

## Remaining release HOLD

Passing this gate supplies no standards conformance, sketch-solver correctness,
kernel interoperability, drawing or PMI evidence, discipline-specific design
validation, independent review, localization review, operational assurance, or
real-project pilot evidence. Commercial and manufacturing release remain
`HOLD`.
