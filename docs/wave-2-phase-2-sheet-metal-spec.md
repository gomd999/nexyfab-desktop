# Wave 2 — Phase 2 Sheet Metal Spec

**Status:** design document, not implementation.
**Owner:** NexyFab CAD core (Wave 2 squad).
**Scope:** Sheet metal feature set for Wave 2 — OCCT-backed flange / bend / unfold,
with downstream impact on DFM, RFQ, and DXF flat-pattern export.
**Out of scope:** Wave 3 features (curved/rolled bends, multi-thickness composite
sheets, multi-body weldments). Listed in §9.

Why this matters: Korean laser-cut and press-brake shops are NexyFab's
beachhead. A precise unfold + flat pattern is the difference between
"upload your 3D model" and "drop a real RFQ on the partner pricebook" — and
no other tool in the local Korean market does it well in the browser. This
phase locks the contract before we start cutting code.

---

## 1. 현재 상태 점검 (current-state audit)

### 1.1 What exists today

A surprising amount. Wave 1 GA shipped a substantial sheet-metal layer
*at the Three.js mesh level*, written before the occt-worker existed. The
files below are real and mostly tested:

| Layer | Path | Lines (≈) | Notes |
|---|---|---|---|
| Core ops (Three.js mesh) | `src/app/[lang]/shape-generator/features/sheetMetal.ts` | 826 | bend / flange / hem / jog / flat pattern. Vertex-displacement based, **not OCCT-backed**. |
| Material + K tables | `src/app/[lang]/shape-generator/features/sheetMetalTables.ts` | ~400 | 7 materials (SPCC, STS304, AL5052, AL6061, SGCC, brass, copper). Interpolated K-curves. |
| Material database #2 | `src/app/[lang]/shape-generator/sheetmetal/kFactorTable.ts` | ~120 | **Duplicate.** Different material id format (`steel-cold-rolled` vs `mildSteel`). Needs consolidation. |
| Extended ops | `src/app/[lang]/shape-generator/features/sheetMetalExtended.ts` | ? | edge flange, miter flange, tab+slot, louver, lance, dimple — parametric specs only. |
| Springback | `src/app/[lang]/shape-generator/features/sheetMetalSpringback.ts` | ? | overbend angle compensation. |
| Flat-pattern math | `src/app/[lang]/shape-generator/features/sheetMetalFlatPattern.ts` | ~100 | BA / OSSB / BD chain development. Pure math, no geometry. |
| Higher-level sheetmetal/ folder | `src/app/[lang]/shape-generator/sheetmetal/*.ts` | 17 files | corner blend, coining, forming-limit-diagram, gusset, louver pattern + direction, lofted bend, hem standards, grain direction, punch library, bend deduction calculator. **All Three.js / pure math, no OCCT.** |
| Niche dev features | `src/app/[lang]/shape-generator/sheet-metal/*.ts` | 4 files | cone development, corner overlap relief, deep draw, jog bend developer. Note the *dash* spelling — a second namespace next to `sheetmetal/`. |
| Drawing bridge | `src/app/[lang]/shape-generator/analysis/flatPatternDrawing.ts` | ~150 | Converts `FlatPatternResult` → DXF/PDF drawing lines. |
| UI panel | `src/app/[lang]/shape-generator/SheetMetalPanel.tsx` + `_shell/sidebars/ModelerRightPane.tsx` | — | Korean-first i18n already present (`판금` / `굽힘 각도` / `Flange` etc). |
| Agent tool | `src/lib/ai/scad-agent/tools.ts` + `__tests__/sheetMetalUnfold.test.ts` | — | `sheet_metal_unfold` exposed to LLM agent. |
| RFQ / quote | `src/app/[lang]/shape-generator/estimation/stampingCost.ts`, `quick-quote/`, `partner-pricebook.ts` | — | Already consumes sheet-metal metadata. |

### 1.2 What doesn't exist

- **occt-worker has no `src/` directory** in this checkout. Only
  `occt-worker/node_modules` is present. The "10 OCCT ops shipped in
  Wave 1" referenced in the prompt are not on disk yet, or live elsewhere
  (CI / a different branch). Phase 2 has to assume the worker layer is
  *coming online* during Phase 2, not already done.
- **Zero OCCT-backed sheet metal.** Every existing op is mesh-level
  (vertex displacement on Three.js BufferGeometry). This means:
  - Bend lines aren't real B-Rep edges → DXF outlines drift on round-trip.
  - Unfold is a math sum of segment lengths, not a topology unfold.
  - No `edgeRef` survives an import → bends can't be edited from STEP imports.
- **No `addFlange` for arbitrary edges.** Existing `applyFlange` takes
  `edgeIndex: 0..3` (+Z/−Z/+X/−X). Real sheet-metal modelling needs
  any straight edge of any flange to be foldable.
- **Two parallel material catalogues** with incompatible ids
  (`mildSteel` vs `steel-cold-rolled`). One must be canonical before
  Phase 2 ships.
- **Two folder namespaces** (`sheetmetal/` and `sheet-metal/`) need to
  be unified during Phase 2.

### 1.3 Gap summary (what Phase 2 actually has to deliver)

1. Move the bend/flange/unfold contract from *Three.js mesh* to *OCCT
   B-Rep* once the worker layer lands. Keep the existing mesh path as a
   fallback during transition (no UI regression).
2. Build a real B-Rep unfold (topology-walking, not arc-length-summing).
3. Replace the 4-edge `edgeIndex` model with an `EdgeRef` that survives
   STEP round-trips.
4. Canonicalise material ids and merge the two K-factor tables.
5. Wire `unfold` output to the DXF flat-pattern exporter so it produces
   shop-ready laser-cut files (CUT / BEND_UP / BEND_DOWN layers — the
   DXF exporter already declares them, but the bridge is partial).
6. Lock the 5 fixtures in §7 as Wave 2 acceptance gate.

### 1.4 What we keep (don't rewrite)

- `sheetMetalTables.ts` — interpolated K curves, validation warnings,
  Korean labels. This is good work. Phase 2 *normalises* it, doesn't
  replace it.
- `sheetMetalFlatPattern.ts` — pure math (BA / OSSB / BD). Reused
  verbatim by the OCCT path.
- The drawing bridge `flatPatternDrawing.ts`. Phase 2 just feeds it
  better data.
- The agent tool `sheet_metal_unfold` API surface. Internals are swapped,
  external contract is preserved.

---

## 2. Sheet-metal data model (Postgres-ready)

The current code passes ad-hoc objects through Three.js userData. Phase 2
formalises it into a schema that can be persisted (project JSON →
Postgres `nf_sheetmetal_parts` table later) and shipped over the wire to
the worker.

### 2.1 Core types

```ts
type Mm = number;
type Deg = number;

type SheetMaterial =
  | 'mildSteel'        // SPCC / 연강
  | 'stainless304'     // STS304
  | 'stainless316'     // STS316 (new in Phase 2)
  | 'aluminum5052'
  | 'aluminum6061'
  | 'galvanized'       // SGCC
  | 'brass'            // C2680
  | 'copper';          // C1100
// Note: ids match sheetMetalTables.ts (canonical). The dashed-form ids
// in kFactorTable.ts are deprecated and aliased during Phase 2 migration.

interface EdgeRef {
  /** Body / shell id that owns the edge. */
  bodyId: string;
  /** Stable edge identifier — survives STEP round-trip.
   *  For native parts: hash of (body face A id, body face B id) sorted.
   *  For imported parts: OCCT's TopExp index, re-hashed against geometry. */
  edgeId: string;
  /** Cached length in mm — recomputed on geometry change. */
  lengthMm: Mm;
  /** Cached unit direction — recomputed on geometry change. */
  direction: [number, number, number];
}

interface PlaneRef {
  origin: [number, number, number];
  normal: [number, number, number];
  /** Optional reference plane id — 'XY' | 'XZ' | 'YZ' or stable id. */
  refId?: string;
}

interface PolygonProfile {
  kind: 'polygon';
  /** Closed CCW polyline in plane-local 2D coords (mm). */
  points: Array<[Mm, Mm]>;
}

interface RectProfile {
  kind: 'rect';
  widthMm: Mm;
  heightMm: Mm;
  /** Optional rounded corners (single radius). */
  cornerRadiusMm?: Mm;
}

type FlangeProfile = PolygonProfile | RectProfile;

interface SheetFlange {
  id: string;
  /** 2D outline on the flange's local plane. */
  profile: FlangeProfile;
  /** Plane this flange's mid-surface lies on. */
  plane: PlaneRef;
  /** Sheet thickness used to extrude the flange (mm).
   *  Equals SheetMetalPart.thickness for the base flange; child flanges
   *  inherit unless explicitly overridden (which is illegal for a single
   *  part — flagged as a DFM error). */
  thickness: Mm;
}

interface SheetBend {
  id: string;
  /** Which edge this bend folds. The edge must lie on the boundary
   *  between two flanges (or between a flange and a virtual "ghost"
   *  flange that gets created by the bend itself). */
  edgeRef: EdgeRef;
  /** Included bend angle (degrees). 0 = flat (no bend), 90 = L-bend,
   *  180 = closed hem. */
  angle: Deg;
  /** Inner bend radius (mm). Must satisfy material minBendRadiusFactor × t. */
  radius: Mm;
  /** Mountain ('up') or valley ('down'). Convention: mountain = the
   *  outside of the bend faces +Y on the flange's local plane. */
  direction: 'up' | 'down';
  /** Optional per-bend K override (rare — for shops calibrating tooling). */
  kFactorOverride?: number;
  /** Optional springback compensation (degrees added to angle). */
  springbackDeg?: Deg;
}

interface SheetMetalPart {
  /** Persisted id (used as the Postgres PK). */
  id: string;

  /** Sheet thickness in mm. Default 1.5 (Korean laser-cut standard). */
  thickness: Mm;

  /** Material id (must be a SheetMaterial). */
  material: SheetMaterial;

  /** K-factor: 0 = derive from material+R/t table, >0 = literal override.
   *  Default 0 (derive). UI shows the derived value as a read-only hint. */
  kFactor: number;

  /** Base flange — the seed of the part. Always present. */
  baseFlange: SheetFlange;

  /** Additional flanges added by `addFlange` ops. */
  additionalFlanges: SheetFlange[];

  /** Bends, in order of creation. Order matters for unfold (last-in,
   *  first-out at the topology walk). */
  bends: SheetBend[];

  /** Provenance — what created the part. */
  source:
    | { kind: 'native'; createdBy: 'sketch' | 'ai' | 'template' }
    | { kind: 'imported'; format: 'step' | 'iges' | 'dxf'; importedAt: string };

  /** Cached derived data. Re-computed whenever bends/flanges change. */
  derived?: {
    flatLengthMm: Mm;
    flatWidthMm: Mm;
    surfaceAreaMm2: number;
    estimatedMassKg: number;
    /** Last-known DFM warning count for sidebar badge. */
    dfmWarningCount: number;
  };
}
```

### 2.2 Why these defaults

- `thickness = 1.5 mm`: dominant on Korean laser-cut quotes (SPCC 1.5t,
  AL5052 1.5t). The default needs to be one click off the most common
  RFQ. Larger plate work (3.2t, 4.5t) is one slider away.
- `kFactor = 0` (auto-derive): forces the system to pick from the
  R/t curve, not a fixed 0.42 that's wrong half the time.
- `material = 'mildSteel'`: SPCC is ~70% of NexyFab demo-mode RFQs.

### 2.3 Postgres mapping (Phase 2 deferred; spec is here so the Postgres
work doesn't break the JSON contract)

```
nf_sheetmetal_parts
  id                uuid PK
  project_id        uuid FK
  thickness_mm      numeric(6,3)
  material          text   -- SheetMaterial enum
  k_factor          numeric(4,3)
  base_flange       jsonb  -- SheetFlange
  additional_flanges jsonb -- SheetFlange[]
  bends             jsonb  -- SheetBend[]
  source            jsonb
  derived           jsonb
  created_at        timestamptz
  updated_at        timestamptz
```

`bends` and `additional_flanges` stay as `jsonb` because their cardinality
is bounded (typical part: 1–8 bends, 0–4 extra flanges) and joins on
individual bends aren't a query pattern.

---

## 3. Worker API endpoints

All routes live under `/occt/op/sheetmetal/*` on the occt-worker. They
take JSON, return JSON. Geometry is referenced via opaque body ids
already used by the rest of the worker; payload sizes stay small.

### 3.1 Common envelope

```ts
type WorkerReq<Op extends string, P> = {
  op: Op;
  bodyId?: string;        // input body (omit for baseFlange — creates new)
  params: P;
  /** Idempotency key — the worker caches results when the same key + op + params hit twice. */
  idempotencyKey?: string;
};

type WorkerOk<R> = { ok: true; bodyId: string; meshUrl?: string; result: R };
type WorkerErr  = { ok: false; code: string; messageEn: string; messageKo: string };
```

### 3.2 `POST /occt/op/sheetmetal/baseFlange`

Creates the seed body for a sheet-metal part.

**Params:**
```ts
{
  profile: FlangeProfile;
  plane: PlaneRef;
  thicknessMm: number;     // 0.5–20
  material: SheetMaterial; // for downstream K lookup
}
```

**Result:**
```ts
{
  bodyId: string;
  area2dMm2: number;       // profile area
  boundingBox: { min: [Mm,Mm,Mm]; max: [Mm,Mm,Mm] };
}
```

**Notes:** the profile is extruded along the plane normal by
`thicknessMm`. The mid-surface lies on `plane`. Holes within the profile
(polygons with reverse winding) are supported in Phase 2.

### 3.3 `POST /occt/op/sheetmetal/addFlange`

Adds a flange attached to an existing edge. The new flange shares
**thickness** with the parent (always — Phase 2 rejects mixed-thickness
within one part).

**Params:**
```ts
{
  /** Existing edge on the part. Must be a straight edge on the
   *  boundary of an existing flange. */
  edgeRef: EdgeRef;
  /** Length of the new flange measured from the edge in the bend
   *  outward direction (mm). */
  flangeLengthMm: number;
  /** Width override — by default the new flange matches the edge length.
   *  Use this to make a narrower tab. */
  flangeWidthMm?: number;
  /** Initial bend angle. The flange is created flat (180° = same plane)
   *  and then bent. Default 90. */
  angleDeg: number;
  /** Inner bend radius (mm). */
  innerRadiusMm: number;
  /** Mountain or valley. */
  direction: 'up' | 'down';
}
```

**Result:**
```ts
{
  newFlangeId: string;
  newBendId: string;
  /** Updated bounding box of the full part. */
  boundingBox: { min: [Mm,Mm,Mm]; max: [Mm,Mm,Mm] };
}
```

**Internals:** under the hood this is *extrude profile from edge* +
*boolean union with parent* + *fillet at the bend root* + record a
`SheetBend` with the K-factor derived from the material/R/t table.
This is the operation that maps onto Wave 1's `extrude` + `boolean` +
`fillet` ops, which is why it's tractable without new OCCT primitives.

### 3.4 `POST /occt/op/sheetmetal/bend`

Bends a flange about an existing straight edge. Differs from `addFlange`
in that the *flange already exists* — this op just folds it.

**Params:**
```ts
{
  edgeRef: EdgeRef;        // hinge edge
  angleDeg: number;        // 0–180
  innerRadiusMm: number;
  direction: 'up' | 'down';
  kFactorOverride?: number;
}
```

**Result:**
```ts
{
  bendId: string;
  bendAllowanceMm: number;
  boundingBox: { min: [Mm,Mm,Mm]; max: [Mm,Mm,Mm] };
}
```

**Mapping:** rotate the topology on the far side of `edgeRef` by
`angleDeg` about the edge axis, insert a cylindrical patch at the bend
root (Wave 1 `sweep` op), and union back.

### 3.5 `POST /occt/op/sheetmetal/unfold`

**Most important op.** Develops the 3D part into a 2D flat blank.

**Params:**
```ts
{
  /** Fixed flange — the one that stays in its current plane during
   *  unfold. Default: baseFlange. */
  fixedFlangeId?: string;
  /** Whether to emit a 2D wire body (true) or just compute lengths (false).
   *  false is faster — used by RFQ cost estimates. */
  emitWireBody?: boolean;
}
```

**Result:**
```ts
{
  /** Flat blank dimensions. */
  flatLengthMm: number;
  flatWidthMm: number;
  /** Total area of the unfolded blank (useful for material-cost calc). */
  flatAreaMm2: number;
  /** Bend table in walking order (sorted by position along the
   *  fixed-flange axis). */
  bendTable: Array<{
    bendId: string;
    /** Where this bend line lands on the unfolded blank (mm from
     *  blank origin). */
    positionMm: number;
    angleDeg: number;
    radiusMm: number;
    direction: 'up' | 'down';
    bendAllowanceMm: number;
    bendDeductionMm: number;
    kFactor: number;
  }>;
  /** Optional 2D wire body for DXF export. Present iff emitWireBody=true. */
  wireBodyId?: string;
  /** Validation warnings (min bend radius, hem feasibility, etc.). */
  warnings: Array<{ severity: 'error'|'warn'|'info'; code: string; messageKo: string; messageEn: string }>;
}
```

### 3.6 Error codes (worker → client)

| Code | When | Recovery |
|---|---|---|
| `EDGE_NOT_STRAIGHT` | Phase 2 only allows straight edges for bends. | Pick another edge or use Wave 3 curved-bend op. |
| `EDGE_NOT_ON_BOUNDARY` | Edge is interior — can't host a flange. | Pick a boundary edge. |
| `BEND_RADIUS_BELOW_MIN` | r < material.minBendRadiusFactor × t. | Increase radius or change material. |
| `FLANGE_SELF_INTERSECT` | New flange would clip an existing one. | Reduce length or move the source edge. |
| `MIXED_THICKNESS` | flangeThicknessMm ≠ part.thickness. | Use a separate part. |
| `UNFOLD_CYCLIC` | Bend graph has a cycle (not a tree). | The geometry isn't developable. Manual fix required. |

---

## 4. Bend allowance calculation (industry-standard)

The math lives in `sheetMetalFlatPattern.ts` and `sheetMetalTables.ts`
today. This section documents the contract and the Korean-fab default
values Phase 2 ships with. Existing files already implement most of
this — the spec is here so the worker and the UI agree on the formulas.

### 4.1 K-factor defaults

Linear-interpolated per material against the R/t ratio. The
"sensible default" column is what the UI shows when the user has
no project history.

| Material (ko) | id | Sensible K (R=t, 90°) | Min R / t factor |
|---|---|---|---|
| 연강 (SPCC) | `mildSteel` | 0.42 | 1.0 |
| 스테인리스 STS304 | `stainless304` | 0.38 | 1.5 |
| 스테인리스 STS316 | `stainless316` | 0.36 | 1.5 |
| 알루미늄 AL5052 | `aluminum5052` | 0.43 | 1.0 |
| 알루미늄 AL6061 | `aluminum6061` | 0.40 | 1.5 |
| 아연도금 SGCC | `galvanized` | 0.42 | 1.0 |
| 황동 C2680 | `brass` | 0.40 | 1.0 |
| 동판 C1100 | `copper` | 0.39 | 1.0 |

R/t curves are stored in `sheetMetalTables.ts`. Phase 2 deprecates the
parallel table in `kFactorTable.ts` (different material ids, same
purpose, ~5% different K values) and removes it.

### 4.2 Bend allowance

```
BA = (π / 180) × θ × (R + K × t)
```
- `θ` = included bend angle (deg).
- `R` = inner bend radius (mm).
- `K` = K-factor.
- `t` = thickness (mm).

For a 90° bend at R=t, K=0.42, t=1.5:
```
BA = (π/180) × 90 × (1.5 + 0.42 × 1.5)
   = 1.5708 × 2.13 = 3.346 mm
```

### 4.3 Outside setback (OSSB)

```
OSSB = (R + t) × tan(θ / 2)
```

Used when the operator measures from mold-line corners (the intersection
of the inside flange surfaces extended to their meeting point).

### 4.4 Bend deduction

```
BD = 2 × OSSB − BA
```

Flat = Σ(mold-line legs) − Σ(BD). Equivalent to the BA-additive form;
preferred by press-brake operators because their drawings show
mold-line dimensions.

### 4.5 Springback compensation

Defaults from Stage 1 (already in `sheetMetalSpringback.ts`):

| Material | Springback (deg, 90° air bend) |
|---|---|
| SPCC | 1.5 |
| STS304 | 3.0 |
| STS316 | 3.5 |
| AL5052 | 1.0 |
| AL6061 | 1.8 |
| SGCC | 1.5 |
| Brass | 0.8 |
| Copper | 0.5 |

The worker stores the target angle (e.g. 90°). The bend-table export
adds the springback to give the operator the actual angle to bend to
(91.5° to land on 90° in SPCC).

### 4.6 Korean reference standards

- **KS B 0254** — sheet metal bending tolerance class. Phase 2's
  default tolerances:
  - Bend angle: ±1° (KS B 0254 일반급).
  - Flat-pattern blank dimension: ±0.3 mm for L ≤ 100 mm, ±0.5 mm for
    100 < L ≤ 500 mm.
- **KS D 3501** (SPCC), **KS D 3705** (STS304), **KS D 6701** (AL5052) —
  material spec ids displayed in RFQ output for traceability.
- Bend deduction tables in the wild (e.g. "한국 판금가공 협회" press-brake
  tables) match within ±0.05 mm of the K-factor-derived values for
  R/t in [0.5, 5]. The deviation grows outside that range, which is
  why Phase 2 raises a `WARN` for R/t > 8 (custom press-brake tooling
  likely needed).

---

## 5. Unfold algorithm

The hard part. Today's `generateFlatPattern` is a 1-D arc-length sum
that only works for parts where every bend is parallel. Phase 2 needs a
real topology unfold for L-, U-, hat-, and box-section parts.

### 5.1 Inputs

- The `SheetMetalPart` (canonical state).
- A "fixed" flange id — the one that stays put. Default: `baseFlange`.

### 5.2 Steps

1. **Build the bend graph.**
   - Node per flange.
   - Edge per bend, labelled with (angle, radius, K, direction, hinge edge).
   - Graph must be a tree rooted at the fixed flange. Cycles → reject
     with `UNFOLD_CYCLIC` (Phase 2 only handles tree topologies).

2. **Edge classification per face.**
   For every face of the part:
   - `fold` — shared with another flange via a bend (becomes a center
     line in DXF).
   - `outline` — exterior boundary of the flat blank (becomes a CUT
     line in DXF).
   - `interior` — holes / cutouts (CUT layer, inner contour).
   The original 3D edge is matched against the bend list by edgeRef
   identity.

3. **Walk the bend tree DFS from the fixed flange.**
   For each visited bend:
   1. Compute bend allowance BA from the K + R + t + angle.
   2. Compute the **hinge axis** in the *current world frame*.
   3. Compute the **rotation** that undoes the bend: rotate the child
      flange (and everything attached to it transitively) about the
      hinge axis by `−angleDeg` to bring its mid-surface coplanar with
      the parent.
   4. Replace the bend region (a partial cylinder) with a flat strip
      of width = BA, length = hinge length. This strip becomes part
      of the flat blank.

4. **Project to 2D.**
   After the DFS completes, every flange lies on the parent plane. The
   union of all mid-surfaces is the 2D flat blank. Project to the
   parent plane's UV coords.

5. **Subtract bend areas on both faces.**
   Each bend contributes a strip of width BA — this strip is added to
   the flat blank (it's the unwrapped arc). Important: the strip
   sits *between* the two adjacent flanges along the hinge axis. Width
   is BA, not 2×BA — the bend region only exists once on the blank.
   (The 3D part has it as a curved patch; the 2D blank has it as a flat
   strip.)

6. **Emit the bend table.**
   Sorted by position along the unfolded blank's length axis. The
   "position" is where the *center of the bend strip* lies on the flat
   blank, measured from the blank origin. The press-brake operator
   reads this directly.

### 5.3 Edge cases the algorithm must handle

| Case | Behaviour |
|---|---|
| Two flanges share an edge but the bend was never recorded | Treat as a rigid joint, no BA contribution, no fold line. |
| Bend on an edge that doesn't span the full flange width | Split: a portion of the edge folds, the rest stays rigid. Bend table records the start/end of the fold line, not just the position. |
| Hem (180° bend) | The "child" flange ends up on top of the parent. Detect and emit a hem entry in the bend table (separate `HEM_UP` / `HEM_DOWN` DXF layer optional in Phase 2 — not in scope, deferred to §9). |
| Open vs closed angle | Convention: included angle ∈ [0, 180]. 180° = flat (no bend), 90° = L, 0° = closed hem. |
| Bend with springback override | The recorded angle is the target; BA uses the target; the bend table shows both target and "to-bend" (target + springback). |
| Cyclic graph | Rejected. Returned as `UNFOLD_CYCLIC`. |
| Self-intersect on flat blank | Rejected. Returned as `UNFOLD_SELF_INTERSECT`. Common when adjacent flanges overlap in flat (e.g. two L-bends towards each other on a too-narrow strip). |

### 5.4 DXF export conventions

The DXF exporter already declares the right layers:

```ts
const LAYER_COLORS = {
  '0': 7, CUT: 7, BEND_UP: 1, BEND_DOWN: 5, ANNOTATE: 3,
};
```
(from `src/app/[lang]/shape-generator/io/dxfExporter.ts`)

Phase 2 wire-up:
- **CUT** (white/black, color 7): outer outline + interior holes. Closed
  polylines. This is what the laser machine reads.
- **BEND_UP** (red, color 1): mountain folds. Single line per bend,
  spanning the hinge length.
- **BEND_DOWN** (blue, color 5): valley folds.
- **ANNOTATE** (green, color 3): bend index, angle, radius labels.
- **HEM** (optional, deferred to §9): 180° bends.

Layer naming follows the *Korean partner pricebook convention*
(`partner-pricebook.ts`): partners parse `CUT` as their cut path,
`BEND_*` as press-brake setup info. Phase 2 commits to these names
permanently — no renaming, even on user-facing exports.

---

## 6. UI mockup (text wireframe)

The shell already has `ModelerShell.tsx` with left/center/right panes.
Sheet-metal mode adds a top ribbon + reuses the panes.

### 6.1 Top ribbon (when sheet-metal mode active)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [판금]  [Base Flange] [Add Flange] [Bend] [Hem] [Jog] │ [전개도] [DXF내보내기] │
└────────────────────────────────────────────────────────────────────────┘
```

- "판금" indicator on the left makes the mode visible.
- Primary creation ops grouped: Base Flange / Add Flange / Bend / Hem / Jog.
- Right group: "전개도" (Unfold preview) and "DXF 내보내기" (DXF export).

### 6.2 Left pane — `SheetMetalLeftPane`

```
┌─ Sheet Metal ──────────────┐
│                            │
│  ▼ Base Flange (F1)        │
│      shape: rect 100 × 50  │
│      plane: XY             │
│                            │
│  ▼ Additional Flanges (2)  │
│    F2  edge: F1.e0  ↑90°   │
│    F3  edge: F1.e2  ↑90°   │
│                            │
│  ▼ Bends (3)               │
│    B1  edge F1.e0  ↑90° R1.5 │
│    B2  edge F1.e2  ↑90° R1.5 │
│    B3  edge F2.e1  ↓45° R2  │
│                            │
│  [+ Bend]  [+ Flange]      │
└────────────────────────────┘
```

Each item is selectable → highlights the corresponding edge/face in
the viewport. Right-click → delete / edit / suppress. Suppress is a
Phase 2 plus (lets you toggle a bend off without losing the data).

### 6.3 Right pane — `SheetMetalRightPane`

```
┌─ Properties ───────────────┐
│                            │
│ Thickness     [1.5] mm     │
│ Material      [SPCC ▾]     │
│   - SPCC (연강)            │
│   - STS304 (스테인리스)     │
│   - STS316                 │
│   - AL5052 (알루미늄)      │
│   - AL6061                 │
│   - SGCC (아연도금)        │
│   - Brass (황동)           │
│   - Copper (동판)          │
│                            │
│ K-factor   [0.42] [auto ✓] │
│   (R=1.5, t=1.5 → 0.42)    │
│                            │
│ Springback  [1.5°] [auto ✓] │
│                            │
│ ─ Flat Blank ──            │
│ Width        198.34 mm     │
│ Length       301.66 mm     │
│ Area         598.5 cm²     │
│ Est. mass    0.706 kg      │
│                            │
│ ─ DFM ──                   │
│ ⚠ B3 R<min for STS304       │
│   "R 최소값은 2.25 mm 입니다" │
│                            │
│ [전개도 보기 ▸]  [DXF ▸]    │
└────────────────────────────┘
```

### 6.4 Center viewport

- 3D view of the folded part (current state).
- Pick-target highlights: edges that can host a flange/bend pulse on
  hover.
- "전개도 보기" toggles a **split-screen mode**: 3D part on the left, 2D
  flat blank on the right, with bend lines + bend-index labels on the
  flat. Bend table fixed-docked at the bottom (auto-collapsible).

### 6.5 Auto-generated drawing

When the user clicks "도면 자동 생성" (auto-generated drawing), the
sheet-metal part produces a multi-view drawing:

- Top-left: front view of folded part (3D projection).
- Top-right: top view of folded part.
- Bottom-left: 2D flat blank with bend lines + dimensions.
- Bottom-right: bend table (rows = bends, columns = #, position, angle,
  radius, direction, BA, K).
- Title block (bottom): material, thickness, finish (optional), total
  blank, est. mass, drawer / drawee, KS spec id.

This is wired through the existing `analysis/flatPatternDrawing.ts` →
`io/dxfExporter.ts` pipeline; Phase 2 connects the new unfold output to
this existing pipe.

### 6.6 Korean-first labels

The right-pane property names are Korean-canonical in the ko locale:

| Term | ko | en | ja | zh |
|---|---|---|---|---|
| 플랜지 | 플랜지 | Flange | フランジ | 法兰 |
| 절곡선 / 굽힘선 | 절곡선 | Bend line | 曲げ線 | 折弯线 |
| 전개도 | 전개도 | Flat pattern | 展開図 | 展开图 |
| K-팩터 | K-팩터 | K-factor | K係数 | K因子 |
| 굽힘 허용량 | 굽힘 허용량 | Bend allowance | 曲げ代 | 弯曲余量 |
| 굽힘 공제량 | 굽힘 공제량 | Bend deduction | 曲げ控除量 | 折弯扣减量 |
| 스프링백 | 스프링백 | Springback | スプリングバック | 回弹 |
| 최소 굽힘 반경 | 최소 굽힘 반경 | Min bend radius | 最小曲げ半径 | 最小折弯半径 |
| 헴 | 헴 | Hem | ヘム | 卷边 |

The Phase 2 implementation extends the existing dict in
`SheetMetalPanel.tsx` and shape-generator `shapeDict.ts` with these keys.
Some are already present (`판금`, `굽힘 각도`); the new ones (`전개도`,
`절곡선`, `K-팩터`) need to land.

---

## 7. Test fixtures (Wave 2 acceptance gate)

The five fixtures below are the gate. Wave 2 sheet metal ships when all
five round-trip through unfold + DXF export with measurements within
tolerance.

### 7.1 F-SM-01 — L-bracket (single bend 90°)

- Base flange: 100 × 50 rect, on XY plane, t = 1.5 mm.
- Bend: edge F1.e0 (+X long edge), angle 90°, R = 1.5 mm, direction up.
- Expected flat: width 50 mm × length **101.85 mm**
  (= 100 + BA(90°, 1.5, 0.42, 1.5) − ε for double-counted thickness).
  Precise: BA = (π/180)·90·(1.5 + 0.42·1.5) = 3.346 mm; legs measured
  to mold line = 100 mm flat; with BD = 2·OSSB − BA = 2·(1.5+1.5)·tan(45)
  − 3.346 = 6 − 3.346 = 2.654 mm; sum-of-legs − BD = 100 mm depends on
  how legs are measured. (Fixture asserts the *worker output* matches
  the *math* — exact number above is illustrative; gate is "the worker
  agrees with `sheetMetalFlatPattern.developFlatPattern` within 1e-3 mm".)
- DXF check: 1 BEND_UP line at y = 50 mm (or wherever the bend lands),
  rectangle outline.

### 7.2 F-SM-02 — U-channel (2 bends)

- Base flange: 200 × 60 rect, t = 1.5 mm.
- Bend B1: edge F1.e0 (top edge), 90° up, R = 1.5 mm.
- Bend B2: edge F1.e1 (bottom edge), 90° up, R = 1.5 mm.
- After unfold: width 60 mm, length 200 + 2·BA − 2·ε.
- DXF check: 2 BEND_UP lines parallel to the short axis.

### 7.3 F-SM-03 — Hat section (3 bends, mixed direction)

- Base flange: 200 × 80 rect, t = 1.5 mm.
- Sub-flange F2: edge F1.e0, length 30, angle 90° down, R = 1.5 mm.
- Bend B2 on F2 outer edge: angle 90° up, R = 1.5 mm (creates the hat
  "brim").
- Mirror F3 symmetric on the opposite edge.
- Acceptance: flat unfolds without self-intersection; bend table lists
  4 bends (2 outer 90° down, 2 inner 90° up); DXF has both
  BEND_DOWN and BEND_UP layers populated.

### 7.4 F-SM-04 — Pipe clamp (curved-bend stand-in)

Phase 2 cannot handle a true curved bend (deferred to Wave 3, see §9).
This fixture is a **discretised approximation**: a curved bend
approximated by N=6 chained straight bends of θ = 30° each, giving a
180° total wrap.

- Base flange: 80 × 40 rect, t = 1.5 mm.
- 6 chained 30° bends on the long axis, all R = 5 mm, all up.
- Expected: unfolded length = 80 + 6 × BA(30, 5, K, 1.5).
- This fixture validates the multi-bend walking order and BA
  accumulation. **It does not validate curved-bend modelling** — that's
  Wave 3.

### 7.5 F-SM-05 — Box with cutout (multi-flange)

- Base flange: 120 × 80 rect with a central rectangular cutout
  (50 × 30), t = 1.5 mm.
- 4 side flanges, each 25 mm tall, bent up at 90°, R = 1.5 mm.
- Expected: 4 bends in bend table, unfold shows 4 wings around a
  rectangular base with a hole in the middle.
- DXF check: outer outline polyline + inner cutout polyline + 4
  BEND_UP lines.

### 7.6 Acceptance criteria

A fixture passes when ALL of:

1. Worker `baseFlange` + `addFlange`/`bend` ops produce a body
   matching the expected bounding box within ±0.05 mm.
2. `unfold` returns `flatLengthMm`, `flatWidthMm`, `flatAreaMm2` within
   ±0.1 mm of the analytical value.
3. Bend table has exactly the expected number of entries, with angles,
   radii, directions correct.
4. DXF export round-trips through Onshape / FreeCAD without warnings.
5. The 3D viewport renders the part correctly (no inverted normals,
   no degenerate triangles).
6. Test takes <1.5 s on the worker (Wave 1 baseline).

Gate condition: **5 / 5 fixtures pass.**

---

## 8. Phase 2 timeline (4 weeks)

### Week 1 — Base flange + 1 bend (F-SM-01 working end-to-end)

**Worker side:**
- Land `occt-worker/src/sheetmetal/baseFlange.ts` using Wave 1
  `extrude` op.
- Land `occt-worker/src/sheetmetal/bend.ts` using Wave 1 `boolean` +
  `fillet` + a custom rotation primitive.
- Wire routes `/occt/op/sheetmetal/baseFlange` and `/bend`.

**Client side:**
- Add `SheetMetalPart` type to `src/app/[lang]/shape-generator/sheetmetal/types.ts`.
- Hook the right pane material picker to send `material` through to the
  worker. (Currently the K-factor is read on the client only — Phase 2
  ends with the worker doing the lookup itself.)
- Canonicalise material ids (remove `kFactorTable.ts`).
- F-SM-01 fixture green.

**Risk:** if occt-worker `src/` isn't online by start of Phase 2,
Week 1 is blocked on the worker layer materialising. Mitigation: build
all Week 1 work behind a feature flag `sheetMetalV2=true` that keeps the
current Three.js path as the default.

### Week 2 — Multi-bend + addFlange (F-SM-02, F-SM-03)

- `/occt/op/sheetmetal/addFlange` route.
- Multi-bend ordering: bend records a stable order; later bends know
  about earlier ones for graph construction.
- DFM check: minimum-bend-radius warnings surface in the right pane.
- Hem & jog stay on the Three.js fallback path (they don't need OCCT
  for this phase).
- F-SM-02 and F-SM-03 fixtures green.

### Week 3 — Unfold + DXF flat export (F-SM-05 + F-SM-04)

- `/occt/op/sheetmetal/unfold` route, full topology unfold.
- Wire the unfold output to `analysis/flatPatternDrawing.ts`.
- DXF exporter starts emitting CUT / BEND_UP / BEND_DOWN per the new
  unfold result.
- F-SM-05 fixture green.
- F-SM-04 (discretised curved bend) green — validates multi-bend
  accumulation.

### Week 4 — Korean UI + bend table + auto-drawing

- Right pane gets the property block in §6.3.
- Bend table view (dock at bottom of unfold preview).
- Auto-drawing pipeline routes through to PDF export (existing
  `io/pdfExport.ts`).
- New i18n keys land in `shapeDict.ts` for `절곡선`, `전개도`, `K-팩터`,
  etc. ja/zh translations from existing dict.
- Onboarding tour gets a "Sheet metal in 60 seconds" step.

**Buffer:** the timeline above assumes the worker layer is online by
end of Week 0. If it slips, slip Week 1 → Week 5; Weeks 2–4 stay in
order.

### Done definition

Phase 2 ships when:
- All 5 fixtures pass (acceptance gate, §7.6).
- DXF outputs validated against Korean partner pricebook layer
  convention.
- The mesh-level path (current `applyBend` / `applyFlange`) is still
  the fallback for non-OCCT bodies — no UI regression for existing
  projects.
- One Wave 1 → Wave 2 migration PR converts existing projects'
  sheet-metal artefacts to the new `SheetMetalPart` schema. (Old data
  must keep loading; the upgrade is one-way and idempotent.)

---

## 9. Known limits + future work

The following are **out of scope** for Wave 2 Phase 2. Each has a
target wave noted.

### 9.1 Wave 2 (late) — closer-to-shipped extensions

- **Hem (180° bend)** as a first-class feature with HEM DXF layer.
  Currently a 180° regular bend; press-brake operators want it
  distinguished on the drawing for tooling setup.
- **Tab + slot** auto-mating between two `SheetMetalPart` instances in an
  assembly. Useful for self-locating weld joints. Lives in the assembly
  module, not the part module — needs Wave 2 assembly work to land
  first.
- **Edge cleanup pass** on unfold: remove zero-length edges, merge
  collinear segments. Cosmetic but matters for clean DXF output.

### 9.2 Wave 3 — bigger lifts, defer

- **Curved bend (roll bending)** — true continuously-curved bend, e.g.
  for a pipe clamp or a partial cylinder. Requires OCCT spline-bend
  support; the worker primitive isn't ready. F-SM-04 fakes this with
  discretised chained bends, which is the Wave 2 stopgap.
- **Multi-thickness sheets in one part** — explicitly rejected by the
  Phase 2 schema (`MIXED_THICKNESS` error). Real-world joining of
  different-thickness sheets is a weldment, not a single part.
- **Lofted bend** — already drafted in
  `sheetmetal/loftedBend.ts` as a Three.js prototype. Needs OCCT loft
  primitive (Wave 1 already ships loft per the prompt — could promote
  earlier, but we'd burn timeline budget). Phase 2 keeps the Three.js
  prototype as a "developer preview" feature; Wave 3 brings it to
  parity with the OCCT path.
- **Stamping & deep draw** — already drafted in
  `sheet-metal/deepDraw.ts`. Deferred — needs a separate worker op
  (forming-limit-diagram analysis) and isn't a press-brake feature.
- **Closure / closure flange** — automated edge closure between
  adjacent flanges. Visual-only impact in Wave 2; press-brake operator
  has to mentally add the closure anyway.
- **Welded sheet-metal assemblies** — same scope issue as tab+slot,
  needs assembly module first.

### 9.3 Permanently out of scope

- **Forming-limit-diagram strain analysis.** Real FEA — belongs in the
  simulation module, not the modelling module. (Currently a
  pseudo-implementation in
  `sheetmetal/formingLimitDiagram.ts` — should be marked "experimental"
  during Phase 2 cleanup.)
- **Material-specific tooling die libraries** (custom press-brake dies
  per shop). This is partner-side configuration, not part of the
  modeller.

---

## 10. Open questions (Phase 2 entry)

1. **Worker boundary:** does `unfold` return a wire body the client
   can render directly, or does the client always re-derive the 2D
   blank from the bend table? Trade-off: wire body is geometrically
   exact (good for DXF) but adds payload; bend-table reconstruction is
   lossy on round-tripped/imported parts.
   *Recommendation:* return both, gated by `emitWireBody` param. RFQ
   estimates use the bend table (fast); DXF export uses the wire body
   (precise).

2. **Edge stability across edits:** when a user changes thickness from
   1.5 to 2.0 mm, every bend's `edgeRef.edgeId` changes (new topology).
   Do we re-anchor bends by *edge position in the parametric flange*
   rather than by edge id?
   *Recommendation:* yes. Phase 2 stores bends as
   `{ flangeId, edgeIndex }` *internally* and resolves to `edgeRef`
   on the wire. The exposed type stays as is; the resolution layer is
   new.

3. **Material id migration:** there are users with old project JSONs
   using `steel-cold-rolled` (the dashed form). Phase 2 needs a
   one-way migration map. Where does this live? `lib/migrations/`?
   *Recommendation:* yes, add a `migrations/v2-sheetmetal-material-ids.ts`
   that runs once on project load.

4. **Demo-mode constraint:** the demo session has FK isolation
   (`nf_sessions` table). Does the sheet-metal `id` get a session
   prefix? *Recommendation:* match existing demo conventions — prefix
   `demo_` and FK to `demo_sessions` for demo writes.

5. **Sentry alerting:** any unfold that fails with `UNFOLD_CYCLIC`
   or `UNFOLD_SELF_INTERSECT` is *probably* user-recoverable. But if
   the rate exceeds 5% of unfold attempts, that's a UX bug.
   *Recommendation:* register a Sentry breadcrumb + an
   `sendOpsAlert('sheetmetal.unfold.failure_rate', ...)` weekly digest.

---

**End of spec. Implementation work tracked in
`docs/strategy/CAD_FULLSTACK_MILESTONES.md` under M4 / Wave 2 Phase 2
once this spec is signed off.**
