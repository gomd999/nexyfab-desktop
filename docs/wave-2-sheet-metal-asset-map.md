# Wave 2 — Sheet-Metal Asset Map

**Status:** audit, read-only. Snapshot 2026-05-28.
**Owner:** Wave 2 Phase 1 Week 4 consolidation prep.
**Purpose:** inventory every sheet-metal-related source file so the Phase 2
Week 1 consolidation pass knows exactly what it touches. Conclusions
land in `wave-2-sheet-metal-consolidation-plan.md`.

---

## 0. Numbers at a glance

| Namespace | Source files (.ts) | Test files (.test.ts) | Total lines |
|---|---|---|---|
| `features/` (`sheetMetal*.ts`) | 5 | 4 | ≈ 1 599 + 653 tests |
| `sheetmetal/` (no dash) | 18 (incl. `index.ts`) | 16 | ≈ 3 391 + 1 678 tests |
| `sheet-metal/` (dashed) | 4 | 4 | ≈ 384 + 326 tests |
| `SheetMetalPanel.tsx` + UI bridges | 1 + 2 partials | 0 (panel) | ≈ 413 + 125 |
| Agent / RFQ / DXF wiring | 5 distinct files | 1 (`sheetMetalUnfold.test.ts`) | n/a |
| **TOTAL sheet-metal owned** | **≈ 30 source files** | **25 test files** | **≈ 8 750 LOC** |

`wc -l` across all three folders + panel + bridge: **8 752 lines.** This is
not a small surface area; the spec doc undercounts test coverage by half.

---

## 1. File-by-file inventory

### 1.1 `src/app/[lang]/shape-generator/features/` (Wave 1 GA — Three.js mesh layer)

Five source modules. Heavy callers across the app — this is the *de facto*
production path right now.

#### `features/sheetMetal.ts` — 825 lines

- **Exports:**
  - Types: `BendParams`, `FlangeParams`, `HemParams`, `HemType`,
    `JogParams`, `SheetMetalHemWarning`, `FlatPatternResult`,
    `BendTableEntry`, `SHEET_METAL_MATERIAL_ORDER`.
  - Functions: `calculateBendAllowance`, `applyBend`, `applyFlange`,
    `applyHem`, `applyJog`, `generateFlatPattern`, `getFlatPatternMetadata`,
    `bendFeature`, `flangeFeature`, `jogFeature`, `hemFeature`,
    `flatPatternFeature`.
- **Depends on:** `features/sheetMetalTables.ts` (canonical material id +
  K-curve), `features/types.ts` (`FeatureDefinition`), `three`.
- **Callers:**
  - `ShapeGeneratorInner.tsx` (lazy import — `applyBend`, `applyFlange`,
    `generateFlatPattern`, `getFlatPatternMetadata`).
  - `features/index.ts` (re-export to feature catalog).
  - `features/sheetMetal.test.ts`, `dfm/dfmRules.ts`,
    `analysis/flatPatternDrawing.ts` (via `FlatPatternResult` type),
    `estimation/{rfqBundler,quotePrinter,CostEstimator,CostPanel}.ts`,
    `io/dxfExporter.ts`.
- **Tests:** `sheetMetal.test.ts` (187 lines). PASS in CI.
- **Status:** **V1 production**, mesh-level. Keep. Spec §1.4 confirms.

#### `features/sheetMetalTables.ts` — 278 lines

- **Exports:** type `SheetMetalMaterial` (canonical camelCase enum:
  `mildSteel | stainless304 | aluminum5052 | aluminum6061 | galvanized |
  brass | copper`), `SheetMetalMaterialInfo`, `SHEET_METAL_MATERIALS`
  (record), `DEFAULT_MATERIAL`, `getKFactor`, `bendAllowance`,
  `outsideSetback`, `bendDeduction`, `validateBend`, `SheetMetalBendWarning`.
- **K curve:** 5-point R/t curve per material, linear interp.
- **Korean labels:** `labelKo` on every material — `연강 (SPCC)`,
  `스테인리스 STS304`, `알루미늄 AL5052`, `아연도금강판 (SGCC)`, `황동 C2680`,
  `동판 C1100`. Korean-canonical.
- **Callers:** `features/sheetMetal.ts`, `features/sheetMetalSpringback.ts`,
  `features/sheetMetalTables.test.ts`, `io/nfabFormat.ts` (via comment
  reference — the `smMaterial` field is documented as the canonical key
  for this table).
- **Tests:** 153-line test file, PASS.
- **Status:** **CANONICAL TABLE.** Phase 2 spec §1.4 and §2.1 explicitly
  designate this file's material ids as canonical.

#### `features/sheetMetalSpringback.ts` — 68 lines

- **Exports:** `SpringbackInput`, `SpringbackResult`, `calculateSpringback`.
- **Material id:** uses `SheetMetalMaterial` from `sheetMetalTables.ts`
  (canonical).
- **Callers:** nothing yet imports it (greenfield; spec §1.4 says "keep
  the work").
- **Tests:** none.
- **Status:** **Keep**, no caller — wire in Week 4 / agent path.

#### `features/sheetMetalFlatPattern.ts` — 172 lines

- **Exports:** `BendDescriptor`, `FlatPatternResult` (different shape from
  `sheetMetal.ts`'s `FlatPatternResult`! — name collision intra-module),
  `bendAllowance`, `outsideSetback`, `bendDeduction`,
  `developFlatPattern`, `SpringbackInput`, `springbackFactor`,
  `overbendAngle`, `minimumFlangeLength`, `suggestVDie`,
  `CornerReliefSpec`, `suggestCornerRelief`.
- **Material id:** none — pure math, K-factor injected.
- **Callers:** `features/sheetMetalFlatPattern.test.ts` only.
- **Tests:** 155-line test, PASS.
- **Status:** **CANONICAL MATH.** Spec §1.4 keeps it verbatim.

#### `features/sheetMetalExtended.ts` — 256 lines

- **Exports:** `EdgeRef` (local — DIFFERENT shape from the spec's
  `EdgeRef` which adds `bodyId`), `EdgeFlangeSpec`, `EdgeFlangeReport`,
  `analyzeEdgeFlange`, `MiterFlangeSpec`, `MiterFlangeReport`,
  `analyzeMiterFlange`, plus tab+slot, louver, lance, dimple "analyze"
  helpers.
- **Material id:** none — uses K=0.4 literal placeholder.
- **Callers:** `features/sheetMetalExtended.test.ts`. NO production
  consumer.
- **Tests:** 158-line test, PASS.
- **Status:** **Draft.** Phase 2 spec §1.4 doesn't claim it — looks like a
  prototype layer that never got wired. Recommendation in plan.

---

### 1.2 `src/app/[lang]/shape-generator/sheetmetal/` (Wave 1.5 — engineering calculators)

18 files (17 modules + `index.ts`). Each is a Three.js / pure-math
*calculator*, lazy-loaded via `featureCatalog/featureLoaders.ts`. None
of these is part of the live modelling stack — they're "engineering
calculator" widgets surfaced through the calculator ribbon
(`ModelerRightPane.tsx`). Most have rich Vitest coverage.

| File | Lines | Exports (headline) | K-factor table author? | Test |
|---|---|---|---|---|
| `index.ts` | 17 | re-exports `sheetMetal.ts` API | — | n/a |
| `sheetMetal.ts` | 647 | `createSheetMetalBox`, `createBend`, `createFlange`, `createHem`, `unfold`, `createSheetFromProfile`, `SheetMetalParams`, `FlatPatternResult` (third name collision) | uses raw `kFactor` literal | indirect via callers |
| `kFactorTable.ts` | 131 | `lookupKFactor`, `bendAllowance`, `bendDeduction`, `KFactorQuery`, `KFactorResult`, `KFactorOverrides`, `SheetMetalMaterial` (DASHED ids — see §3) | **Y — DUPLICATE TABLE** | 84-line test |
| `bendDeductionCalculator.ts` | 162 | `K_FACTOR_TABLE`, `BendParams`, `MaterialName` ('mild-steel' / 'stainless-304' / 'aluminum-5052' / 'aluminum-6061' / 'copper' / 'brass'), `bendAllowance`, `bendDeduction`, `developFlatPattern`, `springback` table | **Y — THIRD TABLE** | 129-line test |
| `coiningCheck.ts` | 162 | `Material` (DASHED — yet another spelling), `assessCoining`, tonnage calc | uses local material table | 124-line test |
| `cornerBlend.ts` | 223 | `generateCornerBlend`, corner-fillet at two-bend intersections | none | 96-line test |
| `cornerReliefPlacer.ts` | 212 | `placeCornerRelief`, fits relief slot before bend forms | none | 98-line test |
| `cornerTrimAutoRounder.ts` | 233 | `roundCornerTrim`, fillet auto-suggest on blank outline | none | 88-line test |
| `flangeClearance.ts` | 231 | `analyseFlangeClearance`, neighbour-flange interference | none | 123-line test |
| `formingLimitDiagram.ts` | 160 | `evaluateFLD`, strain/failure prediction (FLD0) | none | 146-line test |
| `grainDirectionPlanner.ts` | 173 | `planGrainDirection`, grain-relative bend orientation | none | 94-line test |
| `grainFlowOptimizer.ts` | 176 | `optimizeGrainFlow`, nesting-level grain alignment | none | 99-line test |
| `gussetLibrary.ts` | 147 | parametric gusset library (T/L/triangle) | none | 75-line test |
| `hemStandards.ts` | 181 | catalogue of hem patterns (closed/open/teardrop/safety/wired) | none | 122-line test |
| `loftedBend.ts` | 153 | `LoftedBendInput`, `developLoft`, swept-bend devel | uses **dashed** `kFactorTable.ts` ids | 98-line test |
| `louverDirectionPicker.ts` | 189 | `pickLouverDirection`, airflow heuristic | none | 86-line test |
| `louverPattern.ts` | 193 | `generateLouverPattern`, grid of louvers | none | 117-line test |
| `punchLibrary.ts` | 169 | catalogue of standard punch shapes | none | 114-line test |

**Aggregate:** ~3 391 source lines + 1 678 test lines. Heavy.

**Production wiring:** 13 of these are referenced from
`featureCatalog/featureLoaders.ts` (lines 259–271) via lazy `import('../sheetmetal/...')`
keys (e.g. `sheet-metal.forming-limit-diagram`). They surface as cards
in the engineering-calculator ribbon. They DO NOT participate in the
modelling pipeline that produces / unfolds parts — they read inputs from
form widgets, emit warnings/numbers.

**ShapeGeneratorInner wiring:** ONE production import path:
`ShapeGeneratorInner.tsx:6581` lazy-imports `./sheetmetal/sheetMetal`
(NOT the features/ one) for `createSheetMetalBox` and `unfold`. So
`sheetmetal/sheetMetal.ts` *is in the user path* even though the spec
treats it as second-class.

---

### 1.3 `src/app/[lang]/shape-generator/sheet-metal/` (Wave 1.5 — niche dev features)

4 files, all matched to lazy-load keys at
`featureCatalog/featureLoaders.ts:272–275`.

| File | Lines | Exports | Material id flavour | Test |
|---|---|---|---|---|
| `coneDevelopment.ts` | 73 | `compute`, `apexHalfAngleDeg`, `summarize`, `ConeDevInput`, `ConeDevResult` | none (pure geometry) | 71-line test |
| `cornerOverlapRelief.ts` | 132 | `ReliefShape`, `BendDescriptor`, `CornerReliefInput`, `generateRelief` | none | 87-line test |
| `deepDraw.ts` | 84 | `compute`, `maxSingleDrawHeight`, `summarize`, `DeepDrawInput`, `DeepDrawResult` | none (takes UTS literal) | 71-line test |
| `jogBendDeveloper.ts` | 95 | `develop`, `JogBendInput`, `JogBendResult` | none (K-factor injected) | 97-line test |

**Aggregate:** 384 lines + 326 lines of tests.

**Why the second namespace exists at all:** these were authored later in a
Wave-1.5 "stamping/forming developer features" PR by someone who didn't
know about `sheetmetal/`. The dashed form is the more "correct" kebab
style. Production calls them only through the calculator loaders.

---

### 1.4 UI, bridge, DXF, agent — single instances

| File | Purpose | Lines | Imports |
|---|---|---|---|
| `SheetMetalPanel.tsx` | React panel for Bend/Flange/Unfold ops | 413 | `features/sheetMetal.ts` (via `FlatPatternPanel` dyn-import); local Korean dict |
| `_shell/sidebars/ModelerRightPane.tsx` | sidebar that surfaces engineering calculators (`sheet-metal/cam/mold/...`) | partial | dispatches to `featureLoaders.SHEET_METAL_LOADERS` |
| `analysis/flatPatternDrawing.ts` | `FlatPatternResult → DrawingLine[]` bridge for DXF/PDF | 125 | type from `features/sheetMetal.ts` |
| `io/dxfExporter.ts` (l. 175) | DXF emission of CUT / BEND_UP / BEND_DOWN layers | 1 import | type from `features/sheetMetal.ts` |
| `io/nfabFormat.ts` (l. 149-154) | persistence: `smMaterial`, `smThickness`, `smKFactorOverride` | 3 fields | comment references `sheetMetalTables` |
| `hooks/useNfabFileIO.ts` | reads/writes `smMaterial` round-trip | 2 sites | — |
| `lib/ai/scad-agent/tools.ts` (l. 1571–1590, registered l. 1960) | LLM tool `sheet_metal_unfold` | ≈ 20 lines | inlined math (no import — duplicates the BA formula with `kFactor=0.44` default) |
| `lib/ai/scad-agent/__tests__/sheetMetalUnfold.test.ts` | Vitest for the agent tool | ≈ 70 lines | — |
| `lib/ai/scad-agent/types.ts` | `SheetMetalUnfoldArgs` | ≈ 10 lines | — |
| `lib/ai/scad-agent/dfmGate.ts` | DFM rule that fires when `sheet_metal` features detected | — | string match |

---

### 1.5 Downstream consumers of the `FlatPatternResult` type

Single canonical `FlatPatternResult` shape (from `features/sheetMetal.ts`)
is referenced as type-only by 7 files:

```
estimation/rfqBundler.ts
estimation/quotePrinter.ts
estimation/CostPanel.tsx
estimation/CostEstimator.ts
analysis/flatPatternDrawing.ts
analysis/flatPatternDrawing.test.ts
io/dxfExporter.ts
```

`features/sheetMetal.ts` and `sheetmetal/sheetMetal.ts` BOTH export a
type named `FlatPatternResult` with overlapping but non-identical shape
(panel-level + bend-table version vs. mesh-only version). No file
imports the `sheetmetal/`-flavoured one as a type, but the runtime path
through `ShapeGeneratorInner.handleSheetMetal` returns a
`sheetmetal/`-flavoured value that's then re-shaped via
`{ geometry, edgeGeometry, volume_cm3, ... }`. So no type collision at
compile time, but a *semantic* divergence at runtime.

---

## 2. Material-id schema differences (the big mess)

Three independent material id schemas coexist. Each has a different
canonicalisation, a different label format, and a different K-curve.

### 2.1 Schema A — `features/sheetMetalTables.ts` (CANONICAL per spec)

camelCase, no prefix.

| id | labelKo |
|---|---|
| `mildSteel` | 연강 (SPCC) |
| `stainless304` | 스테인리스 STS304 |
| `aluminum5052` | 알루미늄 AL5052 |
| `aluminum6061` | 알루미늄 AL6061 |
| `galvanized` | 아연도금강판 (SGCC) |
| `brass` | 황동 C2680 |
| `copper` | 동판 C1100 |

7 entries. Spec §2.1 adds `stainless316` in Phase 2 (does not yet exist
in code).

### 2.2 Schema B — `sheetmetal/kFactorTable.ts`

Dashed, "material-grade-spec" form.

| id | (no localised label provided in this file) |
|---|---|
| `aluminum-5052` | — |
| `aluminum-6061` | — |
| `steel-cold-rolled` | — |
| `steel-stainless-304` | — |
| `steel-hot-rolled` | — |
| `copper-c110` | — |
| `brass-260` | — |

7 entries.

### 2.3 Schema C — `sheetmetal/bendDeductionCalculator.ts`

Dashed, "common name" form (yet another spelling).

| id |
|---|
| `mild-steel` |
| `stainless-304` |
| `aluminum-5052` |
| `aluminum-6061` |
| `copper` |
| `brass` |

6 entries. Note: `aluminum-5052` overlaps with Schema B; `copper` /
`brass` overlap with Schema A; `mild-steel` is C-only; `stainless-304`
is also in C. No 1-1 mapping to either A or B.

### 2.4 Schema D — `sheetmetal/coiningCheck.ts`

Sub-schema of C. 5 entries:
`mild-steel | stainless-304 | aluminum-5052 | aluminum-6061 | copper-c110`
(borrows the `copper-c110` form from B — internally inconsistent within
the `sheetmetal/` folder).

### 2.5 Set difference (A canonical vs B+C+D)

- **In A only:** `galvanized` (SGCC — Korean-shop dominant), `mildSteel`
  (vs B's `steel-cold-rolled` + `steel-hot-rolled`, and C's `mild-steel`).
- **In B only:** `steel-hot-rolled`, `steel-cold-rolled` split (A folds
  both into `mildSteel`).
- **In C only:** the `*-` dashed common-name form.
- **Coverage gap to fix:** B and C lack `galvanized`. Galvanized is the
  #1 SGCC sheet on Korean laser-cut quotes — losing it would break the
  RFQ pricebook.

### 2.6 K-value variance (R/t = 1.0 reference point)

| Material | A: features (canonical) | B: sheetmetal/kFactor | C: sheetmetal/bendDed |
|---|---|---|---|
| Mild / cold-rolled steel | 0.42 | 0.41 | 0.44 |
| Stainless 304 | 0.38 | 0.40 | 0.40 |
| Aluminum 5052 | 0.43 | 0.38 | 0.43 |
| Aluminum 6061 | 0.40 | 0.40 | 0.40 |
| Copper | 0.45 | 0.37 | 0.42 |
| Brass | 0.45 | 0.39 | 0.42 |

Spread: up to **±0.07** between the three tables at the same operating
point — material enough to change unfold by 1–2 mm on a 100 mm bend at
R = t. Spec §4.1 docs Schema A as canonical; B & C are wrong relative to
that anchor by 5–17 %.

### 2.7 Korean label consistency

- Schema A: **every** material has `labelKo` + `labelEn`.
- Schema B: NO labels (machine-name only).
- Schema C: `name` field with English-only ("Mild Steel" etc.).
- `SheetMetalPanel.tsx` dict: has `bendAngle/굽힘 각도` etc. but the
  material name strings come from `paramSheetMaterial` labels in
  `sheetMetal.ts` via `sheetMetalMat_${id}` i18n keys, which then look
  up the labels in `shapeDict.ts`. Net: A's ids are wired to Korean
  labels through the feature catalog; B and C have no localised UI.

### 2.8 Agent / RFQ surface

- `sheet_metal_unfold` (LLM tool) hard-codes `K = 0.44` default. Not
  driven by any table at all. Treats material as opaque.
- `nfabFormat.smMaterial` is `string` — accepts ALL three schemas
  without validation; consumers must guess.
- `partner-pricebook.ts` / `stampingCost.ts` consume sheet-metal
  metadata loosely (string lookup, fallback on unknown).

---

## 3. Test coverage map

| Module | Test file | LOC | Passing? | Coverage style |
|---|---|---|---|---|
| `features/sheetMetal.ts` | `features/sheetMetal.test.ts` | 187 | ✔ | applyBend / applyFlange / generateFlatPattern smoke + numeric |
| `features/sheetMetalTables.ts` | `features/sheetMetalTables.test.ts` | 153 | ✔ | K-interp, bend allowance, validation |
| `features/sheetMetalFlatPattern.ts` | `features/sheetMetalFlatPattern.test.ts` | 155 | ✔ | developFlatPattern, springback factor |
| `features/sheetMetalExtended.ts` | `features/sheetMetalExtended.test.ts` | 158 | ✔ | analyseEdgeFlange / miter / louver / lance |
| `features/sheetMetalSpringback.ts` | — | — | — | NO TEST |
| `sheetmetal/kFactorTable.ts` | `sheetmetal/kFactorTable.test.ts` | 84 | ✔ | lookup, extrap, overrides |
| `sheetmetal/bendDeductionCalculator.ts` | `*.test.ts` | 129 | ✔ | BA / BD / chain + springback |
| `sheetmetal/coiningCheck.ts` | `*.test.ts` | 124 | ✔ | tonnage + min-r |
| `sheetmetal/cornerBlend.ts` | `*.test.ts` | 96 | ✔ | corner fillet |
| `sheetmetal/cornerReliefPlacer.ts` | `*.test.ts` | 98 | ✔ | relief slot |
| `sheetmetal/cornerTrimAutoRounder.ts` | `*.test.ts` | 88 | ✔ | trim auto |
| `sheetmetal/flangeClearance.ts` | `*.test.ts` | 123 | ✔ | clearance |
| `sheetmetal/formingLimitDiagram.ts` | `*.test.ts` | 146 | ✔ | FLD eval |
| `sheetmetal/grainDirectionPlanner.ts` | `*.test.ts` | 94 | ✔ | orientation |
| `sheetmetal/grainFlowOptimizer.ts` | `*.test.ts` | 99 | ✔ | nesting |
| `sheetmetal/gussetLibrary.ts` | `*.test.ts` | 75 | ✔ | catalogue |
| `sheetmetal/hemStandards.ts` | `*.test.ts` | 122 | ✔ | catalogue |
| `sheetmetal/loftedBend.ts` | `*.test.ts` | 98 | ✔ | loft devel |
| `sheetmetal/louverDirectionPicker.ts` | `*.test.ts` | 86 | ✔ | airflow heuristic |
| `sheetmetal/louverPattern.ts` | `*.test.ts` | 117 | ✔ | grid generator |
| `sheetmetal/punchLibrary.ts` | `*.test.ts` | 114 | ✔ | catalogue |
| `sheetmetal/sheetMetal.ts` (Wave 1 box) | — | — | — | NO TEST (the only file in `sheetmetal/` without a sibling test) |
| `sheet-metal/coneDevelopment.ts` | `*.test.ts` | 71 | ✔ | flat dev numerics |
| `sheet-metal/cornerOverlapRelief.ts` | `*.test.ts` | 87 | ✔ | relief shapes |
| `sheet-metal/deepDraw.ts` | `*.test.ts` | 71 | ✔ | blank dia + force |
| `sheet-metal/jogBendDeveloper.ts` | `*.test.ts` | 97 | ✔ | flat length + min offset |
| `lib/ai/scad-agent/tools.ts::sheet_metal_unfold` | `__tests__/sheetMetalUnfold.test.ts` | ≈ 70 | ✔ | unfold contract |
| `SheetMetalPanel.tsx` | — | — | — | NO UI TEST |
| `analysis/flatPatternDrawing.ts` | `analysis/flatPatternDrawing.test.ts` | small | ✔ | bridge to DrawingLine |

**Score:** 25 of 30 source files have tests (83 %). Untested files are
`features/sheetMetalSpringback.ts`, `sheetmetal/sheetMetal.ts` (Wave 1
box generator — the *production* user-facing entry!), `SheetMetalPanel.tsx`,
and two minor bridges. These are the *most consequential* untested
units in the surface area.

---

## 4. Bend-allowance table parity check

### 4.1 K-curve sample at R/t = 1.0, mildSteel / steel-cold-rolled / mild-steel

- **A (features/sheetMetalTables.ts):** 0.42 (canonical)
- **B (sheetmetal/kFactorTable.ts → `steel-cold-rolled`):** 0.41
- **C (sheetmetal/bendDeductionCalculator.ts → `mild-steel`):** 0.44

Difference at R/t = 1: 0.03 → for a 90° bend at R = 1.5 mm, t = 1.5 mm:
- BA(K=0.42) = 3.346 mm (spec §4.2 worked example)
- BA(K=0.41) = 3.311 mm  (Δ = −0.035 mm)
- BA(K=0.44) = 3.417 mm  (Δ = +0.071 mm)

On a 5-bend hat section this stacks to **≈ ±0.4 mm flat-blank drift** — at
or past the spec's tolerance gate (§7.6: ±0.1 mm unfold accuracy).

### 4.2 K-curve at R/t = 2.0

- A: 0.44 (mildSteel)
- B: 0.45 (steel-cold-rolled)
- C: 0.44 (mild-steel, table only stores one K per material — no R/t curve)

Schema C is **non-curved** (single K per material) — it cannot match A
or B beyond the one operating point. This is a structural mismatch, not
a tuning drift; consolidating C means promoting it to a curve table or
deleting it.

### 4.3 Springback table parity

- `features/sheetMetalSpringback.ts` — table keyed by Schema A
  (camelCase). Roark-style formula, empirical factor per material.
- `sheetmetal/bendDeductionCalculator.ts` — has a `SPRINGBACK_DEG`
  constant keyed by Schema C (dashed). Single-number, no formula.
- The Phase 2 spec §4.5 cites a third table (worker contract) keyed by
  Schema A — identical values to `features/sheetMetalSpringback.ts`.

Recommendation in plan: drop Schema C's springback table, keep A.

### 4.4 Korean label consistency

- A: every material has `labelKo` matching KS standard names. ✔
- B: no labels.
- C: no labels.
- D (`coiningCheck.Material`): `name` is English-only ("Aluminum 5052").

Only Schema A is shippable to a Korean partner UI today. B and C would
need a label layer added — which we don't want to maintain three of.

---

## 5. Call-site dependency graph (compact)

```
                       ShapeGeneratorInner.tsx
                       │
        ┌──────────────┼──────────────────────────────┐
        ▼              ▼                              ▼
features/sheetMetal   sheetmetal/sheetMetal      SheetMetalPanel.tsx
   .ts (V1 prod)         .ts (V1 prod)               │
        │                     │                      │
        │                     │                      ▼
        │                     │              features/FlatPatternPanel
        │                     │                      │
        ▼                     ▼                      ▼
features/sheetMetalTables.ts  (no shared table)    features/sheetMetal.ts
        │                            │
        │ ◀───── canonical ─────────┘
        ▼
features/sheetMetalFlatPattern.ts (math)
        │
        ▼
analysis/flatPatternDrawing.ts ──▶  io/dxfExporter.ts
                                 │
                                 ▼
                       estimation/*.ts ▶ partner-pricebook.ts


featureCatalog/featureLoaders.ts
        │
        ├──▶ sheetmetal/*.ts (13 calculators)
        └──▶ sheet-metal/*.ts (4 calculators)
        (lazy-loaded, ribbon-driven)


lib/ai/scad-agent/tools.ts::sheet_metal_unfold  (inlined math, K=0.44)
lib/ai/scad-agent/dfmGate.ts                    (string-pattern match)
```

Crucial observation: the modelling pipeline uses **features/** for
bend/flange/unfold MATH but **sheetmetal/** for the `createSheetMetalBox`
shape and the higher-level `unfold` op. These two folders are *both*
on the user's hot path even though the spec implies only `features/`
is. A consolidation that deletes `sheetmetal/sheetMetal.ts` blindly will
break Sheet Metal → Box and Sheet Metal → Unfold in
`ShapeGeneratorInner.handleSheetMetal`.

---

## 6. Risk-relevant facts (carried over to consolidation plan)

1. **Two `unfold` implementations.** `features/sheetMetal.generateFlatPattern`
   and `sheetmetal/sheetMetal.unfold` are NOT the same algorithm. The
   panel uses the former; `ShapeGeneratorInner.tsx:6589` calls the
   latter. Either has different behaviour or is dead code in production.
2. **Type name collision.** Three `FlatPatternResult` types coexist
   (`features/sheetMetal.ts`, `features/sheetMetalFlatPattern.ts`,
   `sheetmetal/sheetMetal.ts`) — shape differs in each. The
   downstream type-only imports all bind to the `features/sheetMetal`
   one; the runtime values flowing through `sheetmetal/` paths get
   *manually re-shaped* in `ShapeGeneratorInner`. Refactor target.
3. **Three material id schemas, all in production.** A is referenced
   by `smMaterial` (persistence). B is referenced by `loftedBend.ts`. C
   is referenced by `bendDeductionCalculator.ts` and `coiningCheck.ts`,
   both of which are visible engineering-calculator widgets. Deleting
   B or C without a migration layer will break ribbon calculators.
4. **`sheetmetal/sheetMetal.ts` has NO test.** It is the production
   path for the `Sheet Metal → Box` user button, yet untested. Adding a
   smoke test before consolidating is one half-day's work and prevents
   regression on the most exposed surface.
5. **The agent tool re-implements the BA formula.** Hard-coded K=0.44.
   If we canonicalise on Schema A's curve, the agent tool's results
   drift from the panel by up to 5 % depending on R/t. Wave 2 should
   route the agent through `getKFactor()` from `sheetMetalTables.ts`.

---

**End of asset map.** Action items in
`docs/wave-2-sheet-metal-consolidation-plan.md`.
