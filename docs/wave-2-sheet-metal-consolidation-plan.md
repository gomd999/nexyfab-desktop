# Wave 2 — Sheet-Metal Consolidation Plan

**Status:** plan, not implementation. Read-only audit complete in
`wave-2-sheet-metal-asset-map.md`.
**Owner:** Wave 2 Phase 1 Week 4 prep for Phase 2 Week 1.
**Date:** 2026-05-28.
**Goal:** unify the three sheet-metal namespaces, the three material id
schemas, and the two duplicate K-factor tables — without breaking the
`.nfab` round-trip, the partner pricebook, the agent tool, or the
existing calculator ribbon. The deliverable of this plan is a *set of
PR-sized changes* that the Phase 2 Week 1 owner can execute deterministically.

---

## 1. Canonical namespace — decisions

### 1.1 Folder canon

**Decision:** **`features/` is the canonical home** for the
*modelling-pipeline* sheet-metal code (BendParams, applyBend,
applyFlange, applyHem, applyJog, generateFlatPattern, the catalogue of
material info + K curves, springback, flat-pattern math). This matches
the Phase 2 spec §1.4 and §2.1 declaration that `features/sheetMetalTables.ts`
is canonical, and it keeps the existing `FlatPatternResult` type binding
that 7 downstream files (RFQ, DXF, cost, drawing) already import.

**Decision:** **`sheetmetal/` becomes a calculator-only namespace.** It
stays — these are useful engineering-calculator widgets, wired through
`featureCatalog/featureLoaders.ts`. We do NOT fold them into `features/`
because they are not part of the modelling pipeline and they form a
recognisable category in the calculator ribbon.

**Decision:** **`sheet-metal/` (the dashed sibling) is folded into
`sheetmetal/`.** Four files only; they are categorically the same as the
13 already-in-`sheetmetal/` calculators. Two sibling folders for the
same concept is unnecessary friction. Pick the existing larger folder
to minimise refactor cost.

**Decision:** **`sheetmetal/sheetMetal.ts` (Wave 1 "createSheetMetalBox /
unfold" mesh-level entry) is moved to `features/sheetMetalBox.ts`**
(new file) — it belongs with the modelling pipeline, not the calculator
ribbon. Its API surface (`createSheetMetalBox`, `unfold`,
`createSheetFromProfile`) overlaps the spec's `baseFlange` op so it
becomes the Phase 2 V1 fallback the spec describes ("keep the mesh path
as a fallback during transition").

### 1.2 Material-id canon

**Decision:** **Schema A (`features/sheetMetalTables.ts` camelCase ids)
is canonical.** Locked by the Phase 2 spec §2.1 and by the `.nfab`
persistence (`smMaterial: string` — existing field, in-the-wild projects
use Schema A keys).

- `mildSteel | stainless304 | stainless316 | aluminum5052 | aluminum6061
  | galvanized | brass | copper`
- Phase 2 adds `stainless316`.
- Schema B (`steel-cold-rolled` etc.) and Schema C (`mild-steel` etc.)
  are deprecated and removed in two passes (alias-then-delete) — see §3.

### 1.3 K-factor table canon

**Decision:** **`features/sheetMetalTables.ts::SHEET_METAL_MATERIALS` is
the only K-curve table.** It already ships per-material 5-point R/t
curves, Korean labels, KS spec ids in labels, and validation. It's the
most complete table by a wide margin.

- `sheetmetal/kFactorTable.ts` is deleted *after* its one consumer
  (`sheetmetal/loftedBend.ts`) is migrated to call
  `getKFactor()` from `sheetMetalTables.ts`.
- `sheetmetal/bendDeductionCalculator.ts::K_FACTOR_TABLE` and
  `::SPRINGBACK_DEG` constants are deleted; the file is rewritten to
  call into `sheetMetalTables` + `sheetMetalSpringback`. Public function
  signatures keep their existing shapes so calculator-ribbon callers
  don't break.

### 1.4 Springback canon

**Decision:** `features/sheetMetalSpringback.ts` is canonical. It has
the Roark formula + per-material yield/modulus + empirical factor —
strictly more information than the static degree table in
`bendDeductionCalculator.ts`. The latter's static table goes; calls are
rewritten to invoke `calculateSpringback()`.

### 1.5 `FlatPatternResult` collision resolution

Three same-named types today. Plan:

- **Canonical:** the one in `features/sheetMetal.ts` (the panel/cost
  pipeline already uses this shape).
- **Rename** `features/sheetMetalFlatPattern.ts::FlatPatternResult` →
  `FlatPatternMathResult` (it's a different concept — math-only, no
  geometry).
- **Delete** `sheetmetal/sheetMetal.ts::FlatPatternResult` after that
  file moves to `features/sheetMetalBox.ts`; its callsite in
  `ShapeGeneratorInner.tsx` re-shapes the return value into a
  `ShapeResult` anyway, so the type doesn't need to be re-exported
  through the new home.

---

## 2. File-by-file action

### 2.1 Files in `features/`

| File | Action | Notes |
|---|---|---|
| `features/sheetMetal.ts` | **KEEP** | Canonical V1 modelling layer. No changes during consolidation. Phase 2 introduces a V2 alongside it. |
| `features/sheetMetalTables.ts` | **KEEP** + **EXTEND** | Add `stainless316` entry (Phase 2 spec §2.1). |
| `features/sheetMetalSpringback.ts` | **KEEP** + add unit test | Currently zero tests; add one before any caller migrates onto it. |
| `features/sheetMetalFlatPattern.ts` | **KEEP** + **RENAME TYPE** | `FlatPatternResult` → `FlatPatternMathResult`. Pure math, no breakage. |
| `features/sheetMetalExtended.ts` | **HOLD** (no action this cycle) | Untested by production callers — it's an analysis-only library. Phase 2 may promote its `EdgeRef` type to canonical EdgeRef (spec §2.1). Decide at Phase 2 Week 2. |

### 2.2 Files in `sheetmetal/` (calculators — namespace stays)

| File | Action | Notes |
|---|---|---|
| `sheetmetal/index.ts` | **REWRITE** | After `sheetMetal.ts` moves out, this file's re-exports change. New role: re-export the calculator surface (kFactorTable, hemStandards, punchLibrary, etc.) but ONLY public calculator types. |
| `sheetmetal/sheetMetal.ts` | **MOVE** → `features/sheetMetalBox.ts` | Used by `ShapeGeneratorInner.tsx:6581`. Update import path. Adds smoke test in the move. |
| `sheetmetal/kFactorTable.ts` | **DELETE** | After `loftedBend.ts` migrates. See §3 for the migration ladder. |
| `sheetmetal/kFactorTable.test.ts` | **MERGE** into `features/sheetMetalTables.test.ts` | Tests asserting K interpolation behaviour — keep the assertions, recast to Schema A. |
| `sheetmetal/bendDeductionCalculator.ts` | **REWRITE INTERNALS** | Keep the public functions; gut the local K + springback constants; route to `sheetMetalTables.getKFactor` and `sheetMetalSpringback.calculateSpringback`. |
| `sheetmetal/bendDeductionCalculator.test.ts` | **KEEP** (tests should still pass post-rewrite) | Add 1 regression test verifying the routed K matches the canonical table. |
| `sheetmetal/coiningCheck.ts` | **REWRITE** local `Material` type | Replace `'mild-steel' | 'stainless-304' | …` with `import type { SheetMetalMaterial }` from `features/sheetMetalTables`. Keep coining-specific UTS data in a sibling map keyed by Schema A. |
| `sheetmetal/coiningCheck.test.ts` | **KEEP** | rename material ids in test inputs. |
| `sheetmetal/cornerBlend.ts` | **KEEP** | Self-contained, no material refs. |
| `sheetmetal/cornerReliefPlacer.ts` | **KEEP** | Self-contained. |
| `sheetmetal/cornerTrimAutoRounder.ts` | **KEEP** | Self-contained. |
| `sheetmetal/flangeClearance.ts` | **KEEP** | Self-contained. |
| `sheetmetal/formingLimitDiagram.ts` | **KEEP** + add `// experimental` JSDoc banner | Spec §9.3: "real FEA belongs in simulation". Marking it experimental, no deletion. |
| `sheetmetal/grainDirectionPlanner.ts` | **KEEP** | Self-contained. |
| `sheetmetal/grainFlowOptimizer.ts` | **KEEP** | Self-contained. |
| `sheetmetal/gussetLibrary.ts` | **KEEP** | Self-contained. |
| `sheetmetal/hemStandards.ts` | **KEEP** | Standards catalogue, no K coupling. |
| `sheetmetal/loftedBend.ts` | **REWRITE IMPORT** | Change `from './kFactorTable'` to `from '../features/sheetMetalTables'` + map old ids to new. |
| `sheetmetal/loftedBend.test.ts` | **KEEP** | Test fixtures may need the id mapping in inputs. |
| `sheetmetal/louverDirectionPicker.ts` | **KEEP** | Self-contained. |
| `sheetmetal/louverPattern.ts` | **KEEP** | Self-contained. |
| `sheetmetal/punchLibrary.ts` | **KEEP** | Catalogue, no K coupling. |

### 2.3 Files in `sheet-metal/` (dashed sibling — folder dies)

| File | Action | Notes |
|---|---|---|
| `sheet-metal/coneDevelopment.ts` | **MOVE** → `sheetmetal/coneDevelopment.ts` | Update `featureCatalog/featureLoaders.ts` import path. |
| `sheet-metal/coneDevelopment.test.ts` | **MOVE** sibling | Same. |
| `sheet-metal/cornerOverlapRelief.ts` | **MOVE** → `sheetmetal/cornerOverlapRelief.ts` | Beware: `sheetmetal/cornerReliefPlacer.ts` is a related but different file. Keep both; the names are distinct. Update loader. |
| `sheet-metal/cornerOverlapRelief.test.ts` | **MOVE** sibling | Same. |
| `sheet-metal/deepDraw.ts` | **MOVE** → `sheetmetal/deepDraw.ts` + add `// experimental` JSDoc | Spec §9.2 defers deep draw to Wave 3. Keep as a dev preview. |
| `sheet-metal/deepDraw.test.ts` | **MOVE** sibling | Same. |
| `sheet-metal/jogBendDeveloper.ts` | **MOVE** → `sheetmetal/jogBendDeveloper.ts` | Update loader. Note: this overlaps `features/sheetMetal.applyJog` conceptually but only at the math level (this file is dev-flat-pattern only). Both keep. |
| `sheet-metal/jogBendDeveloper.test.ts` | **MOVE** sibling | Same. |
| folder `sheet-metal/` | **DELETE** when empty | Final step. |

### 2.4 Single-instance files (UI, bridges, agent)

| File | Action |
|---|---|
| `SheetMetalPanel.tsx` | **KEEP**, no Phase 1 change. Phase 2 Week 4 adds the new right-pane property block per spec §6.3. |
| `_shell/sidebars/ModelerRightPane.tsx` | **KEEP**. Update `SHEET_METAL_LOADERS` keys if any rename happens (none planned). |
| `analysis/flatPatternDrawing.ts` | **KEEP**. Type-only import already binds to canonical. |
| `io/dxfExporter.ts` | **KEEP**. Same. |
| `io/nfabFormat.ts` | **KEEP** + comment refresh. `smMaterial` already accepts Schema A; add a docstring noting the deprecated-aliases set. |
| `hooks/useNfabFileIO.ts` | **PATCH** load path: when reading `smMaterial`, run it through the migration alias (§3.2). Saving always emits Schema A. |
| `lib/ai/scad-agent/tools.ts` | **REWIRE** `sheet_metal_unfold` to use `features/sheetMetalTables.getKFactor` instead of the hard-coded `K=0.44`. Keep tool signature unchanged. |
| `lib/ai/scad-agent/__tests__/sheetMetalUnfold.test.ts` | **EXTEND** with a K-by-material assertion. |
| `lib/ai/scad-agent/types.ts` | **KEEP** + add `material?: SheetMetalMaterial` to `SheetMetalUnfoldArgs`. |
| `lib/ai/scad-agent/dfmGate.ts` | **KEEP**. Pattern match doesn't depend on consolidation. |

### 2.5 Catalog wiring

| File | Action |
|---|---|
| `featureCatalog/featureLoaders.ts` | **PATCH** lines 272–275: `'sheet-metal.*'` keys point to `../sheetmetal/...` after the move. Lines 259–271 are already correct, no change. The keys themselves stay `sheet-metal.*` (kebab) because the calculator registry keys are public-facing identifiers; renaming would invalidate user-saved ribbon layouts. |
| `featureCatalog/registry.ts` | **PATCH** 4 `entryHint: 'sheet-metal/...'` strings to `'sheetmetal/...'` (lines 4320, 4664, 5360, 5392). These are debug hints, no runtime impact. |

---

## 3. Material-id migration strategy

### 3.1 Goal

Schema B and Schema C disappear from source. `.nfab` files saved before
this change continue loading; the runtime never sees a Schema B/C string
again after the load step.

### 3.2 Alias map (one-way, run once on load)

Lives in **new file** `src/lib/migrations/sheetMetalMaterialId.ts`:

```ts
import type { SheetMetalMaterial } from '@/app/[lang]/shape-generator/features/sheetMetalTables';

const ALIASES: Record<string, SheetMetalMaterial> = {
  // Schema B → A
  'steel-cold-rolled':   'mildSteel',
  'steel-hot-rolled':    'mildSteel',       // both fold to mildSteel
  'steel-stainless-304': 'stainless304',
  'aluminum-5052':       'aluminum5052',
  'aluminum-6061':       'aluminum6061',
  'copper-c110':         'copper',
  'brass-260':           'brass',
  // Schema C → A
  'mild-steel':          'mildSteel',
  'stainless-304':       'stainless304',
  // copper, brass already match A's spelling
};

export function normalizeSheetMetalId(raw: string | undefined | null): SheetMetalMaterial {
  if (!raw) return 'mildSteel';
  if (raw in SHEET_METAL_MATERIALS) return raw as SheetMetalMaterial;
  if (raw in ALIASES) return ALIASES[raw]!;
  return 'mildSteel';   // fallback + log
}
```

### 3.3 Insertion points

- `hooks/useNfabFileIO.ts:413` — wrap the `setMfgSmMaterial(m.smMaterial)`
  with `setMfgSmMaterial(normalizeSheetMetalId(m.smMaterial))`.
- `lib/ai/scad-agent/tools.ts::sheet_metal_unfold` — same wrapper on the
  optional `material` arg.
- All public function entry points in `sheetmetal/bendDeductionCalculator.ts`,
  `sheetmetal/coiningCheck.ts`, `sheetmetal/loftedBend.ts` accept
  *either* schema in the input (`string`), normalize at top, work in
  Schema A internally.

### 3.4 Galvanized (SGCC) coverage gap

Schema B and C don't have galvanized. Schema A does. Net effect of
consolidating onto A: **calculators that today silently break for SGCC
will start working** (they'd previously coerced SGCC inputs to some
fallback). No regression risk in the other direction.

### 3.5 Codemod sketch

A single `ts-morph` script can do most of the work:

```
$ pnpm dlx ts-morph-cli run scripts/codemods/sheet-metal-material-ids.ts
```

Per-file rules:
1. Replace `import { ... } from './kFactorTable'` →
   `import { ... } from '../features/sheetMetalTables'`.
2. Replace string literal `'steel-cold-rolled'` → `'mildSteel'` (etc.),
   constrained to occurrences within sheet-metal files.
3. Replace `import * from '../sheet-metal/<X>'` →
   `import * from '../sheetmetal/<X>'`.

Estimated codemod scope: < 25 occurrences across the affected files.
Most of them are inside `sheetmetal/loftedBend.ts`, `coiningCheck.ts`,
`bendDeductionCalculator.ts`, their tests, and the 4 calculator-ribbon
keys.

### 3.6 Backwards compatibility window

- v0: Schemas A/B/C coexist. (Today.)
- v1: After consolidation PR — only Schema A in code. Loader aliases B/C
  → A. Old `.nfab` files round-trip. Agent / RFQ output emits Schema A.
- v2: 60 days after v1 ships, alias map can shrink (we log alias hits;
  if hit-count = 0 for 60 days, delete the entry). The alias FILE stays
  permanently as a "1-2 entries" safety net for very old project JSONs.

---

## 4. Import-path migration steps

A clean execution order so each step compiles green before the next.

**Step 1.** Add `stainless316` entry to `features/sheetMetalTables.ts`
(non-breaking — adds a key, no consumer breaks).

**Step 2.** Write `src/lib/migrations/sheetMetalMaterialId.ts` (new
file, no consumer yet). Unit-test it.

**Step 3.** Move `sheetmetal/sheetMetal.ts` →
`features/sheetMetalBox.ts`.
- Update `sheetmetal/index.ts` re-export.
- Update `ShapeGeneratorInner.tsx:6581` import path.
- Add a missing smoke test (`features/sheetMetalBox.test.ts`).

**Step 4.** Rewrite `sheetmetal/loftedBend.ts` to import K-factor from
`features/sheetMetalTables`. Adjust its public type signature (still
accepts material id string; alias-normalises internally).

**Step 5.** Delete `sheetmetal/kFactorTable.ts` + merge its test
assertions into `features/sheetMetalTables.test.ts`. (The functions
`lookupKFactor` / `bendAllowance` / `bendDeduction` in kFactorTable.ts
have direct equivalents in sheetMetalTables.ts; the only difference is
the K-curve shape, which we keep canonical from A.)

**Step 6.** Rewrite `sheetmetal/bendDeductionCalculator.ts` internals
to route through `features/sheetMetalTables.getKFactor` and
`features/sheetMetalSpringback.calculateSpringback`. Keep public API
shape.

**Step 7.** Rewrite `sheetmetal/coiningCheck.ts` to import
`SheetMetalMaterial` from `features/sheetMetalTables`. Replace local
material table with a *coining-specific* UTS table keyed by Schema A.

**Step 8.** Move 4 files from `sheet-metal/` → `sheetmetal/`.
- Patch `featureCatalog/featureLoaders.ts` lines 272–275 import paths.
- Patch `featureCatalog/registry.ts` `entryHint` debug strings.
- Delete empty `sheet-metal/` folder.

**Step 9.** Wire `normalizeSheetMetalId` into
`hooks/useNfabFileIO.ts:413` and `lib/ai/scad-agent/tools.ts::sheet_metal_unfold`.

**Step 10.** Rename `features/sheetMetalFlatPattern.ts::FlatPatternResult`
→ `FlatPatternMathResult`. (Internal only — no external consumer.)

**Step 11.** Run `pnpm test` + `pnpm tsc --noEmit`. Goal: clean.

Each step is independently mergeable (PR-sized). Steps 1, 2, 8, 10 are
truly independent; 3-7 share `loftedBend` / `coiningCheck` / `bendDed`;
9 depends on 2.

---

## 5. Test preservation strategy

### 5.1 Hard rules

1. **No test gets deleted.** Tests merge or move, but the assertions
   stay.
2. **Every move keeps the test file alongside its source file** in the
   target folder.
3. **Adding a test is allowed.** Subtracting one is a code-review
   blocker.

### 5.2 Per-step test impact

| Step | Tests touched | How |
|---|---|---|
| 1 | `features/sheetMetalTables.test.ts` | +1 test for stainless316. |
| 2 | new `lib/migrations/sheetMetalMaterialId.test.ts` | New file. |
| 3 | move `sheetmetal/sheetMetal*.test.ts` (does not exist today) | ADD a new smoke test. |
| 4 | `sheetmetal/loftedBend.test.ts` | Update material id literals in test inputs. |
| 5 | `sheetmetal/kFactorTable.test.ts` | Merge into `features/sheetMetalTables.test.ts`. Recast material ids. |
| 6 | `sheetmetal/bendDeductionCalculator.test.ts` | Should still pass after internal rewrite — no fixture change. |
| 7 | `sheetmetal/coiningCheck.test.ts` | Update material id literals. |
| 8 | `sheet-metal/*.test.ts` (4 files) | Move alongside the source. |
| 9 | `lib/ai/scad-agent/__tests__/sheetMetalUnfold.test.ts` | +1 K-by-material test. |
| 10 | none directly — rename is internal | — |

### 5.3 Coverage goal

Pre-consolidation: 25/30 source files have tests (83 %).
Post-consolidation: target 27/29 (`features/sheetMetalBox.ts` added,
`SheetMetalPanel.tsx` still untested, `sheetMetalExtended.ts` still
untested — both untouched).

---

## 6. Risk register

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | `ShapeGeneratorInner.tsx:6581` import path break (Sheet Metal → Box, → Unfold) | M (single-line change easy to miss) | H (user-facing button) | Step 3 ships with end-to-end Playwright smoke (`e2e/shape-generator/sheet-metal-box.spec.ts` — new). |
| R2 | `.nfab` files with Schema B/C `smMaterial` start loading as `mildSteel` fallback (silent material change) | M | M | The migration alias must run BEFORE the legacy fallback. Log every alias hit to Sentry breadcrumb for 30 days; review before deleting B/C from alias map. |
| R3 | Partner pricebook (`partner-pricebook.ts`) parses material strings from quote requests; if a partner integration sends Schema B/C, it now goes through the normaliser silently | L | M | Add an integration test fixture using each schema, assert quote output is identical post-consolidation. |
| R4 | K-value drift: any saved unfold result computed against Schema B/C now uses Schema A's K — flat-blank lengths shift ≤ 5 % | M (any project that touched bendDeductionCalculator or loftedBend) | M | Notify users via release notes; the `derived.flatLengthMm` is recomputed on load, so the next save is consistent. |
| R5 | Calculator ribbon `entryHint` strings (`sheet-metal/...`) referenced in tests / docs / UI tooltips | L | L | Step 8 includes a grep for stragglers. `entryHint` is a debug field — UI doesn't render it. |
| R6 | `features/sheetMetalFlatPattern.FlatPatternResult` rename breaks an external import we missed | L | L | The rename is internal — `Grep` confirms only the test file references it; no other consumer today. |
| R7 | `coiningCheck.test.ts` parity after material id rename | M | L | Bring the test green before merging step 7. |
| R8 | Agent tool API breaking change (existing prompt examples) | L | M | Keep `sheet_metal_unfold` signature unchanged; `material` becomes OPTIONAL. Default behaviour identical to today. |
| R9 | Phase 2 spec §2.1 demands an EdgeRef shape that `features/sheetMetalExtended.ts` already half-defines under a different shape | M | M | Defer the EdgeRef unification to Phase 2 Week 2 (NOT part of this consolidation). |
| R10 | `formingLimitDiagram.ts` marked experimental — engineering-calculator users currently use it on real projects | L | M | "Experimental" banner is JSDoc only; ribbon entry stays live. No behaviour change. |

---

## 7. Phase 2 Week 1 feasibility

### 7.1 Scope of the proposed consolidation

- ~30 files touched.
- 11 atomic steps.
- Each step is 0.5–2 hours of focused work + tests, except step 3
  (file move + new smoke test, ~3 hours) and step 6 (internal rewrite,
  ~3 hours).
- Net: **estimated 20-25 engineering-hours** to land the consolidation,
  test-green at every step.

### 7.2 Phase 2 Week 1 commitments (from the spec §8)

Spec Phase 2 Week 1 is *already* committed to:
- Land `occt-worker/src/sheetmetal/baseFlange.ts` (NEW worker code).
- Land `occt-worker/src/sheetmetal/bend.ts` (NEW worker code).
- Wire `/occt/op/sheetmetal/baseFlange` and `/bend` routes.
- Add `SheetMetalPart` type on the client.
- F-SM-01 fixture (L-bracket) green.

That is itself ~3–5 person-days of work, *and it depends on the
occt-worker `src/` directory materialising* (spec §1.2 flags this as
not-yet-in-checkout).

### 7.3 Verdict: Can the consolidation fit in Phase 2 Week 1?

**Verdict: NO — at full scope. YES — for a critical-path subset.**

#### Reasoning

- Phase 2 Week 1 is already booked for the worker-side baseFlange + bend
  ops + the F-SM-01 fixture (≥ 3 person-days). Adding 20-25 hours of
  consolidation work doubles the week.
- The consolidation depends on writing 1 new file (migration alias),
  rewriting 3 sheetmetal/*.ts files, moving 5 files, and threading the
  result through 3 distinct test directories. There is real coordination
  overhead.
- The spec already calls out (§8 Week 1, "Client side"):
  *"Canonicalise material ids (remove kFactorTable.ts)."* — only ONE of
  the 11 steps. The spec author scoped a single PR (delete the
  duplicate table) into Phase 2 Week 1, not the full consolidation.

#### Recommendation

Split into TWO efforts:

**A — Phase 2 Week 1 critical subset (4-6 hours, lands inside Week 1):**
- Step 1 (add stainless316).
- Step 2 (migration alias file + tests).
- Step 5 (delete `kFactorTable.ts` + redirect `loftedBend.ts`).
- Step 9 partial (wire normalizer into `useNfabFileIO.ts` and the agent
  tool).
- Result: a single canonical K-factor table behind the Phase 2 V2
  rollout, with the migration safety net live. Spec §1.4 "remove
  kFactorTable.ts" honoured. Nothing else moves.

**B — Phase 2 Week 4 OR Phase 1 Week 5 (full consolidation, 16-20
hours):**
- Steps 3, 4, 6, 7, 8, 10 (file moves, internal rewrites, dashed-folder
  fold, type rename).
- This lands the namespace unification without blocking Phase 2 Week 1
  worker-side delivery.
- Phase 2 Week 4 is already scheduled for "Korean UI + bend table +
  auto-drawing" — that's *less* engineering-heavy and has natural slack
  for an extra refactor PR.

#### Phase 1 Week 5 alternative

If the team wants the namespace clean before Phase 2 starts at all
(reasonable — fewer moving parts during the worker integration),
sub-track B lands in Phase 1 Week 5 (currently labelled "buffer week"
in `wave-1-compat-matrix.md`-style schedule). This is the cleanest path.

### 7.4 Hard blockers for Phase 2 Week 1 (independent of consolidation)

Two prerequisites must be true at Phase 2 Week 1 kickoff (per spec
§1.2):

1. **`occt-worker/src/` directory exists.** Spec flags this as
   not-on-disk in this checkout.
2. **Wave 1 OCCT ops (`extrude`, `boolean`, `fillet`, `sweep`) are
   stable.** Phase 2 Week 1's worker work *composes* these — if they
   regressed, Week 1 slips.

The consolidation work has zero overlap with those two — it lives
entirely in the Next.js client, the agent layer, and one Vitest module.
So even if R2 above slips, Wave 2 Phase 1 Week 5 can still ship sub-track
A and the bulk of B, gated only on a CI green run.

---

## 8. Summary — the 5 most important decisions

1. **`features/sheetMetalTables.ts` is canonical** — Schema A
   (camelCase, 7 → 8 entries with `stainless316`). All other material
   ids deprecated.
2. **`features/` owns the modelling pipeline, `sheetmetal/` owns the
   calculator ribbon.** `sheet-metal/` (dashed) is folded into
   `sheetmetal/` and deleted.
3. **`sheetmetal/sheetMetal.ts` migrates to `features/sheetMetalBox.ts`.**
   It's user-path Wave 1 code, not a calculator widget.
4. **One-way alias migration** ships before any deletion. `.nfab`
   round-trip is preserved; no user re-saves required.
5. **Phase 2 Week 1 takes the critical subset (4-6 h) only.** The full
   consolidation lands in Phase 1 Week 5 or Phase 2 Week 4. Worker-side
   delivery is not blocked.

---

**End of plan.** Tracking issues to be filed under the
`wave-2-phase-2-sheetmetal` GitHub milestone once this plan is signed
off.
