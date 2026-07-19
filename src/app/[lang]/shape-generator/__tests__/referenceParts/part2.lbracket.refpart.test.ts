/**
 * Reference part 2 — L-bracket (검증 트랙, solidworks-parity-roadmap).
 *
 * Two flanges (60×8 base, 8×32 upright, 40 deep), mounting holes on both
 * flanges, corner rib, edge fillet. Exercises: fully-constrained sketch →
 * extrude → OCCT fillet → hole feature → cross-axis holes → rib →
 * .nfab round-trip. Also probes two suspected chain hazards:
 *   (a) sketch-cut on a non-XY plane after an OCCT feature,
 *   (b) global OCCT fillet on a body whose B-rep handle was lost.
 *
 * Gated: RUN_OCCT_FEASIBILITY=1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyFeaturePipelineDetailedAsync } from '../../features';
import type { FeatureInstance } from '../../features/types';
import { ensureOcctReady, setOcctGlobalMode } from '../../features/occtEngine';
import { cacheClear } from '../../features/pipelineCache';
import { solveConstraints } from '../../sketch/constraintSolver';
import type { SketchConstraint, SketchDimension, SketchSegment, SketchPoint } from '../../sketch/types';
import {
  meshVolume,
  circleProfile,
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

// L-profile: base leg 60×8, upright 8×40 (total height 40), extruded 40 deep.
const LEG = 60, T = 8, HT = 40, D = 40;
const AREA = LEG * T + T * (HT - T); // 736 mm²
const V_PRISM = AREA * D;            // 29 440 mm³

/** Fully constrain the L-profile with the real solver, then return segments. */
function solveLProfile(): { segments: SketchSegment[]; constraints: SketchConstraint[]; dimensions: SketchDimension[] } {
  // Initial guess, deliberately off-dimension.
  const pts: SketchPoint[] = [
    { id: 'q0', x: 0, y: 0 },
    { id: 'q1', x: 58, y: 1 },
    { id: 'q2', x: 61, y: 9 },
    { id: 'q3', x: 9, y: 7 },
    { id: 'q4', x: 7, y: 38 },
    { id: 'q5', x: -1, y: 41 },
  ];
  const segments: SketchSegment[] = [
    { type: 'line', id: 'm0', points: [pts[0], pts[1]] }, // base bottom
    { type: 'line', id: 'm1', points: [pts[1], pts[2]] }, // base right end
    { type: 'line', id: 'm2', points: [pts[2], pts[3]] }, // base top
    { type: 'line', id: 'm3', points: [pts[3], pts[4]] }, // upright inner
    { type: 'line', id: 'm4', points: [pts[4], pts[5]] }, // upright top
    { type: 'line', id: 'm5', points: [pts[5], pts[0]] }, // upright outer
  ];
  const constraints: SketchConstraint[] = [
    { id: 'kH0', type: 'horizontal', entityIds: ['m0'], satisfied: false },
    { id: 'kV1', type: 'vertical', entityIds: ['m1'], satisfied: false },
    { id: 'kH2', type: 'horizontal', entityIds: ['m2'], satisfied: false },
    { id: 'kV3', type: 'vertical', entityIds: ['m3'], satisfied: false },
    { id: 'kH4', type: 'horizontal', entityIds: ['m4'], satisfied: false },
    { id: 'kV5', type: 'vertical', entityIds: ['m5'], satisfied: false },
    { id: 'kFix', type: 'fixed', entityIds: ['q0'], satisfied: false },
  ];
  const dimensions: SketchDimension[] = [
    { id: 'dLeg', type: 'linear', entityIds: ['m0'], value: LEG, position: { x: 30, y: -10 }, locked: true },
    { id: 'dT', type: 'linear', entityIds: ['m1'], value: T, position: { x: 70, y: 4 }, locked: true },
    { id: 'dUp', type: 'linear', entityIds: ['m3'], value: HT - T, position: { x: 20, y: 24 }, locked: true },
    { id: 'dTop', type: 'linear', entityIds: ['m4'], value: T, position: { x: 4, y: 45 }, locked: true },
  ];
  const res = solveConstraints(segments, constraints, dimensions);
  expect(res.satisfied).toBe(true);
  expect(res.solveResult?.status).toBe('ok');
  expect(res.solveResult?.dof).toBe(0);
  const segs = segments.map(s => ({
    ...s,
    points: s.points.map(p => ({ ...res.points.get(p.id!)! })),
  }));
  return { segments: segs, constraints, dimensions };
}

function extrudeL(): FeatureInstance {
  const sk = solveLProfile();
  return {
    id: 'g-extrude',
    type: 'sketchExtrude',
    params: {},
    enabled: true,
    sketchData: {
      profile: { segments: sk.segments, closed: true },
      config: extrudeConfig(D),
      plane: 'xy',
      planeOffset: 0,
      operation: 'add',
      constraints: sk.constraints,
      dimensions: sk.dimensions,
    },
  };
}

const filletAll = (id: string, radius: number): FeatureInstance =>
  ({ id, type: 'fillet', params: { radius, segments: 3, engine: 1 }, enabled: true });

const baseHole = (id: string, posX: number, posZ: number): FeatureInstance => ({
  id,
  type: 'hole',
  params: {
    holeType: 0, diameter: 6, posX, posZ, depth: 999,
    counterboreDia: 12, counterboreDepth: 3, countersinkAngle: 90,
    engine: 1,
  },
  enabled: true,
});

/** Upright-flange hole along the X axis — the hole FEATURE can't do this
 *  (it always drills along Y), so the production alternative is a boolean
 *  subtract with a rotated cylinder. */
const uprightHoleBoolean = (id: string, y: number, z: number): FeatureInstance => ({
  id,
  type: 'boolean',
  params: {
    operation: 1, toolShape: 1,
    toolWidth: 6, toolHeight: 12, toolDepth: 6,
    posX: 4, posY: y, posZ: z,
    rotX: 0, rotY: 0, rotZ: 90, // +Y cylinder → X axis
    engine: 1,
  },
  enabled: true,
});

/** The same upright hole as a sketch-cut on the YZ plane — what a sketch-led
 *  user would do first. Probed separately (suspected to fail after OCCT). */
const uprightHoleSketchCut = (id: string, y: number, z: number): FeatureInstance => ({
  id,
  type: 'sketchExtrude',
  params: {},
  enabled: true,
  sketchData: {
    // plane 'yz': sketch (sx, sy) → world (planeOffset+, sy, -sx)
    profile: circleProfile(-z, y, 3),
    config: extrudeConfig(10),
    plane: 'yz',
    planeOffset: -1,
    operation: 'subtract',
  },
});

/** Square-profile variant of the upright cut (lines, not a circle) — isolates
 *  the plane/merge behaviour from the circle-profile sampler bug. */
const uprightSquareSketchCut = (id: string, y: number, z: number): FeatureInstance => {
  const s = 3; // half-side
  const pts = [
    { x: -z - s, y: y - s, id: `${id}p0` },
    { x: -z + s, y: y - s, id: `${id}p1` },
    { x: -z + s, y: y + s, id: `${id}p2` },
    { x: -z - s, y: y + s, id: `${id}p3` },
  ];
  return {
    id,
    type: 'sketchExtrude',
    params: {},
    enabled: true,
    sketchData: {
      profile: {
        segments: [
          { type: 'line', id: `${id}l0`, points: [pts[0], pts[1]] },
          { type: 'line', id: `${id}l1`, points: [pts[1], pts[2]] },
          { type: 'line', id: `${id}l2`, points: [pts[2], pts[3]] },
          { type: 'line', id: `${id}l3`, points: [pts[3], pts[0]] },
        ],
        closed: true,
      },
      config: extrudeConfig(10),
      plane: 'yz',
      planeOffset: -1,
      operation: 'subtract',
    },
  };
};

const ribFeatureInst = (): FeatureInstance => ({
  id: 'g-rib',
  type: 'rib',
  params: { startX: T, startZ: 20, endX: 40, endZ: 20, thickness: 3, height: 30, direction: 0 },
  enabled: true,
});

describeMaybe('REF-PART 2 · L-bracket', () => {
  beforeAll(async () => {
    await ensureOcctReady();
    setOcctGlobalMode(true);
  }, 180_000);

  afterAll(() => {
    setOcctGlobalMode(false);
    cacheClear();
  });

  it('L-profile fully constrains (solver ok, DOF 0)', () => {
    const sk = solveLProfile();
    const xs = sk.segments.flatMap(s => s.points.map(p => p.x));
    const ys = sk.segments.flatMap(s => s.points.map(p => p.y));
    expect(Math.max(...xs)).toBeCloseTo(LEG, 3);
    expect(Math.max(...ys)).toBeCloseTo(HT, 3);
  });

  it('a circle-only sketch profile extrudes/cuts through the pipeline (fixed: was "Sketch produced empty geometry")', async () => {
    // FIXED (was a pinned critical finding): profileToPoints used to SKIP
    // circle segments, so the single most common sketch op — draw a circle,
    // extrude/cut — errored with "Sketch produced empty geometry" on every
    // plane. sketch/extrudeProfile.ts now tessellates circle (and rect/
    // polygon/ellipse/slot) into the contour loop.
    cacheClear();
    const features = [extrudeL(), uprightHoleSketchCut('g-circlecut-probe', 24, 12)];
    const res = await applyFeaturePipelineDetailedAsync(emptySketchBase(), features, { occtMode: true });
    const err = res.errors['g-circlecut-probe'];
    const vol = meshVolume(res.geometry);
    console.log(`[REF-PART 2] circle-profile cut: error=${err ?? '(none)'}, vol=${vol.toFixed(0)} (prism ${V_PRISM})`);
    expect(err).toBeUndefined();
    expect(res.geometry.attributes.position.count).toBeGreaterThan(0);
    // The Ø6 cut tool spans x ∈ [-6, 4] (planeOffset −1, depth 10), so it
    // removes ≈ π·3²·4 ≈ 113 mm³ from the 8 mm upright wall. Honest band:
    // SOME material must be gone, and never more than the full-wall bore.
    expect(vol).toBeLessThan(V_PRISM - 40);
    expect(vol).toBeGreaterThan(V_PRISM - 400);
  }, 240_000);

  it('PROBE — square sketch-cut (YZ plane) after an OCCT fillet: does the cut apply?', async () => {
    cacheClear();
    const features = [extrudeL(), filletAll('g-fillet-probe', 2), uprightSquareSketchCut('g-yzcut-probe', 24, 12)];
    const res = await applyFeaturePipelineDetailedAsync(emptySketchBase(), features, { occtMode: true });
    const vol = meshVolume(res.geometry);
    const err = res.errors['g-yzcut-probe'];
    // Volume after fillet ≈ V_PRISM − fillet loss; the cut removes 6×6×8 = 288.
    console.log(`[REF-PART 2] yz square-cut probe: vol=${vol.toFixed(0)}, error=${err ?? '(none)'}, `
      + `handleAfterCut=${String(res.geometry.userData?.occtHandle ?? null)}`);
    if (err) {
      recordFinding({
        part: 'P2 L-bracket',
        severity: 'major',
        title: 'sketch-cut on the YZ plane fails after an OCCT fillet',
        detail: `pipeline error on the cut: "${err}" — the OCCT fillet output is an indexed uv-less mesh, the `
          + 'sketch tool is a non-indexed uv-carrying ExtrudeGeometry; both the CSG subtract and the merge '
          + 'fallback reject the pair, so the user loses the hole entirely.',
      });
    } else if (!res.geometry.userData?.occtHandle) {
      recordFinding({
        part: 'P2 L-bracket',
        severity: 'major',
        title: 'non-XY sketch-cut silently drops the B-rep chain',
        detail: 'cut applied (mesh CSG) but occtHandle is gone — downstream OCCT features must re-derive a '
          + 'host via the mesh→B-rep bridge or fail clean (pipelineManager.ts gates the B-rep chain to '
          + 'plane==="xy"; since the fail-clean host contract, the old bounding-box substitution is gone).',
      });
    }
    expect(res.geometry.attributes.position.count).toBeGreaterThan(0);
  }, 240_000);

  it('global OCCT fillet on a body without a B-rep handle NEVER substitutes the bounding box (fixed)', async () => {
    // FIXED (was a pinned critical finding): occtFilletBox used to build
    // makeBaseBox(bbox) as the host when no occtHandle was present and ship
    // the filleted BOX as a "requested" success — the L-bracket silently
    // became its 96 000 mm³ bounding box. The fail-clean host contract
    // (occtEngine.resolveBrepHostHandle/-Async) now either bridges the mesh
    // into a faithful B-rep (importSTL + simplify) or throws, dropping to the
    // guarded mesh path — both honest, neither a bbox stand-in.
    cacheClear();
    const features = [extrudeL(), uprightSquareSketchCut('g-yzcut', 24, 12), filletAll('g-fillet-late', 1)];
    const res = await applyFeaturePipelineDetailedAsync(emptySketchBase(), features, { occtMode: true });
    const vol = meshVolume(res.geometry);
    const bboxVol = 60 * 40 * 40; // 96 000 — the L-bracket's bounding box
    const filletErr = res.errors['g-fillet-late'];
    console.log(`[REF-PART 2] late-fillet: vol=${vol.toFixed(0)} (L≈${V_PRISM}, bbox=${bboxVol}), `
      + `filletError=${filletErr ?? '(none)'}`);
    // The bbox-replacement class is dead: volume must stay an L-bracket.
    expect(vol).toBeLessThan(V_PRISM * 1.1);
    // Honest outcomes only: the fillet applied on the REAL solid (small
    // volume loss) or failed loudly (pipeline error, body reverted).
    expect(vol).toBeGreaterThan(V_PRISM * 0.85);
    if (filletErr) {
      recordFinding({
        part: 'P2 L-bracket',
        severity: 'minor',
        title: 'late fillet on a handle-less body fails clean (no B-rep bridge result)',
        detail: `fillet error "${filletErr}" — fail-clean per contract; the part is preserved un-filleted `
          + 'instead of being replaced by its bounding box.',
      });
    }
  }, 240_000);

  let finalFeatures: FeatureInstance[] = [];
  let finalVolume = 0;

  it('builds the full bracket (extrude → fillet → 2 base holes → 2 upright holes → rib)', async () => {
    cacheClear();
    finalFeatures = [
      extrudeL(),
      filletAll('g-fillet', 2),
      baseHole('g-hole1', 30, 12),
      baseHole('g-hole2', 30, 28),
      uprightHoleBoolean('g-uhole1', 24, 12),
      uprightHoleBoolean('g-uhole2', 24, 28),
      ribFeatureInst(),
    ];
    const res = await applyFeaturePipelineDetailedAsync(emptySketchBase(), finalFeatures, { occtMode: true });
    console.log(`[REF-PART 2] full build errors: ${Object.keys(res.errors).length === 0 ? '(none)' : JSON.stringify(res.errors)}`);

    // The rib has a known fragile fallback (mesh union on a uv-less OCCT mesh);
    // tolerate ONLY a rib failure, and record it as a finding.
    if (res.errors['g-rib']) {
      recordFinding({
        part: 'P2 L-bracket',
        severity: 'major',
        title: 'rib feature failed on the OCCT-built bracket',
        detail: `rib error: "${res.errors['g-rib']}"`,
      });
    }
    const otherErrors = Object.entries(res.errors).filter(([id]) => id !== 'g-rib');
    expect(otherErrors).toEqual([]);

    const vol = meshVolume(res.geometry);
    finalVolume = vol;
    // Closed form: prism − 4 Ø6×8 holes + rib(32×30×3 − 32×8×3 overlap), fillet r2 loss ≈ 500.
    const holes = 4 * Math.PI * 9 * T;            // ≈ 905
    const rib = res.errors['g-rib'] ? 0 : 32 * 30 * 3 - 32 * T * 3; // 2 112 when applied
    const expected = V_PRISM - holes + rib;       // pre-fillet
    console.log(`[REF-PART 2] SCORECARD volume=${vol.toFixed(0)} vs closed-form ≈ ${expected.toFixed(0)} (fillet loss not modelled)`);
    expect(vol).toBeGreaterThan(expected * 0.9);
    expect(vol).toBeLessThan(expected * 1.05);

    // Note where the hole pattern hurt: 4 separate features for 4 holes.
    recordFinding({
      part: 'P2 L-bracket',
      severity: 'major',
      title: 'no feature-level hole pattern',
      detail: 'linearPattern/circularPattern clone the WHOLE BODY (features/linearPattern.ts:25-32), so a '
        + '4-hole mounting pattern requires 4 hand-placed hole features; changing the bolt spacing means '
        + 'editing each one. SolidWorks users expect pattern-of-feature.',
    });
    recordFinding({
      part: 'P2 L-bracket',
      severity: 'major',
      title: 'hole feature is Y-axis-only',
      detail: 'features/hole.ts always drills along Y (bbox top); holes through the upright flange (X axis) '
        + 'need a rotated boolean cylinder instead — the Hole Wizard cannot place them.',
    });
  }, 240_000);

  it('.nfab round-trip → re-run → identical volume', async () => {
    expect(finalFeatures.length).toBeGreaterThan(0);
    const rt = nfabRoundTrip(finalFeatures, 'ref-part-2-lbracket');
    expect(rt.features).toHaveLength(finalFeatures.length);
    expect(rt.features[0].sketchData?.profile.segments).toHaveLength(6);
    cacheClear();
    const res2 = await applyFeaturePipelineDetailedAsync(emptySketchBase(), rt.features, { occtMode: true });
    const vol2 = meshVolume(res2.geometry);
    console.log(`[REF-PART 2] round-trip volume=${vol2.toFixed(0)} vs ${finalVolume.toFixed(0)}`);
    expect(Math.abs(vol2 - finalVolume)).toBeLessThan(Math.max(1, finalVolume * 0.01));
  }, 240_000);
});
