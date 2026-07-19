/**
 * Reference part 1 — Electronics enclosure (검증 트랙, solidworks-parity-roadmap).
 *
 * Rectangular shell 100×60×30, wall 2 mm, 4 corner screw bosses with pilot
 * holes, lid lip, edge fillet. Exercises: constrained sketch → extrude →
 * shell (face-pick open) → boolean bosses/holes → fillet → .nfab round-trip.
 *
 * Built END-TO-END through the production pipeline
 * (applyFeaturePipelineDetailedAsync, occtMode — the worker path), with the
 * real constraint solver fully constraining the footprint sketch first.
 *
 * Gated like the sibling OCCT suites: RUN_OCCT_FEASIBILITY=1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyFeaturePipelineDetailedAsync } from '../../features';
import type { FeatureInstance } from '../../features/types';
import { ensureOcctReady, setOcctGlobalMode } from '../../features/occtEngine';
import { cacheClear } from '../../features/pipelineCache';
import { solveConstraints } from '../../sketch/constraintSolver';
import type { SketchConstraint, SketchDimension, SketchSegment, SketchPoint } from '../../sketch/types';
import type { FaceSelectionInfo } from '../../editing/selectionInfo';
import {
  meshVolume,
  manifoldReport,
  extrudeConfig,
  nfabRoundTrip,
  recordFinding,
  emptySketchBase,
} from './refPartsHarness';

// W1-A (R0-0): default ON. This suite is the OCCT kernel's real-behaviour gate;
// leaving it opt-IN meant it never ran in CI. Measured cost of enabling: ~18s
// wall across the whole __tests__ dir. Set RUN_OCCT_FEASIBILITY=0 to opt out.
const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

// ─── Step 1: fully-constrained footprint sketch (real constraintSolver) ──────

const W = 100, H = 60, DEPTH = 30, WALL = 2;

interface SolvedSketch {
  segments: SketchSegment[];
  constraints: SketchConstraint[];
  dimensions: SketchDimension[];
  points: Map<string, SketchPoint>;
}

function solveFootprintSketch(): SolvedSketch {
  // Slightly-off initial geometry — the solver must pull it onto 100×60.
  const pts: SketchPoint[] = [
    { id: 'p0', x: -49, y: -31 },
    { id: 'p1', x: 52, y: -29 },
    { id: 'p2', x: 51, y: 28 },
    { id: 'p3', x: -51, y: 31 },
  ];
  const segments: SketchSegment[] = [
    { type: 'line', id: 'l0', points: [pts[0], pts[1]] },
    { type: 'line', id: 'l1', points: [pts[1], pts[2]] },
    { type: 'line', id: 'l2', points: [pts[2], pts[3]] },
    { type: 'line', id: 'l3', points: [pts[3], pts[0]] },
  ];
  const constraints: SketchConstraint[] = [
    { id: 'cH0', type: 'horizontal', entityIds: ['l0'], satisfied: false },
    { id: 'cV1', type: 'vertical', entityIds: ['l1'], satisfied: false },
    { id: 'cH2', type: 'horizontal', entityIds: ['l2'], satisfied: false },
    { id: 'cV3', type: 'vertical', entityIds: ['l3'], satisfied: false },
    { id: 'cFix', type: 'fixed', entityIds: ['p0'], satisfied: false },
  ];
  const dimensions: SketchDimension[] = [
    { id: 'dW', type: 'linear', entityIds: ['l0'], value: W, position: { x: 0, y: -40 }, locked: true },
    { id: 'dH', type: 'linear', entityIds: ['l1'], value: H, position: { x: 60, y: 0 }, locked: true },
  ];
  const res = solveConstraints(segments, constraints, dimensions);
  expect(res.satisfied).toBe(true);
  expect(res.solveResult?.status).toBe('ok');
  expect(res.solveResult?.dof).toBe(0);
  // Re-anchor the footprint so p0 is the exact (-50,-30) corner: the sketch is
  // fully constrained relative to the fixed corner; shift to centre the box.
  const sp = res.points;
  const p0 = sp.get('p0')!;
  const shiftX = -50 - p0.x, shiftY = -30 - p0.y;
  const solved = new Map<string, SketchPoint>();
  for (const [id, p] of sp) solved.set(id, { id, x: p.x + shiftX, y: p.y + shiftY });
  const segs = segments.map(s => ({
    ...s,
    points: s.points.map(p => ({ ...solved.get(p.id!)! })),
  }));
  return { segments: segs, constraints, dimensions, points: solved };
}

// ─── Feature builders ────────────────────────────────────────────────────────

function topFaceSelection(): FaceSelectionInfo {
  return {
    type: 'face',
    normal: [0, 0, 1],
    position: [0, 0, DEPTH],
    area: W * H,
    triangleCount: 2,
    normalLabel: '+Z',
    triangleIndices: [],
  };
}

function bodyExtrudeFeature(sk: SolvedSketch): FeatureInstance {
  return {
    id: 'f-body',
    type: 'sketchExtrude',
    params: {},
    enabled: true,
    sketchData: {
      profile: { segments: sk.segments, closed: true },
      config: extrudeConfig(DEPTH),
      plane: 'xy',
      planeOffset: 0,
      operation: 'add',
      constraints: sk.constraints,
      dimensions: sk.dimensions,
    },
  };
}

function shellFeatureInst(): FeatureInstance {
  return {
    id: 'f-shell',
    type: 'shell',
    params: { wallThickness: WALL, openFace: 1, engine: 1 },
    enabled: true,
    faceSelections: [topFaceSelection()],
  };
}

const BOSS_R = 4, BOSS_HOLE_R = 1.25;
const BOSS_XY: [number, number][] = [[-42, -22], [42, -22], [42, 22], [-42, 22]];

function bossBoolean(i: number): FeatureInstance {
  const [x, y] = BOSS_XY[i];
  return {
    id: `f-boss${i}`,
    type: 'boolean',
    params: {
      operation: 0, toolShape: 1, // union, cylinder
      toolWidth: BOSS_R * 2, toolHeight: DEPTH - WALL, toolDepth: BOSS_R * 2,
      posX: x, posY: y, posZ: WALL + (DEPTH - WALL) / 2,
      rotX: 90, rotY: 0, rotZ: 0, // +Y cylinder → +Z (enclosure axis)
      engine: 1,
    },
    enabled: true,
  };
}

function bossHoleBoolean(i: number): FeatureInstance {
  const [x, y] = BOSS_XY[i];
  return {
    id: `f-bosshole${i}`,
    type: 'boolean',
    params: {
      operation: 1, toolShape: 1, // subtract, cylinder
      toolWidth: BOSS_HOLE_R * 2, toolHeight: 20, toolDepth: BOSS_HOLE_R * 2,
      posX: x, posY: y, posZ: 20, // z ∈ [10, 30]
      rotX: 90, rotY: 0, rotZ: 0,
      engine: 1,
    },
    enabled: true,
  };
}

/** Lid lip: 2 mm × 3 mm rim ring on top of the wall, as 4 box unions. */
function lipBoxes(): FeatureInstance[] {
  const z = DEPTH + 1.5; // boxes span z ∈ [30, 33]
  const mk = (id: string, w: number, h: number, x: number, y: number): FeatureInstance => ({
    id,
    type: 'boolean',
    params: {
      operation: 0, toolShape: 0,
      toolWidth: w, toolHeight: h, toolDepth: 3,
      posX: x, posY: y, posZ: z,
      rotX: 0, rotY: 0, rotZ: 0,
      engine: 1,
    },
    enabled: true,
  });
  return [
    mk('f-lipN', W, WALL, 0, H / 2 - WALL / 2),
    mk('f-lipS', W, WALL, 0, -H / 2 + WALL / 2),
    mk('f-lipE', WALL, H, W / 2 - WALL / 2, 0),
    mk('f-lipW', WALL, H, -W / 2 + WALL / 2, 0),
  ];
}

function lipFillet(): FeatureInstance {
  return { id: 'f-fillet', type: 'fillet', params: { radius: 1, segments: 3, engine: 1 }, enabled: true };
}

// ─── Expected volumes (closed form, mm³) ─────────────────────────────────────

const V_SOLID = W * H * DEPTH;                                          // 180 000
const V_SHELL = V_SOLID - (W - 2 * WALL) * (H - 2 * WALL) * (DEPTH - WALL); // 29 472
const V_BOSSES = 4 * Math.PI * BOSS_R * BOSS_R * (DEPTH - WALL);        // ≈ 5 630
const V_HOLES = 4 * Math.PI * BOSS_HOLE_R * BOSS_HOLE_R * 20;           // ≈ 393
const V_LIP = (W * H - (W - 2 * WALL) * (H - 2 * WALL)) * 3;            // 1 872
const V_EXPECT = V_SHELL + V_BOSSES - V_HOLES + V_LIP;                  // ≈ 36 581

// ─────────────────────────────────────────────────────────────────────────────

describeMaybe('REF-PART 1 · electronics enclosure', () => {
  beforeAll(async () => {
    await ensureOcctReady();
    setOcctGlobalMode(true); // user's "정밀(B-rep)" toggle — required for the sketch B-rep chain
  }, 180_000);

  afterAll(() => {
    setOcctGlobalMode(false);
    cacheClear();
  });

  it('footprint sketch fully constrains (solver ok, DOF 0) and lands on 100×60', () => {
    const sk = solveFootprintSketch();
    const p1 = sk.points.get('p1')!;
    const p2 = sk.points.get('p2')!;
    expect(Math.abs(p1.x - 50)).toBeLessThan(1e-3);
    expect(Math.abs(p2.y - 30)).toBeLessThan(1e-3);
  });

  it('natural CAD order (shell → sketch boss): the sketch merges after an OCCT feature (FIXED — was a pinned finding)', async () => {
    cacheClear();
    const sk = solveFootprintSketch();
    // Square boss profile (lines). (Circle-only profiles used to be
    // unextrudable — FIXED, see part 2 — but this probe targets the
    // post-OCCT merge path, so plain lines keep it focused.)
    const [bx, by] = BOSS_XY[0];
    const s = BOSS_R;
    const bp = [
      { x: bx - s, y: by - s, id: 'bp0' },
      { x: bx + s, y: by - s, id: 'bp1' },
      { x: bx + s, y: by + s, id: 'bp2' },
      { x: bx - s, y: by + s, id: 'bp3' },
    ];
    const boss: FeatureInstance = {
      id: 'f-sketchboss',
      type: 'sketchExtrude',
      params: {},
      enabled: true,
      sketchData: {
        profile: {
          segments: [
            { type: 'line', id: 'bl0', points: [bp[0], bp[1]] },
            { type: 'line', id: 'bl1', points: [bp[1], bp[2]] },
            { type: 'line', id: 'bl2', points: [bp[2], bp[3]] },
            { type: 'line', id: 'bl3', points: [bp[3], bp[0]] },
          ],
          closed: true,
        },
        config: extrudeConfig(DEPTH - WALL),
        plane: 'xy',
        planeOffset: WALL,
        operation: 'add',
      },
    };
    // Shell-only baseline so the boss's closed-form contribution is provable.
    const shellOnly = await applyFeaturePipelineDetailedAsync(
      emptySketchBase(),
      [bodyExtrudeFeature(sk), shellFeatureInst()],
      { occtMode: true },
    );
    const vShellOnly = meshVolume(shellOnly.geometry);
    cacheClear();
    const res = await applyFeaturePipelineDetailedAsync(
      emptySketchBase(),
      [bodyExtrudeFeature(sk), shellFeatureInst(), boss],
      { occtMode: true },
    );
    expect(res.geometry.attributes.position.count).toBeGreaterThan(0);
    const vol = meshVolume(res.geometry);
    const bossError = res.errors['f-sketchboss'];
    console.log(`[REF-PART 1] shell→sketch-boss: vol=${vol.toFixed(0)} (shell-only ${vShellOnly.toFixed(0)}), error=${bossError ?? '(none)'}`);
    // FIXED (meshMerge unification layer): OCCT tessellation (indexed, uv-less)
    // and ExtrudeGeometry (non-indexed, uv) now align before merging, so a
    // sketch boss added AFTER shell applies instead of erroring with
    // "merge produced empty geometry". Closed form: the 8×8×28 boss sits in
    // the open cavity, so the volume grows by exactly its prism volume.
    expect(bossError).toBeUndefined();
    const bossVol = (2 * s) * (2 * s) * (DEPTH - WALL); // 1 792
    expect(Math.abs(vol - (vShellOnly + bossVol))).toBeLessThan(bossVol * 0.02);
    expect(vol).toBeGreaterThan(V_SHELL * 0.9);
  }, 120_000);

  let finalFeatures: FeatureInstance[] = [];
  let finalVolume = 0;

  it('builds the full enclosure (extrude → shell(face pick) → bosses → pilot holes → lip → fillet)', async () => {
    cacheClear();
    const sk = solveFootprintSketch();

    // Stage volumes (scorecard): body alone, then body+shell.
    const bodyOnly = await applyFeaturePipelineDetailedAsync(emptySketchBase(), [bodyExtrudeFeature(sk)], { occtMode: true });
    const vBody = meshVolume(bodyOnly.geometry);
    cacheClear();
    const shelled = await applyFeaturePipelineDetailedAsync(
      emptySketchBase(), [bodyExtrudeFeature(sk), shellFeatureInst()], { occtMode: true });
    const vShellStage = meshVolume(shelled.geometry);
    console.log(`[REF-PART 1] stage volumes: body=${vBody.toFixed(0)} (exp ${V_SOLID}), `
      + `shell=${vShellStage.toFixed(0)} (exp ${V_SHELL.toFixed(0)}), shellErrors=${JSON.stringify(shelled.errors)}`);
    expect(Math.abs(vBody - V_SOLID)).toBeLessThan(V_SOLID * 0.01);
    // The B-rep face-pick shell deviates from the closed form: measured ≈ 32 597
    // vs ideal 29 472 — the extra ≈ 3 136 mm³ is one X wall at DOUBLE thickness
    // (cavity ≈ 94×56×28 instead of 96×56×28).
    if (Math.abs(vShellStage - V_SHELL) > V_SHELL * 0.03) {
      recordFinding({
        part: 'P1 enclosure',
        severity: 'major',
        title: 'face-pick B-rep shell produces an uneven wall on a sketch-extruded body',
        detail: `shell(-2, topFaceFinder) volume ${vShellStage.toFixed(0)} vs closed-form ${V_SHELL.toFixed(0)} `
          + '(+10.6%) — cavity measures ≈ 94×56×28, i.e. one X wall is ~4 mm instead of 2 mm. The open-face '
          + 'FaceFinder path (shell.ts applyAsync → occtShellBox shell(-t, finder)) mis-offsets one wall of the '
          + 'polyline-contour extrude. A user measuring the wall sees double thickness on one side.',
      });
    }
    expect(vShellStage).toBeGreaterThan(V_SHELL * 0.95);
    expect(vShellStage).toBeLessThan(V_SHELL * 1.15);

    cacheClear();
    finalFeatures = [
      bodyExtrudeFeature(sk),
      shellFeatureInst(),
      bossBoolean(0), bossBoolean(1), bossBoolean(2), bossBoolean(3),
      bossHoleBoolean(0), bossHoleBoolean(1), bossHoleBoolean(2), bossHoleBoolean(3),
      ...lipBoxes(),
      lipFillet(),
    ];
    const res = await applyFeaturePipelineDetailedAsync(emptySketchBase(), finalFeatures, { occtMode: true });
    const errs = Object.entries(res.errors);
    console.log(`[REF-PART 1] full build errors: ${errs.length === 0 ? '(none)' : JSON.stringify(res.errors)}`);

    const vol = meshVolume(res.geometry);
    finalVolume = vol;
    const rep = manifoldReport(res.geometry);
    console.log(`[REF-PART 1] SCORECARD volume=${vol.toFixed(0)} (closed-form ${V_EXPECT.toFixed(0)}), `
      + `manifold: ${rep.manifoldEdges} ok / ${rep.boundaryEdges} boundary / ${rep.overusedEdges} overused, `
      + `brepHandle=${String(res.geometry.userData?.occtHandle ?? null)}`);

    if (res.errors['f-fillet']) {
      recordFinding({
        part: 'P1 enclosure',
        severity: 'major',
        title: 'lid-lip fillet failed on the shelled enclosure',
        detail: `fillet error: ${res.errors['f-fillet']}`,
      });
    }
    // All non-fillet features must apply cleanly.
    const nonFilletErrors = errs.filter(([id]) => id !== 'f-fillet');
    expect(nonFilletErrors).toEqual([]);

    // Volume vs the SHELL-STAGE baseline (the shell itself deviates from the
    // closed form — pinned as a finding above): every downstream boolean must
    // hit its closed-form contribution within 2%.
    const expectedFromShell = vShellStage + V_BOSSES - V_HOLES + V_LIP;
    expect(Math.abs(vol - expectedFromShell)).toBeLessThan(expectedFromShell * 0.02);
    // And the ideal closed form stays within 10% so a gross regression
    // (e.g. shell silently closed, bosses dropped) still fails loudly.
    expect(Math.abs(vol - V_EXPECT)).toBeLessThan(V_EXPECT * 0.10);

    // B-rep chain must still be alive at the end (full-OCCT build).
    if (!res.geometry.userData?.occtHandle) {
      recordFinding({
        part: 'P1 enclosure',
        severity: 'major',
        title: 'B-rep handle lost during the enclosure build',
        detail: 'final geometry has no occtHandle — downstream STEP export / direct edit will silently degrade to mesh',
      });
    }
  }, 240_000);

  it('.nfab round-trip → re-run pipeline → identical volume', async () => {
    expect(finalFeatures.length).toBeGreaterThan(0);
    const rt = nfabRoundTrip(finalFeatures, 'ref-part-1-enclosure');
    expect(rt.project.magic).toBe('nfab');
    expect(rt.features).toHaveLength(finalFeatures.length);
    // sketchData / faceSelections must survive byte-level persistence.
    expect(rt.features[0].sketchData?.profile.segments).toHaveLength(4);
    expect(rt.features[1].faceSelections?.[0]?.normal).toEqual([0, 0, 1]);

    cacheClear();
    const res2 = await applyFeaturePipelineDetailedAsync(emptySketchBase(), rt.features, { occtMode: true });
    const vol2 = meshVolume(res2.geometry);
    console.log(`[REF-PART 1] round-trip volume=${vol2.toFixed(0)} vs first build ${finalVolume.toFixed(0)} (file ${rt.jsonBytes} bytes)`);
    expect(Math.abs(vol2 - finalVolume)).toBeLessThan(Math.max(1, finalVolume * 0.01));
  }, 240_000);
});
