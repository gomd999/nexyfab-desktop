# STEP Roundtrip Matrix — Wave 1 W1-2

**Owner:** gomd999 · **Started:** 2026-05-27 · **Target completion:** 2026-06-11
**Linked:** [ADR-002 STEP export Route A validation](../adr/002-step-export-route-a-validation.md)

Cross-references the 20 canonical fixtures (`src/app/[lang]/shape-generator/__tests__/step.roundTrip.test.ts`)
exported via the live UI through `exportToStepAsync` (Route A: mesh →
OCCT B-rep → STEP) against the 5 external CAD viewers that customers
will use to receive STEP files from NexyFab.

## Pass criterion

≥ 95 % of cells (= ≥ 95 / 100) green. A green cell means:
- Viewer opens the file with **no parse error**
- Geometry visible at expected position / scale
- Bounding box within 0.5 mm of source (or per-fixture cap from the test)
- No missing faces / inverted normals

A yellow cell is an opens-with-warning. A red cell is a parse failure or
visibly broken geometry.

## Fixtures (rows)

| # | Fixture | Source primitive | Notes |
|---|---|---|---|
| 1 | small box 30×20×15 | BoxGeometry | Flat-face baseline |
| 2 | wedge / long thin box | BoxGeometry | Elongated bbox |
| 3 | tall cylinder R10 H80 | CylinderGeometry | Curved primitive |
| 4 | truncated cone R20→R10 | CylinderGeometry | Asymmetric curve |
| 5 | sphere R30 low-poly | SphereGeometry (16 seg) | Coarse tessellation |
| 6 | sphere R30 hi-poly | SphereGeometry (48 seg) | Fine tessellation |
| 7 | torus R20 r6 | TorusGeometry | Genus-1 surface |
| 8 | tube/pipe R20 H50 | CylinderGeometry | Pipe approx |
| 9 | thin disk R50 H1 | CylinderGeometry | Washer-thin |
| 10 | very thin slab | BoxGeometry (z=0.5) | Sheet-metal-ish |
| 11 | large box 500×100×100 | BoxGeometry | Big extent |
| 12 | tiny cube 5×5×5 | BoxGeometry | Sub-mm precision |
| 13 | tiny cylinder R2 H3 | CylinderGeometry | Jewelry-scale |
| 14 | long rod R3 H300 | CylinderGeometry | Extreme aspect ratio |
| 15 | box at offset | BoxGeometry + translate | Translated geometry |
| 16 | box rotated 45° | BoxGeometry + rotateZ | Non-axis-aligned |
| 17 | scaled box (3× X) | BoxGeometry + scale | Anisotropic scale |
| 18 | dense sphere ~18k tri | SphereGeometry (96 seg) | High tri count |
| 19 | composite (two boxes) | merged BufferGeometry | Disjoint solids |
| 20 | small torus R5 r1 | TorusGeometry | Fillet-like curvature |

## Viewers (columns)

| # | Viewer | Access | Notes |
|---|---|---|---|
| A | FreeCAD | OSS download | Most permissive STEP importer; baseline |
| B | SolidWorks eDrawings | Free | Industry standard; strictest validation |
| C | Fusion 360 | Personal-use free | Cloud import; closest to NexyFab's stack |
| D | Onshape | Free public account | Browser-based; tests web import path |
| E | KOMPAS Viewer | Free download | Russian / European industrial CAD |

## Matrix

Status legend: `.` not tested · `🟢` pass · `🟡` warning · `🔴` fail · `⏭` n/a

| # | Fixture | A FreeCAD | B eDrawings | C Fusion | D Onshape | E KOMPAS | Notes |
|---|---|---|---|---|---|---|---|
| 1 | small box 30×20×15 | . | . | . | . | . | |
| 2 | wedge / long thin box | . | . | . | . | . | |
| 3 | tall cylinder R10 H80 | . | . | . | . | . | |
| 4 | truncated cone | . | . | . | . | . | |
| 5 | sphere low-poly | . | . | . | . | . | |
| 6 | sphere hi-poly | . | . | . | . | . | |
| 7 | torus | . | . | . | . | . | |
| 8 | tube/pipe | . | . | . | . | . | |
| 9 | thin disk | . | . | . | . | . | |
| 10 | very thin slab | . | . | . | . | . | |
| 11 | large box | . | . | . | . | . | |
| 12 | tiny cube | . | . | . | . | . | |
| 13 | tiny cylinder | . | . | . | . | . | |
| 14 | long rod | . | . | . | . | . | |
| 15 | box at offset | . | . | . | . | . | |
| 16 | box rotated 45° | . | . | . | . | . | |
| 17 | scaled box | . | . | . | . | . | |
| 18 | dense sphere | . | . | . | . | . | |
| 19 | composite | . | . | . | . | . | |
| 20 | small torus | . | . | . | . | . | |
| | **Pass rate** | 0/20 | 0/20 | 0/20 | 0/20 | 0/20 | |

**Overall pass rate:** 0 / 100 (target: ≥ 95 / 100)

## Procedure

1. **Generate** the 20 `.step` files via the vitest baseline:
   ```bash
   STEP_RT_DUMP_DIR=tmp/step-fixtures/ RUN_OCCT_FEASIBILITY=1 \
     npx vitest run src/app/[lang]/shape-generator/__tests__/step.roundTrip.test.ts
   ```
   (The current test doesn't dump files — extend the test to write each
   exported STEP text to `STEP_RT_DUMP_DIR/<fixture-name>.step` if env is
   set. Add that small change as part of W1 D1 finish.)

2. **For each viewer** install / log in, open each `.step` file, record:
   - Did it open? (🟢 yes / 🟡 with warning / 🔴 no)
   - Bounding box match? (eyeball ok; or measure for borderline cases)
   - Any visible issue? (inverted face, missing region, broken curvature)
   - Time per import (for the Fusion / Onshape rate-limit awareness)

3. **Update this matrix** with each cell. Commit changes by viewer (5
   commits total) so the diff per viewer is self-contained.

4. **For each red cell**: file an issue or annotate "out of W1 scope"
   with rationale. Per ADR-002 we fix surface bugs in W2; deep refactors
   defer to Wave 2.

## Known limitations (a priori)

- **Texture / material:** STEP doesn't carry material; viewers will show
  default colour. Not a regression.
- **Importer recenters:** the test's `roundTrip()` helper notes that the
  importer recenters around origin. Fixture #15 (offset box) will read
  back centered, not at (200,100,50). That's the importer's choice, not
  our exporter's bug.
- **Low-poly sphere drift bounds:** Fixture #5 has 18 % volume bound.
  This is a fixture limitation (16-segment is coarse), not an exporter
  defect. If we want < 5 %, ship hi-poly source (Fixture #6 covers).

## After 95%+ green

- Annotate `docs/strategy/step-export-gating.md` to point at this matrix
  and mark the 2026-05-08 R2 burn-in finding as "resolved by Route A".
- Add the matrix doc and the W1 fixture list to the Wave 1 W17 sign-off
  packet for the external engineer to review alongside their free play.
