# GP-10 bounded mechanical exact closed-loop ADR

- Status: `IMPLEMENTED_INTERNAL_30_OF_30_BOUNDED / RELEASE_HOLD`
- Date: `2026-08-24`
- Owner: `scope/precision-cad`
- Integration target: `integration/nexyfab`
- Integration intake: `PENDING_CLEAN_SOURCE_COMMIT_AND_FINAL_CI`
- Depends on: `GP_03_REVISION_JOURNAL_ADR.md`,
  `GP_04_NATIVE_XCAF_ADR.md`, `GP_05_FEATURE_REGISTRY_EXECUTION_ADR.md`
- Release effect: none. A local exact receipt is not a commercial qualification,
  authoritative revision commit, or manufacturing approval.

## Decision

Mechanical features graduate only through a bounded, fail-closed vertical loop:

1. validate an exact-key request bound to project, document, operation, base
   revision ID, sequence, and canonical content SHA-256;
2. resolve the feature through the immutable registry and the internally loaded,
   verified Node OCCT runtime;
3. execute a real B-Rep handler without accepting caller-supplied bridges,
   identities, verifiers, receipts, or fallback geometry;
4. inspect validity, single-solid topology, finite bounds, and positive volume;
5. require a material geometric change;
6. export STEP, re-import it, and compare solid count, volume, and bounding box;
7. bind the request, runtime, registry, measurements, and STEP hashes into a
   deterministic receipt.

Any failure returns a stable `HOLD` blocker. Mesh, SCAD, browser preview, an
unverified handler, a stale base binding, or a structurally plausible receipt
cannot be promoted to exact success.

## First GP-10 graduation slice

The prior registry had 9 bounded exact entries among the 30 mechanical
candidates. This slice adds three entries backed by existing real OCCT
primitives and a new native closed-loop executor:

- `cad.mechanical.variable-fillet`: explicit stable edge IDs and per-edge radii;
- `cad.mechanical.draft`: bounded positive angle, non-zero pull direction, and
  explicit neutral plane elevation;
- `cad.mechanical.thread`: bounded external cylindrical thread only, +Z axis,
  explicit hand, major/minor diameter, pitch, depth, and an eight-turn maximum.

The registry surface reached 12/30 exact internally after this slice. A second
bounded slice adds `cad.mechanical.scale`: positive uniform scale about the
global origin only, with native transform, factor-cubed volume, scaled bounding
box, topology, resource-budget, and STEP re-import checks. A third bounded
slice adds translation-only `cad.mechanical.move-copy`: one non-zero finite
translation of one solid, with topology and volume preservation, translated
bounding-box invariants, coordinate/resource bounds, and STEP re-import. The
next slice adds `cad.mechanical.mirror`: a single solid reflected through an
explicit bounded point/normal plane, with normalized plane semantics, reflected
eight-corner bounding-box checks, topology/volume preservation, and STEP
re-import. Copy-pair, rotation, assembly and multi-body mirror semantics remain
blocked. A fifth slice adds one centered straight rectangular
`cad.mechanical.rib` fused to the top of a convex prism, with exact footprint,
added-volume, single-solid, bounding-box, and STEP round-trip checks. Offset or
multiple ribs and non-convex hosts remain blocked. A sixth slice adds only the
positive `f.cap.top` form of `cad.mechanical.offset-face` on a convex prism. It
requires the stable face reference to exist in the live bridge and proves the
polygon-area-times-distance volume increase and top bounding-box displacement.
Bottom, side, inward, non-convex, and ambiguous face-reference forms remain
blocked.

A seventh slice adds `cad.mechanical.cut`: one strictly interior rectangular
through-tool removes material from one convex prism through native subtract.
Tangential, boundary-touching, non-rectangular, partial-depth, and multi-tool
cuts remain blocked. An eighth slice adds `cad.mechanical.linear-pattern`: two
to eight translated copies of one axis-aligned rectangular prism, restricted to
an exact `+/-X` or `+/-Y` direction and spacing that guarantees connection.
Copies are made from the original body and fused sequentially; each copy and
accumulator must remain a valid, closed, single solid within the resource
budget, and the final volume and bounding box must satisfy the closed-form
overlap invariant.

A ninth slice adds `cad.mechanical.circular-pattern`: two to eight native
rotations around the exact `+/-Z` axis through the rectangular host centre,
with a non-zero partial angle below 360 degrees. Every copy must preserve the
base volume, every union must add non-zero material while also proving non-zero
overlap, and every intermediate result must remain a valid closed single solid.
This rejects disjoint, tangential, full-turn, off-centre, alternate-axis, and
symmetry-duplicate cases instead of silently changing them to multi-body or
no-op semantics.

A tenth slice adds `cad.mechanical.loft` as a creation feature rather than
inventing a dummy host body. It uses a real OCCT ruled solid through two or
three strict-convex XY sections with equal vertex counts, common winding, and
strictly increasing Z. The aggregate section bounding box, positive volume,
single-solid closed adjacency, resource bounds, and STEP round trip are checked.
Smooth, more-than-three-section, non-convex, mismatched, and general spatial
profile lofts remain blocked.

An eleventh slice adds a bounded true `cad.mechanical.sweep` creation feature. It
accepts exactly three path points forming two positive, non-collinear,
orthogonal axis-aligned segments and one bounded constant rectangular section.
The native handler `occt.sweep.orthogonal-polyline-rect` uses an OCCT pipe shell
with right-corner transition and closes it as a solid. The result must be a
valid, closed, manifold single solid with positive volume, bounded expected
bounding box, and matching STEP export/re-import measurements. This is a
deliberately narrow non-straight sweep. General FeatureTree `tree:sweep`,
`tree:sweep_path`, arbitrary spatial paths, changing sections, alternate corner
transitions, and self-intersecting paths remain blocked.

A twelfth slice adds bounded `cad.mechanical.split-body` through
`occt.split-body.keep-side-axis-plane`. Its allowed host is one axis-aligned
rectangular prism; the split plane is an XY, XZ, or YZ plane at an offset
strictly inside the host, and exactly one explicit positive or negative side is
retained through native intersection. The operation proves the plane intersects
the host and checks a valid closed single solid, the analytic retained volume
and bounding box, resource bounds, and STEP export/re-import parity. Returning
both bodies, a full split result, arbitrary or non-planar tools, and independent
editing of split products remain `HOLD` until a versioned multi-body/XCAF
contract exists.

A thirteenth slice adds bounded `cad.mechanical.bend` through
`occt.bend.single-rectangular-sheet`. The input is one rectangular sheet host
with length, width, and thickness, one bounded `fixedLengthMm`, one positive
`innerRadiusMm`, an angle from 5 through 90 degrees, and `direction: up` only.
The raw Node OCCT bridge builds an eight-edge analytic cross-section comprising
straight material and two concentric circular arcs, then prisms it across the
sheet width. Exact checks require preservation of the flat-sheet volume and
surface area, the analytic bounding box, eight planar and two cylindrical faces,
cylinder radii `[R, R + thickness]`, a closed manifold single solid, and STEP
export/re-import parity. This is idealized geometry only: material behavior,
K-factor, springback, tooling, bend or corner relief, downward bends, and
multi-bend semantics are excluded and must not be inferred.

A fourteenth slice adds bounded `cad.mechanical.flange` through
`occt.flange.single-positive-end`. It accepts one rectangular sheet host, only
`edge: positive_length_end`, `direction: up`, an angle from 5 through 90
degrees, one positive `straightLegLengthMm`, and one positive `innerRadiusMm`.
The implementation reuses the verified analytic bend primitive to retain the
base sheet and add circular-arc plus straight-leg material. It checks the base
volume and the exact increase derived from arc and leg developed length, the
corresponding developed-length surface area, analytic bounding box, eight
planar and two cylindrical faces, radii `[R, R + thickness]`, a closed manifold
single solid, resource bounds, and STEP export/re-import parity. Generic edge
selection, miter, relief, downward direction, multiple flanges, material
compensation, and tooling remain blocked.

A fifteenth slice adds bounded `cad.mechanical.flat-pattern` through
`occt.flat-pattern.single-bend-step-dxf`. The
`nexyfab.precision-cad.bounded-sheet-metal-flat-pattern-request.v1` request
contains only an operation ID and one bounded bend or positive-length-end
flange `sourceRequest`; it has no field for a caller-supplied source receipt,
source STEP, flat STEP, DXF, runtime, verifier, or artifact hash. The server
reruns that source request through the native mechanical exact loop and proceeds
only from its generated exact receipt and STEP hash.

The flat-pattern executor derives developed length, width, and the single bend
line, builds an actual Node OCCT rectangular planar face, inspects it, exports
and re-imports STEP, and independently reparses its generated millimetre DXF.
The DXF contains exactly four `OUTLINE` lines and one `BEND_UP` line. The
`nexyfab.precision-cad.bounded-sheet-metal-flat-pattern-receipt.v1` binds the
source feature and revision, regenerated source receipt and STEP hashes,
developed dimensions and bend line, flat STEP hash, DXF hash, and receipt hash.
Millimetre units, layer identifiers, coordinates, hashes, and status codes are
stable machine values; localization is display-only and cannot alter them.
Multi-bend development, K-factor, material behavior, springback, tooling,
relief, nesting, and shop-floor forming or cutting claims remain blocked.

A sixteenth slice graduates `cad.mechanical.sketch` only as bounded planar-face
geometry through `occt.sketch.convex-line-loop-planar-face`. The handler consumes
one verified `CanonicalSketchPreflightPass` directly, requires the trusted
runtime and registry execution gate, and accepts only one strict-convex closed
line loop on an XY, XZ, or YZ principal plane. It constructs an actual Node OCCT
planar face and checks analytic area and perimeter, selected plane, exact
boundary-edge count, planar single-face topology, no non-manifold edge, and STEP
export/re-import parity.

This registry graduation is geometry exact only. It does not consume or qualify
constraints, dimensions, expressions, fully constrained status, native solver
authority, curves, nested loops, or general sketch semantics; those forms remain
`HOLD` and cannot inherit the bounded handler's EXACT label.

A seventeenth slice graduates bounded `cad.mechanical.delete-face` through
`occt.delete-face.blind-hole-cap`. The input is one axis-aligned rectangular
prism containing one strict-interior blind cylindrical hole and the exact
three-face set `[f.hole.wall, f.hole.floor, f.cap.top.perforated]`. Native
execution removes that wall, floor, and perforated top face from the supplied
B-Rep, retains the five untouched host faces, and reuses the deleted top face's
outer wire to construct a topology-preserving full cap. It then assembles the
faces into a closed shell and solidifies it; regenerating and substituting an
unrelated host is not accepted as delete-face evidence.

Detailed inspection and STEP re-import must prove one valid closed manifold
solid, six planar faces, no remaining cylindrical face, zero boundary and
non-manifold edges, restored host volume and bounding box, and the expected
12-edge rectangular-prism topology. General arbitrary-face deletion, surface
extension, feature suppression or rebuild, and multiple holes remain `HOLD`.
The fixed face-set identifiers are stable machine tokens and are never
localized or inferred from translated labels.

The twenty-ninth bounded graduation is the versioned
`cad.mechanical.sweep-path` entry with handler
`occt.sweep-path.orthogonal-polyline-rect.v1`. It requires exactly three path
points forming two positive orthogonal non-collinear segments, one constant
rectangular section, `profileFrame: normal_to_first_segment`, and
`transition: right_corner`. The native start-normal frame and right-corner pipe
execution must produce one closed exact solid and survive detailed B-Rep and
STEP replay checks. This narrow version does not graduate the broad
`tree:sweep_path` FeatureTree alias, which remains `UNSUPPORTED`; arbitrary
frames, curved or multi-segment paths, variable sections, and alternate
transitions remain `HOLD`. Frame and transition identifiers are stable machine
tokens and are not localized.

The thirtieth bounded graduation is `cad.mechanical.weldment` through
`occt.weldment.two-member-corner-cut-list`. It builds exactly two bounded
rectangular members in the fixed square-corner arrangement and preserves them
as an unfused native compound with two solids, rather than converting their
contact into a boolean union. Detailed inspection and STEP re-import must
preserve two valid closed solids, one compound, analytic member volume/surface
area and bounding box, and zero boundary or non-manifold edges. The server also
generates a two-member millimetre cut list and binds the revision, request,
runtime identity, registry, result/round-trip inspections, STEP, cut list, and
receipt hashes.

The weldment contract explicitly records weld bead geometry as `NOT_MODELLED`,
process specification as `NOT_AUTHORIZED`, member material specification as
`UNSPECIFIED`, weld process authority as `NOT_CLAIMED`, and XCAF occurrence
verification as `NOT_RUN`. Those machine values cannot be translated into a
claim of weld geometry, procedure, material authorization, or occurrence
identity. Arbitrary frames or joints, more than two members, weld beads, process
or material approval, and fabrication release remain `HOLD`.

The enumerated mechanical candidate surface is therefore 30/30 bounded exact
internally. This number means only that each of the 30 candidate identifiers has
one explicit, versioned, fail-closed exact slice. It does not mean general
feature semantics, arbitrary parameterizations, multi-body/XCAF completeness,
manufacturing validation, standards conformance, or commercial readiness are
complete. Native mechanical exact and weldment receipts continue to record
`authoritativeCommit: false` and `commercialReleaseReady: false`; the other
internal artifacts confer no commit authority and remain release-blocked.
Overall product and commercial release remain `HOLD`.

## Receipt boundary

`nexyfab.precision-cad.native-mechanical-exact-receipt.v1` binds the exact
request, feature, base revision, registry snapshot, trusted runtime identity,
result and round-trip measurements, and STEP artifact. A verifier must recompute
the receipt and artifact hashes from a descriptor-safe bounded snapshot and
reject extra, missing, accessor-backed, cyclic, oversized, or altered values.

The receipt deliberately records:

- `authoritativeCommit: false`;
- `commercialReleaseReady: false`;
- no next revision ID or sequence.

Those values prevent an exact geometry run from impersonating the later
canonical commit, drawing/BOM package, independent review, or product release
gate.

The local canonical precommit gate reports `EVIDENCE_BOUND` with
`verification: STRUCTURAL_ONLY`, never `READY_FOR_COMMIT`. It persists no data
and cannot prove that a claimed base revision is the authority's current head
or that submitted evidence originated from the trusted execution service. An
authority-owned head lookup, canonical-base replay, independent STEP inspection,
transactional commit, and durable receipt lookup are still required.

## Current-head base-plus-hole product vertical

The first bounded product vertical now removes the caller-asserted revision
from its read path. The server adapter loads `readCanonicalCadRevisionHead`,
requires one rights-bound
`nexyfab.precision-cad.mechanical-single-part-feature-tree.v1` object, and
accepts exactly two active nodes: one additive one-sided base extrude and one
directly dependent drilled hole. Object kind, tree hash, rights receipt hash and
rights receipt revision are part of the structural binding. Extra mechanical
objects, features, dependencies, payload keys, hidden keys, accessors, symbols,
cycles, stale triplets, and rights mismatches terminate in `HOLD`.

`nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1` then
replays that tree with the verified Node OCCT runtime and binds the following to
the same server-loaded project/document/revision triplet:

- inspected single-solid B-Rep and STEP export/re-import evidence;
- front, top, and right exact HLR drawing views;
- overall bounding-box dimension receipt;
- one-part BOM receipt;
- runtime, registry, feature-tree, rights, and artifact hashes.

The bundle and its manifest have a fail-closed tamper validator. Its
`EXACT_BUNDLE_PASS` describes the internal geometry/artifact bundle only. The
bundle remains `release: HOLD` and `manufacturingRelease: BLOCKED`; it neither
commits a new canonical revision nor supplies GD&T/PMI, material, process,
independent review, or human release evidence.

An authenticated, project-scoped, rate-limited, private/no-store Node route at
`/api/cad/v2/projects/{projectId}/documents/{documentId}/artifacts/mechanical-exact`
exposes this read/compute bundle. It performs project access checks before OCCT
work and does not disclose database or native exception details in HOLD
responses. The route is an agentic consumption boundary, not a mutation,
canonical commit, or release endpoint.

## Versioned FeatureTree v2 exact vertical

The next current-head sequence is implemented as a separate version rather than
changing the v1 base-plus-hole contract. The server loads the current canonical
head and accepts exactly one
`nexyfab.precision-cad.mechanical-single-part-feature-tree.v2` object with three
active nodes in this order:

1. one additive, one-sided strict-convex base extrude;
2. one directly dependent fillet or chamfer with explicit stable `edgeRefs`;
3. one directly dependent, strictly interior drilled hole.

The structural extractor requires exact node and payload keys, safe identities,
the dependency and `childId` chain, the embedded `childExtrude` snapshot to be
identical to the live base payload, bounded treatment size, valid stable edge
names, hole clearance, the sealed feature-tree hash, the current revision
triplet, and the rights receipt binding. It rejects fallback-only edge selection,
unknown topology names, stale copied child geometry, altered dependencies, and
v1/v2 schema substitution.

The verified tree then runs through the existing server exact handoff using the
internally loaded Node OCCT runtime. It executes the base, stable-edge
fillet/chamfer, and drilled-hole chain as real B-Rep operations, inspects the
result, exports and re-imports STEP, and produces front/top/right exact HLR,
overall dimensions, and a one-part BOM. The resulting
`nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v2` binds the
feature-tree schema and hash, treatment kind, stable-edge-reference hash, rights
receipt, current revision, STEP, drawing, dimensions, BOM, runtime identity, and
registry hashes into one manifest. Its success state is
`EXACT_BUNDLE_V2_PASS`, while `release` remains `HOLD` and
`manufacturingRelease` remains `BLOCKED`.

The authenticated, project-scoped, read/compute-only routes are:

- `/api/cad/v2/projects/{projectId}/documents/{documentId}/artifacts/mechanical-exact/feature-tree-v2`;
- `/api/cad/v2/projects/{projectId}/documents/{documentId}/artifacts/mechanical-exact/feature-tree-v2/xcaf`.

An HTTP caller supplies only the path project/document identity and normal
authentication context. It cannot supply a revision, feature tree, exact
receipt, bundle, STEP artifact, worker URL, worker credential, or XCAF result.
The v1 schemas and routes remain unchanged for version isolation; v2 is not an
in-place migration or evidence that v1 data has been upgraded.

The generic exact handoff still treats the live `childId` chain as authoritative
and can reach a native result when an independently supplied tree contains a
stale embedded `childExtrude` snapshot. That behavior is recorded as a boundary,
not parity evidence. The current-head v2 path closes it before the generic
handoff by requiring the copied child snapshot to hash-identically match the
live base payload. Therefore only a tree that passed the v2 current-head
extractor is eligible for this v2 bundle; the generic handoff alone is not a v2
authority or release gate.

## Current-head XCAF occurrence vertical

The current-head STEP can now be inspected through a separate server-only XCAF
path. The orchestration accepts only a database adapter, project ID, document
ID, and an internally configured inspector. It rebuilds and revalidates the
current canonical mechanical bundle, hashes the server-generated STEP bytes,
passes those exact bytes and hash to the worker, and then binds one root product
occurrence to the same canonical revision, rights receipt, bundle manifest,
STEP, native executable, and native invocation hashes. Caller-provided bundles,
STEP files, inspections, revisions, worker URLs, and credentials are not input
fields.

The server HTTP client reads `OCCT_XCAF_SERVICE_URL` and
`OCCT_XCAF_SERVICE_TOKEN` only from the server environment, enforces byte and
time limits, disables redirects and caching, and validates the complete native
receipt. The worker keeps liveness public but requires the bearer token for
capabilities and inspection; production startup fails if that token is absent
or malformed. The authenticated, project-scoped, rate-limited application route
is:

`/api/cad/v2/projects/{projectId}/documents/{documentId}/artifacts/mechanical-exact/xcaf`

Its `PASS_NATIVE_INVOCATION_BOUND` is occurrence-identity evidence only.
`geometryIdentity` remains `NOT_EXPOSED_BY_BINDING`, dynamic OCCT linkage is not
yet included in the receipt, and release remains `HOLD`. Contract/mock tests
prove protocol behavior only and are never production native evidence.

The FeatureTree v2 route uses a version-isolated XCAF orchestration entry point
while retaining the occurrence-envelope schema
`nexyfab.precision-cad.current-head-xcaf-occurrence-envelope.v1`. Before worker
inspection it rebuilds and validates the v2 bundle, verifies the generated STEP
bytes against the v2 STEP hash, and requires the XCAF binding to carry the same
revision, rights receipt, STEP hash, and v2 bundle manifest hash. The XCAF
builder additionally rechecks the three-node tree, treatment kind, and stable
edge-reference hash from the v2 bundle. This is same-revision occurrence
binding, not geometry identity, PMI, assembly qualification, or release
evidence.

## Execution-policy boundary

Interactive modeling may retain a clearly labelled mesh preview when native
execution is unavailable. Authoritative exact execution is a distinct policy:
native failure, a missing OCCT handle, preview downgrade, or unsupported command
must terminate with `HOLD`. A caller cannot infer exactness merely because the
interactive pipeline produced visible triangles.

The Shape Generator policy reports only `NATIVE_BREP_PASS`: a live local shape
registry handle and async native feature chain were present. It is an
anti-downgrade precondition, not a trusted-runtime, STEP, canonical revision,
qualification, or commercial `PASS`; only the server closed-loop receipt can
provide the additional internal exact evidence.

## Integration adoption decision

GP-10 is ready for integration only as the bounded behavior defined in this
ADR. Integration may adopt the existing read/compute consumers, registry
entries, native handlers, hostile validators, and internal receipts. It must not
expand the contracts, infer unsupported aliases, create authoritative commit
semantics, or turn local evidence into a release claim while merging them.

The source worktree is not yet a merge unit. Its current base HEAD is
`04d39ea9227b382ec40508b6d6f601a0115fe103`, while the implementation remains
uncommitted. In addition, the required Scope check currently detects
platform-owned changes to `adminlink/index.php`,
`docs/evidence/cad-independent/mechanical-core-internal-verification.json`,
`public/search.php`, and `public/send-mail.php`. Those paths are not GP-10
ownership. They must be separated or explicitly resolved by integration before
a Precision source commit is accepted.

Integration shall use this order:

1. freeze the intended Precision-owned tree as one reviewed Scope commit and
   generate a current immutable handoff receipt;
2. make `workspace:check -- precision-cad` and
   `workspace:handoff:check -- precision-cad` pass on that commit;
3. inspect the Scope receipt with `workspace:integration-status`, then merge the
   Scope once into `integration/nexyfab` using `--no-ff`;
4. preserve the separate v1 and v2 current-head routes, schema identifiers,
   rights bindings, registry/runtime policy, machine tokens, and all explicit
   negative states without silent fallback;
5. run focused GP-10 hostile/native tests and the repository audit,
   architecture, type, build, security, database, and contract gates at the
   merged HEAD;
6. run final CI/E2E only after all scheduled integration changes are present,
   followed by the integration/main-only OCCT burn-in, large-assembly, and
   milestone gates.

The integration acceptance invariant is that malformed, stale, ambiguous,
cross-tenant, tampered, unsupported, downgraded, or caller-authorized input can
never produce a stronger result after the merge than it did on the Scope
branch. AI Design remains an intent/provenance producer. It cannot provide a
revision triplet, exact receipt, B-Rep/STEP artifact, registry/runtime identity,
XCAF result, commit decision, or release decision.

The authority-owned durable CAS commit, stable topology survival, expanded XCAF
provenance, and GD&T/PMI work listed below are GP-12 follow-on semantics. They
must be separately versioned and reviewed after GP-10 integration rather than
being folded into this merge.

## Next vertical slices

1. Add the authority-owned transactional commit and durable artifact lookup;
   the implemented current-head bundle is read-only and cannot replace CAS.
2. Extend the narrowly graduated geometry-only sketch through a separate
   constraint/dimension-qualified version without broadening the meaning of
   `occt.sketch.convex-line-loop-planar-face`. The current registry entry does
   not consume the numeric solver receipt. A later version must add a versioned
   dimension/expression grammar, explicit degrees of freedom and
   under/over/inconsistent status, independent solver parity, native solver
   authority, edit regeneration, and durable authority before a fully
   constrained exact claim can be considered.
3. Make copied-child parity a mandatory generic handoff contract, or remove the
   redundant snapshot field from a future schema. Until then the generic
   handoff remains a lower-level executor and only the current-head v2 extractor
   closes that stale-snapshot boundary.
4. Extend the implemented single-root XCAF identity binding with immutable image
   and dynamic-library provenance, GD&T/PMI, stale invalidation, save/reopen,
   edit/regenerate, undo, and idempotent replay on the same committed revision.
5. Expand the corpus across tolerance, degeneracy, topology-reference,
   performance, recovery, localization, and external interchange axes before
   any commercial claim.

## Clean-room and rights rule

This work uses only general geometric concepts, public mathematical principles,
and interfaces already implemented in this repository. External manuals and the
local CAD encyclopedia may identify concepts or validation questions, but their
wording, diagrams, tables, parameter taxonomies, UI arrangement, algorithms,
source, examples, and fixtures are not copied. Every contract, bound, identifier,
test model, message, and acceptance rule is independently written and traceable
to repository behavior. Unclear license or provenance remains a blocker and the
source is not incorporated.

## Remaining release HOLD

This internal loop does not provide independent STEP conformance, topology
survival across third-party CAD systems, standards-certified drawings/PMI,
material or manufacturing validation, external accuracy review, tenant and
authorization evidence, localization review, support/SLA evidence, or a
manufactured pilot. Product qualification and commercial release remain `HOLD`
until those current, independently reviewed receipts bind to the same canonical
revision.
