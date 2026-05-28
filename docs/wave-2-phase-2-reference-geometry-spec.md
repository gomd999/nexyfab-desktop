# Wave 2 Phase 2 — Reference Geometry (Plane / Axis / Point / CSys)

**Status:** spec / design-only — NO implementation in this doc
**Date:** 2026-05-28
**Author:** wave-2 architecture
**Risk tier:** P1
**Related:** ADR-010 (Wave 2 B-Full + collab), `docs/wave-2-crdt-architecture.md`,
`docs/wave-2-phase-1-plan.md`, `src/app/[lang]/shape-generator/features/referenceGeometry.ts`

## Purpose

Wave 2 Phase 1 brings collaboration + CRDT-first state. Phase 2 raises the
modeling fidelity to commercial-CAD parity by introducing **reference
geometry** — plane / axis / point / coordinate-system entities that sketches,
features, and assembly mates anchor onto.

Today the sketch system only supports three world-aligned planes (`xy` / `xz`
/ `yz`) plus a one-off "sketch on tilted face" frame stored on the active
sketch node. This is insufficient for offset / angled / through-3-points
plane creation that Onshape, Fusion 360, and SolidWorks ship as table stakes.

A reference-geometry math module already exists at
`src/app/[lang]/shape-generator/features/referenceGeometry.ts` (planes /
axes / CSys / points + Front/Top/Right standards). Phase 2 promotes that
module from "math helpers" to **first-class feature-tree entities** with
identity, dependency tracking, persistence, visualization, and sketch /
assembly consumption.

This is **design only**. No source files are modified by this spec.

---

## 1. Current State (Code Survey)

### 1.1 Existing math — `features/referenceGeometry.ts`

Implements pure-function constructors that return normalized shapes
(`{ origin, normal }` / `{ origin, direction }` / `{ origin, xAxis, yAxis,
zAxis }` / `{ position }`). All in mm, all hand-rolled vec3 (no THREE
dependency in the math file).

| Kind | Helpers shipped |
|------|-----------------|
| `ReferencePlane` | `planeFromThreePoints`, `planeOffset`, `planeParallelThroughPoint`, `planeMidBetween`, `planeNormalToCurve`, `planeLineAndPoint` |
| `ReferenceAxis` | `axisFromTwoPoints`, `axisFromTwoPlanes`, `axisFromPointDirection`, `axisFromEdge`, `axisFromCircularFace` |
| `ReferenceCsys` | `csysFromOriginAndAxes`, `csysOnPlane`, plus `WORLD_CSYS` |
| `ReferencePoint` | `pointMid`, `pointCentroid`, `pointThreePlaneIntersect`, `pointProjectToPlane`, `pointLinePlaneIntersect` |
| Standards | `FRONT_PLANE`, `TOP_PLANE`, `RIGHT_PLANE`, `STANDARD_PLANES` |

**Gap:** the module exposes constructors but no identity, no persistence,
no dependency graph, no UI, no link to the feature tree, no sketch /
assembly consumer. It is currently unreferenced outside its own file.

### 1.2 Sketch system — how planes are consumed today

Three call sites understand "which plane":

1. **`store/sceneStore.ts`** — top-level state field
   `sketchPlane: 'xy' | 'xz' | 'yz'` + `setSketchPlane`. Persisted with
   the rest of `useSceneStore` via zustand `persist`.
2. **`store/sceneStore.ts`** — escape hatch `sketchFaceFrame: null | {
   origin, normal, uAxis, vAxis }` for the Phase-2 "sketch on tilted
   face" path. Comment in code:
   `// axis-aligned faces still use the fast-path (sketchPlane +
   sketchPlaneOffset); arbitrary tilted faces set this`.
3. **`useFeatureStack.ts`** — `SketchNodeData { profile, config, plane:
   'xy' | 'xz' | 'yz', planeOffset: number, operation, ..., faceFrame? }`.
   This is what travels with each sketch feature node and is what gets
   persisted in `.nfab` documents.

The literal-union `'xy' | 'xz' | 'yz'` is duplicated at least at these
sites:

- `store/sceneStore.ts` — state, setter, default
- `useFeatureStack.ts` — `SketchNodeData.plane`
- `sketch/SketchPanel.tsx:394` — `onSketchPlaneChange` callback
- `sketch/Sketch3DCanvas.tsx` — `PlaneType` type alias + `VIEW_PRESETS`
  + `to2D` / `to3D` / `SketchPlaneHelper` / `GridTickLabels` / crosshair
  raycaster all switch on the literal

Phase 2 will replace the literal union at every site with a `PlaneRef`
discriminated union, *with* a backwards-compatible adapter so existing
`.nfab` files keep loading.

### 1.3 Feature tree integration today

`HistoryNodeType` (`useFeatureStack.ts:32`) is:

```ts
'baseShape' | 'sketch' | 'feature' | 'extrudeCut' | 'import' | 'sheetMetal'
```

Reference geometry is **not** a node type. There is no way for a user to
say "give me an offset plane and persist it" — the only way to get a
non-standard plane is the implicit `sketchFaceFrame`, which is tied to a
sketch and dies with it.

### 1.4 Assembly mate today

`assembly/AssemblyMates.ts` (`MateType`):

```ts
'coincident' | 'concentric' | 'distance' | 'angle' | 'parallel'
| 'perpendicular' | 'tangent' | 'hinge' | 'slider' | 'gear'
```

Each mate references body/face geometry. There is currently no mate that
takes a `ReferenceAxis` or `ReferencePlane`. Robust mates against
reference geometry (which survives topology renumbering) are a Phase 3
prerequisite tracked here as integration-prep only.

---

## 2. Plane Creation Methods

Target parity with Onshape "Plane" + Fusion 360 "Construct → Plane".
Shipping eight methods in Phase 2; the remainder (e.g. tangent surface,
along-curve) come in Wave 3 when curved-surface support lands.

| # | Method id | Korean | Inputs | Output |
|---|-----------|--------|--------|--------|
| 1 | `standard` | 표준 평면 | one of `'front'` / `'top'` / `'right'` | preset plane at world origin |
| 2 | `offset` | 오프셋 평면 | parent: `PlaneRef`, distance: mm, direction: `+1`/`-1` | parent translated along its normal |
| 3 | `angle` | 각도 평면 | parent: `PlaneRef`, edge/axis: `AxisRef`, angle: deg | parent rotated about axis |
| 4 | `through3Points` | 세 점 평면 | 3 × `PointRef` | plane through points (CCW normal) |
| 5 | `parallelThroughPoint` | 평행 평면 (점) | parent: `PlaneRef`, point: `PointRef` | parent normal, translated to point |
| 6 | `midPlane` | 중간 평면 | a: `PlaneRef`, b: `PlaneRef` (must be parallel) | midpoint between a and b |
| 7 | `throughLineAndPoint` | 선과 점 평면 | line: `AxisRef`, point: `PointRef` | plane containing both |
| 8 | `tangentToCylinder` | 원통 접면 | face: `FaceRef` (cylindrical), refPlane: `PlaneRef` | plane tangent to cylinder at intersection with ref direction |

**Deferred (Wave 3):**

- `tangentToSurfaceAtPoint` — needs full curved-surface evaluator
- `normalToCurve` — math exists, UI deferred until sweep-path picker lands
- `perpendicularThroughLine` — needs face-side hint to disambiguate

Each method maps to one of the constructors already in
`referenceGeometry.ts`; the new layer is **identity + dependencies +
persistence**, not new math, except for `angle` and `tangentToCylinder`
which need a small addition (see §11).

---

## 3. Axis Creation Methods

| # | Method id | Korean | Inputs | Output |
|---|-----------|--------|--------|--------|
| 1 | `standard` | 표준 축 | one of `'x'` / `'y'` / `'z'` | world axis at origin |
| 2 | `through2Points` | 두 점 축 | 2 × `PointRef` | line through both |
| 3 | `alongEdge` | 모서리 축 | edge: `EdgeRef` (straight only) | edge's underlying line |
| 4 | `twoPlaneIntersect` | 평면 교차 축 | a: `PlaneRef`, b: `PlaneRef` | line where planes meet |
| 5 | `normalToPlaneAtPoint` | 평면 법선 축 | plane: `PlaneRef`, point: `PointRef` | plane's normal through point |
| 6 | `cylinderConeAxis` | 회전축 | face: `FaceRef` (cylinder / cone / torus) | face's symmetry axis |

For Phase 2 ship methods 1–5; method 6 requires the worker to expose
face-type metadata and a center/axis probe — that probe exists for
`axisFromCircularFace` but the cylinder-detection side ships with
worker face-classification API in Phase 2.5.

---

## 4. Point Creation Methods

Phase 2 ships only enough to feed plane/axis constructors. Point-creation
UI is intentionally minimal — most users will pick existing
vertex/edge/face entities directly.

| # | Method id | Korean | Inputs |
|---|-----------|--------|--------|
| 1 | `vertex` | 꼭짓점 | `VertexRef` (selection passthrough — no creation, just a name) |
| 2 | `midOfEdge` | 모서리 중점 | `EdgeRef` |
| 3 | `centerOfFace` | 면 중심 | `FaceRef` (planar / circular only) |
| 4 | `intersectLineAndPlane` | 선·평면 교점 | `AxisRef`, `PlaneRef` |
| 5 | `intersectThreePlanes` | 세 평면 교점 | 3 × `PlaneRef` |
| 6 | `projectPointOntoPlane` | 점을 평면에 투영 | `PointRef`, `PlaneRef` |
| 7 | `byCoordinates` | 좌표 점 | x, y, z (mm) — usually relative to a CSys |

---

## 5. Coordinate System Creation Methods

| # | Method id | Korean | Inputs |
|---|-----------|--------|--------|
| 1 | `world` | 월드 좌표계 | (none — singleton) |
| 2 | `originAndTwoAxes` | 원점 + 두 축 | origin: `PointRef`, xDir: `AxisRef`, yDir: `AxisRef` |
| 3 | `originAndPlane` | 원점 + 평면 | origin: `PointRef`, plane: `PlaneRef`, inPlaneRef: `AxisRef` |
| 4 | `byFaceVertex` | 면 + 꼭짓점 | face: `FaceRef`, vertex: `VertexRef` (origin), edge: `EdgeRef` (x) |

A model has exactly one `WORLD_CSYS` (immutable) + N user CSys. Drawings,
assembly mates, and CNC export use them; multiple are common per part
("origin at lower-left corner", "origin at pocket center").

---

## 6. Data Model

### 6.1 New top-level discriminated union

```ts
// src/app/[lang]/shape-generator/features/referenceGeometryNodes.ts (new)

export type ReferenceKind = 'plane' | 'axis' | 'point' | 'csys';

export interface ReferenceNodeBase {
  id: string;            // stable, used for cross-references and CRDT
  kind: ReferenceKind;
  method: string;        // discriminant within the kind (see §2–§5)
  label: string;         // user-visible name; auto-generated, editable
  hidden: boolean;       // show in tree but hide in 3D viewport
  dependsOn: string[];   // ids of upstream entities (other refs, sketches, ...)
  evaluatedAt: number;   // monotonic version stamp from the dep solver
  error?: string;        // populated when re-eval failed (e.g. parents missing)
  params: Record<string, unknown>; // method-specific, validated by Zod schema
}

export interface ReferencePlaneNode extends ReferenceNodeBase { kind: 'plane'; }
export interface ReferenceAxisNode  extends ReferenceNodeBase { kind: 'axis'; }
export interface ReferencePointNode extends ReferenceNodeBase { kind: 'point'; }
export interface ReferenceCsysNode  extends ReferenceNodeBase { kind: 'csys'; }

export type ReferenceNode =
  | ReferencePlaneNode | ReferenceAxisNode
  | ReferencePointNode | ReferenceCsysNode;
```

### 6.2 Method-specific params (excerpt)

```ts
// Plane methods
interface PlaneParams_Offset {
  parent: PlaneRef;
  distanceMm: number;
  direction: 1 | -1;
}
interface PlaneParams_Angle {
  parent: PlaneRef;
  axis: AxisRef;
  angleDeg: number;
  flip?: boolean;
}
interface PlaneParams_Through3Points {
  points: [PointRef, PointRef, PointRef];
}
interface PlaneParams_ParallelThroughPoint {
  parent: PlaneRef;
  point: PointRef;
}
interface PlaneParams_MidBetween {
  a: PlaneRef;
  b: PlaneRef;
}
// ...

// Axis methods
interface AxisParams_Through2Points  { points: [PointRef, PointRef]; }
interface AxisParams_AlongEdge       { edge: EdgeRef; }
interface AxisParams_TwoPlaneIntersect { a: PlaneRef; b: PlaneRef; }
interface AxisParams_NormalToPlane   { plane: PlaneRef; point: PointRef; }
```

### 6.3 PlaneRef discriminated union (sketch consumption)

Replace the legacy `'xy' | 'xz' | 'yz'` literal at every site with:

```ts
export type StandardPlaneId = 'front' | 'top' | 'right' | 'xy' | 'xz' | 'yz';
// 'xy'/'xz'/'yz' are accepted aliases for back-compat read; new docs
// always serialize as 'front'/'top'/'right'.

export type PlaneRef =
  | { kind: 'standard'; id: StandardPlaneId }
  | { kind: 'reference'; nodeId: string }      // -> ReferenceNode in tree
  | { kind: 'face'; bodyId: string; faceId: string }  // sketch-on-face (existing)
  | { kind: 'inline'; origin: Vec3; uAxis: Vec3; vAxis: Vec3; normal: Vec3 };
  // 'inline' is the legacy `sketchFaceFrame` form, kept only for
  // .nfab v1/v2 backward compat. New code writes 'reference' or 'face'.
```

Same pattern for `AxisRef`, `PointRef`, `CsysRef` (each has its own
`standard` / `reference` / `geometric` / `inline` variants).

### 6.4 .nfab persistence (schema bump)

Current `.nfab` is v2 (per `io/nfabFormat.ts`). Phase 2 introduces **v3**:

- Add top-level `references: ReferenceNode[]` (ordered by dependency,
  topologically sorted on write).
- Migrate v2 `SketchNodeData.plane` (`'xy' | 'xz' | 'yz'`) +
  `planeOffset` → `PlaneRef` of kind `standard` (when `offset === 0`) or
  a synthesized `reference` plane node of method `offset` with
  `parent = { kind: 'standard', id: 'front' }`.
- Migrate v2 `SketchNodeData.faceFrame` → `PlaneRef` kind `inline`
  (round-trip OK; on next save it can be upgraded to `face` if the
  underlying face is still resolvable).
- Add `nfabVersion: 3` to the document root.

Loader supports v1 → v2 → v3 migration chain in `io/nfabFormat.ts`.

---

## 7. Dependency Tracking (the load-bearing piece)

**Why this is the highest-risk subsystem:** a reference plane built on
"the front face of cube A" must survive cube A's edits — and not survive
cube A's deletion silently. CAD-grade dependency tracking is what
separates a toy from a tool.

### 7.1 Topology

```
ReferenceNode.dependsOn[]  -> ReferenceNode.id | HistoryNode.id
HistoryNode.dependsOn[]    -> already exists, extended to also accept
                              ReferenceNode.id
```

The two id spaces are disjoint (UUIDs). Resolution function checks both
maps.

### 7.2 Cycle prevention

Add a function `wouldCreateCycle(newDeps: string[], targetId: string):
boolean` that runs DFS on the combined graph **before** the node is
inserted. UI uses this to disable invalid picks in the input dialog (e.g.
plane A depends on plane B → B cannot depend on A).

### 7.3 Re-evaluation strategy

**Lazy with version stamps**, not push-based.

- Each `ReferenceNode` carries `evaluatedAt: number`.
- The solver has `currentVersion: number` bumped on any upstream mutation.
- When the renderer needs a reference's geometry, it looks up the cache
  for `(id, currentVersion)`. Miss → re-run the constructor with resolved
  parent values → cache → set `evaluatedAt = currentVersion`.
- Topological order is computed once on graph-change (which is rare)
  and cached.

**Why lazy:** most reference nodes are not visible (hidden flag on);
re-evaluating all of them on every keystroke wastes work. Sketch /
extrude / mate consumers force eval at read time, which gives the same
end-user feel as push.

### 7.4 Failure modes & error propagation

- **Missing parent** (`PlaneRef.nodeId` refers to deleted node) → node
  enters `error: 'parent_missing'`, downstream sketches show a red
  badge but the feature tree stays editable.
- **Degenerate inputs** (3 collinear points, parallel planes for axis,
  etc.) → existing math returns `null`; node enters `error:
  'degenerate'`.
- **Cycle introduced** by external edit (e.g. CRDT merge across two
  peers) → break the youngest edge, mark both nodes `error: 'cycle'`,
  log to `data/ops-alerts/`.

### 7.5 CRDT considerations (Phase 1 alignment)

`ReferenceNode[]` lives in the same Yjs document as `HistoryNode[]`. The
storage shape mirrors what `wave-2-crdt-architecture.md` proposes for
feature tree:

- `Y.Map<id, Y.Map>` (id → node fields) — additions / deletions
  commute.
- Method-specific `params` are JSON-blob inside a Y.Map slot (no
  intra-param CRDT — we don't expect concurrent typing inside a
  reference dialog).
- `dependsOn[]` is a Y.Array; insertion order doesn't matter for
  correctness, the dep solver is set-based.

---

## 8. Visualization (Three.js)

All reference geometry renders in a dedicated layer
(`Three.Layers.set(REFERENCE_LAYER = 4)`) so the rest of the scene can be
exported / screenshot without scaffolding.

### 8.1 Plane

- Semi-transparent quad, default 60 × 60 mm (auto-grow to encompass any
  feature that anchors on it).
- Border: 1 px yellow (`#FFC107`), dashed when `hidden = true` but
  still hovered.
- Label: floating HTML tag at upper-right corner showing
  `label + method icon`.
- Hover highlight: border thickens to 2 px, fill alpha +0.15.
- Click-pick raises selection event consumed by the sketch / mate picker.

### 8.2 Axis

- Dashed line (`THREE.LineDashedMaterial`, `dashSize: 3, gapSize: 2`),
  default length 120 mm centered on origin.
- Arrowhead at +direction end (small cone, 4 mm).
- Color: yellow (`#FFC107`) by default, light-blue (`#4FC3F7`) when
  selected.

### 8.3 Point

- Small sphere, radius 1.5 mm screen-space (uses sprite to keep size
  constant across zoom).
- Color: red (`#F44336`).

### 8.4 Coordinate system (trihedron)

- Three arrows length 25 mm: X red, Y green, Z blue.
- Origin marker: 3 mm cube.
- Label: `csys.label` floating below origin.

### 8.5 Performance

Reference geometry visuals are batched into one InstancedMesh per kind so
a model with 100+ refs stays at 60fps. Worker is **not** involved (see
§9).

---

## 9. Worker API & Client/Worker Split

**Decision: reference geometry is client-side only.**

Rationale:

- All math is closed-form vec3 (already in `referenceGeometry.ts`).
- No B-Rep operations involved — no OCCT round trip needed.
- Worker round-trip latency (~5–30ms) would dominate, killing the
  "drag to set offset" interaction.

What gets sent to the worker:

- When a sketch consumes a `PlaneRef`, the resolved `{ origin, uAxis,
  vAxis, normal }` is included in the sketch op. The worker never sees
  the `nodeId`; only the materialized frame.
- When a feature consumes an `AxisRef` for revolve / pattern, the
  resolved `{ origin, direction }` is included.

This keeps the worker stateless w.r.t. reference geometry — clients
resolve refs, workers operate on geometric primitives.

Implication for replay: on `.nfab` open, the client first builds the
reference graph in topological order, then walks the feature tree
issuing worker ops with resolved frames embedded. Determinism is
preserved as long as resolved values for a given graph are stable
(they are — pure functions).

---

## 10. Sketch System Integration

### 10.1 API extension

`SketchNodeData.plane: 'xy' | 'xz' | 'yz'` → `SketchNodeData.plane:
PlaneRef`. Two read paths during migration window:

```ts
function resolveSketchPlane(data: SketchNodeData, refs: ReferenceMap): ResolvedFrame {
  if (typeof data.plane === 'string') {
    // v2 legacy — still on disk after migration if user hasn't touched
    return resolveStandardPlane(data.plane, data.planeOffset);
  }
  return resolvePlaneRef(data.plane, refs);
}
```

The 2D sketch canvas (`SketchCanvas.tsx`) is unchanged — it draws in a
local 2D `(u, v)` frame regardless of which world plane that frame
inhabits. Only the 3D canvas, the extrude pipeline, and the panel
plane-picker change.

### 10.2 Plane-picker UI rework

`SketchPanel.tsx` currently has 3 radio buttons (front/top/right). New
shape:

```
┌─ Sketch plane ──────────────────────────────┐
│ ⦿ Front  ○ Top  ○ Right                     │
│ ○ Pick face                                  │
│ ○ Reference plane:  [▼ Offset Plane 1     ] │
│   [+ New reference plane…]                  │
└──────────────────────────────────────────────┘
```

The `+` button opens the method picker dialog (§13). Newly-created
reference planes auto-select as the active sketch plane.

### 10.3 Extrude / revolve direction default

When a sketch is on a reference plane:

- **Extrude default direction:** plane normal × `+1`.
- **Revolve axis default:** if the user hasn't picked an axis explicitly,
  default to the first standard axis whose direction lies *in* the
  reference plane (typically `xAxis` of the plane's natural CSys).

### 10.4 What about `sketchFaceFrame`?

The escape-hatch field stays for one release (back-compat). New sketches
on a face write `PlaneRef.kind = 'face'` instead. A migration during
`.nfab` load promotes any `sketchFaceFrame` to `PlaneRef.kind = 'inline'`
+ best-effort attempt to re-resolve to `kind: 'face'` when the body /
face id still exists.

---

## 11. New Math Required

Most methods reuse existing constructors. Three need new helpers:

### 11.1 `planeAngleAboutAxis`

```ts
function planeAngleAboutAxis(
  parent: ReferencePlane,
  axis: ReferenceAxis,
  angleDeg: number,
  flip?: boolean,
): ReferencePlane | null;
```

Implementation: Rodrigues rotation of `parent.normal` about
`axis.direction`, keep `parent.origin` if axis lies in plane else
project origin onto axis.

### 11.2 `planeTangentToCylinder`

```ts
function planeTangentToCylinder(
  cylAxis: ReferenceAxis,
  cylRadius: number,
  refDir: Vec3,  // disambiguator: tangent point is where this ray hits the cylinder
): ReferencePlane | null;
```

Tangent point: closest point on cylinder surface along `refDir`. Plane
normal: radial direction at that point. Origin: tangent point.

### 11.3 `axisFromEdgeSelection`

Wrapper that takes an `EdgeRef` (worker edge id + body id), asks the
worker for the edge's two endpoints (if straight) or curve type, and
returns an `axisFromTwoPoints` result, or fails for non-straight edges.
The async resolve is cached per `(bodyId, edgeId)` and invalidated when
the body is re-evaluated.

All three additions land in `features/referenceGeometry.ts` next to the
existing helpers; no separate file.

---

## 12. Assembly Mate Integration (Phase 3 Prep)

Phase 2 does *not* extend `MateType`. It does ensure that the data model
for reference geometry is ready for Phase 3 mates:

- `AssemblyMate.entities[]` will accept entries of shape `{ kind:
  'reference'; nodeId: string }` in Phase 3.
- The resolver will treat a reference-plane mate the same as a face mate
  (uses `{ origin, normal }`) and an axis mate same as a cylinder-axis
  mate.
- "Robust mates" pitch: a face id can change when a feature edits the
  body, but a reference plane built on a vertex / edge / explicit
  offset survives unless its parent is deleted. So
  "ReferencePlane-to-ReferencePlane coincident" is the recommended
  default mate type once Phase 3 ships.

No code changes in Phase 2 — just identity stability and the dep graph
that Phase 3 will read.

---

## 13. UI Surface

### 13.1 Toolbar

A new dropdown lives in the modeling ribbon next to "Sketch":

```
[ Sketch ▾ ]  [ Reference geometry ▾ ]  [ Extrude ]  [ Revolve ] ...
                ├ 참조 평면 / Plane          (P)
                ├ 참조 축 / Axis            (X)
                ├ 참조 점 / Point           (.)
                └ 좌표계 / Coordinate Sys   (C)
```

Each entry opens the method picker dialog.

### 13.2 Method picker dialog

Single modal, two columns:

- **Left:** vertical list of methods (icons + name). Selecting one
  reveals the input form on the right.
- **Right:** per-method input form. Inputs are "pick from viewport"
  buttons that highlight the picker target type (vertex / edge / face /
  plane / axis) and accept clicks. Numeric inputs (offset, angle) inline
  with units.
- **Bottom:** live preview of the resulting plane / axis / point /
  CSys, rendered in the 3D viewport while the dialog is open.
- **OK / Cancel:** OK inserts the new `ReferenceNode` into the tree and
  closes the dialog. Cancel reverts the preview.

### 13.3 Feature tree integration

Reference geometry shows in the existing tree under a new "참조 형상 /
Reference geometry" group folder, separate from sketch/feature nodes.
Each row has the kind icon + label + delete + (hidden? eye icon).

### 13.4 Korean strings (canonical KR per project policy)

- 참조 형상 / Reference geometry
- 참조 평면 / Reference plane
- 참조 축 / Reference axis
- 참조 점 / Reference point
- 좌표계 / Coordinate system
- Methods:
  - 표준 / Standard
  - 오프셋 / Offset
  - 각도 / Angle
  - 세 점 / Through 3 points
  - 평행 / Parallel
  - 중간 / Mid plane
  - 선과 점 / Through line and point
  - 원통 접면 / Tangent to cylinder
  - 두 점 / Through 2 points
  - 모서리 / Along edge
  - 평면 교차 / Intersection of 2 planes
  - 평면 법선 / Normal to plane
  - 회전축 / Cylinder/cone axis

Full string table follows the i18n CSV pattern (`docs/i18n/reference-
geometry.csv`, 6-lang per project standard once Wave 3 i18n pass runs;
Phase 2 ships ko/en only and queues the rest behind the existing
admin-i18n backlog).

### 13.5 Korean drawing standard (KS A 0001 / KS B 0001 references)

The CSys label format for export to drawings follows KS B 0001:
`Origin: X = 0.0, Y = 0.0, Z = 0.0`. Direction arrows in drawings use
KS arrowhead style. These details only matter for Drawing module (Phase
4) but the underlying CSys data carries enough info already.

---

## 14. Test Fixtures

Each fixture is a `.nfab` v3 document committed under
`tests/fixtures/reference-geometry/`. Each has a Vitest unit test that
loads it, walks the dep graph, and asserts resolved frames within 1e-6
mm tolerance.

| Fixture | What it exercises |
|---------|-------------------|
| `01-offset-plane.nfab` | Cube + offset plane (30 mm from Front) + sketch on offset → second extrude |
| `02-three-points-plane.nfab` | Cube + 3 vertex picks → plane → sketch projects onto tilted plane |
| `03-axis-along-edge.nfab` | Cube + axis along top edge → circular pattern around that axis |
| `04-mid-plane.nfab` | Two parallel cubes + mid-plane between their facing faces |
| `05-csys-at-corner.nfab` | Cube + CSys at lower-front-left vertex (origin), X = bottom edge, Y = front edge |
| `06-hole-on-tilted-plane.nfab` | Cube + offset+angle plane + hole feature on that plane (Onshape-equivalent of "drill at 15° angle into the side") |
| `07-cycle-detection.nfab` | (Negative) plane A → axis B → plane C → tries to depend on A. Loader must reject with `error: 'cycle'` and recover. |
| `08-parent-deleted.nfab` | Plane B depends on plane A; A then deleted in the same doc. Loader keeps B but marks `error: 'parent_missing'`. |
| `09-legacy-xy-migration.nfab` | A v2 document with `plane: 'xy'` and `planeOffset: 25` — loader migrates to v3 reference plane. |
| `10-cylinder-axis.nfab` | Imported STEP with one cylindrical face → axis from cylinder → coaxial extrude. (Skipped in Phase 2 if STEP import isn't worker-ready; gated.) |

E2E (Playwright) covers two scenarios end-to-end:
- Create offset plane from UI, sketch on it, extrude → check rendered
  result matches reference image (±2 px).
- Create CSys at corner, switch active CSys, verify mass-props /
  drawing-origin both report relative coordinates.

---

## 15. Timeline (4 Weeks)

| Week | Scope | Acceptance |
|------|-------|------------|
| 1 | Data model + Plane (methods 1–5) + Axis (methods 1–3). New file `features/referenceGeometryNodes.ts`. Dep solver + cycle detection. Unit tests for math additions. | All Plane / Axis math has Vitest tests at green. No UI yet. |
| 2 | Point + CSys methods. UI shell: toolbar dropdown, method picker dialog (no preview yet), tree integration. `.nfab` v3 schema + v2 migration. | Can create offset plane via dialog, see it in tree, persist to disk, reopen. |
| 3 | Sketch integration: PlaneRef in `SketchNodeData`, plane-picker rework, live preview in method-picker dialog. Visualization (plane quad / dashed axis / sprite point / trihedron). | Sketch-on-offset-plane flow works end-to-end. Fixtures 01–05 pass. |
| 4 | Korean UI strings, KS drawing-export hooks, fixtures 06–10, Phase 3 assembly-mate API surface (no impl). Performance pass (100-ref stress). | All fixtures green. Playwright E2Es green. CHANGELOG + ADR-011 entry. |

**Hard dependencies:**

- Week 3 depends on Phase 1 CRDT scaffolding being stable enough that
  `Y.Map`-backed `ReferenceNode[]` doesn't crash on concurrent edits.
  Fallback: ship reference geometry in local-only mode if collab
  scaffolding slips; promote to CRDT in a follow-up.

**Soft dependencies:**

- Method 6 axis (cylinder/cone axis) needs worker face-classification
  API. If that slips, ship 1–5 and queue 6 for Phase 2.5.

---

## 16. Known Limitations (Out of Scope for Phase 2)

| # | Limitation | Resolution |
|---|------------|------------|
| 1 | Tangent plane to a free-form (B-spline) surface | Wave 3 — needs curved-surface evaluator |
| 2 | Reference geometry from imported assembly parts | Wave 3 — coupled with assembly Phase 3 |
| 3 | Helical axis / spline-following coordinate system | Wave 3 |
| 4 | Reference-geometry-aware **assembly mates** | Phase 3 (data model prepped, mate types not yet extended) |
| 5 | Reference geometry on sheet-metal flat patterns (carry through unfold) | Phase 4 — sheet metal pass |
| 6 | Driven dimensions referencing reference geometry (e.g. "this plane offset = 2 × cube width") | Phase 4 — global parametric layer |
| 7 | Reference geometry export to STEP AP242 (extended attributes) | Phase 4 — STEP writer pass |

---

## 17. Risk Register

| Risk | P | Mitigation |
|------|---|------------|
| Dep solver complexity → stale renders / "missing parent" loops | high | Lazy eval + version stamps (§7.3) + cycle detection (§7.2) + 2 dedicated fixtures (07, 08) |
| `.nfab` v2 → v3 migration corrupts existing user files | high | One-shot read-only migration writes to `.nfab.bak` first; Vitest fixture 09 covers all legacy shapes |
| PlaneRef union refactor touches sketch UI in 6+ files | med | `resolveSketchPlane` adapter (§10.1) lets sites migrate one at a time; literal `'xy'/'xz'/'yz'` stays valid as standard PlaneRef |
| Worker / client frame mismatch breaks determinism | med | Worker never sees `nodeId`, only resolved frames (§9). Add a worker-side assertion that frame is right-handed and unit. |
| Reference geometry visual clutter hurts perf | low | Layered InstancedMesh + auto-hide on zoom-out (§8.5) |
| Korean translations diverge from i18n CSV canonical | low | Strings checked into the same i18n CSV the rest of the app uses (per project policy); no inline literals |

---

## 18. ADR Hook

This spec drafts the implementation half of a forthcoming **ADR-011 —
Reference Geometry as First-Class Feature-Tree Entities**. The ADR will
record the three decisions called out in §1 (promote `referenceGeometry.ts`
to feature-tree node), §6.3 (PlaneRef discriminated union replaces literal
plane id), and §9 (client-side resolution; worker stays geometry-only).

---

## 19. Open Questions

1. **Persistent IDs for picked faces/edges** — we say `EdgeRef = { bodyId,
   edgeId }`, but OCCT edge ids change on re-evaluation. We need the
   topology-naming layer (see `topology/silhouetteExtractor.ts`) to
   expose stable names before Axis-along-edge and Plane-tangent-to-cyl
   can be production-quality. Tracking under Phase 2 Week 1 spike.
2. **Default plane orientation for `front/top/right`** — current
   `FRONT_PLANE` is normal +Z, `TOP_PLANE` is +Y. SolidWorks defines
   Front = +Y normal. Existing sketch canvas already assumes the current
   convention; not changing it, but documenting it under §17 as a
   "won't fix in Phase 2".
3. **Should `byCoordinates` point method express coords in active CSys
   or world?** Recommendation: active CSys, with a "convert to world"
   toggle. Final call goes to UX review at start of Week 2.

---

## 20. Acceptance Checklist

Phase 2 ships when all of the following are true:

- [ ] `ReferenceNode` model + dep solver merged with Vitest coverage ≥ 80%
- [ ] Plane methods 1–5, Axis methods 1–5, Point methods 1–7, CSys
      methods 1–4 all behind the toolbar dropdown
- [ ] Fixtures 01–09 green (10 deferrable if STEP not ready)
- [ ] `.nfab` v3 read+write, v2 migration round-trips with no diff
- [ ] Sketch panel plane-picker accepts reference planes; flow works
      end-to-end (E2E)
- [ ] Korean UI strings landed in i18n CSV (ko + en row complete)
- [ ] Visualization at 60fps with 100 references in the scene (perf bench)
- [ ] No worker API changes required (sanity check)
- [ ] ADR-011 published

---

*End of spec.*
