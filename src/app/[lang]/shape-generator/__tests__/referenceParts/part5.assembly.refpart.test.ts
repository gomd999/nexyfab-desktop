/**
 * Reference part 5 — bracket + pin + lever assembly (검증 트랙).
 *
 * Three production-built parts, revolute (hinge) mates, a limit-angle mate,
 * kinematic-drag consistency, assembly BOM + balloons + sheet, and the real
 * PDF/DXF/SVG exporters. Also round-trips the assembly snapshot through the
 * .nfab serializer.
 *
 * Gated: RUN_OCCT_FEASIBILITY=1 (parts are built through the OCCT pipeline).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { applyFeaturePipelineDetailedAsync } from '../../features';
import type { FeatureInstance } from '../../features/types';
import { ensureOcctReady, setOcctGlobalMode } from '../../features/occtEngine';
import { cacheClear } from '../../features/pipelineCache';
import {
  solveAssembly,
  calculateDOF,
  type AssemblyState,
  type AssemblyBody,
  type Mate,
  type MateSelection,
} from '../../assembly/matesSolver';
import {
  beginDragGesture,
  kinematicDragStep,
} from '../../assembly/kinematicDragSolve';
import type { AssemblyMate } from '../../assembly/AssemblyMates';
import { generateAssemblyDrawing, type AssemblyDrawingPart } from '../../analysis/assemblyDrawing';
import { numberBalloons } from '../../drawing/balloonAutoNumbering';
import { buildBomTable, renderBomTableSvg, tableMetrics } from '../../drawing/bomTable';
import type { BomRow as StdBomRow } from '../../standardParts/bomAggregation';
import {
  buildDrawingSvgString,
  buildDrawingDxfString,
  buildDrawingPdfArrayBuffer,
} from '../../analysis/drawingExport';
import { serializeProject, toJsonString, parseProject } from '../../io/nfabFormat';
import { meshVolume, featuresToHistory, minimalScene, recordFinding } from './refPartsHarness';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

// ─── Production-built parts ──────────────────────────────────────────────────

async function buildBracket(): Promise<THREE.BufferGeometry> {
  // 60×40 L from the box base + boolean leg + pivot hole (engine 1).
  const base = new THREE.BoxGeometry(60, 8, 30); // base flange
  base.computeVertexNormals();
  const features: FeatureInstance[] = [
    {
      id: 'a-leg', type: 'boolean',
      params: {
        operation: 0, toolShape: 0, toolWidth: 8, toolHeight: 40, toolDepth: 30,
        posX: -26, posY: 16, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, engine: 1,
      },
      enabled: true,
    },
    {
      id: 'a-pivot', type: 'hole',
      params: {
        holeType: 0, diameter: 8, posX: 10, posZ: 0, depth: 999,
        counterboreDia: 12, counterboreDepth: 2, countersinkAngle: 90, engine: 1,
      },
      enabled: true,
    },
  ];
  const res = await applyFeaturePipelineDetailedAsync(base, features, { occtMode: true });
  expect(Object.entries(res.errors)).toEqual([]);
  return res.geometry;
}

async function buildPin(): Promise<THREE.BufferGeometry> {
  const base = new THREE.CylinderGeometry(4, 4, 30, 32);
  base.computeVertexNormals();
  const res = await applyFeaturePipelineDetailedAsync(base, [], { occtMode: true });
  return res.geometry;
}

async function buildLever(): Promise<THREE.BufferGeometry> {
  const base = new THREE.BoxGeometry(60, 6, 10);
  base.computeVertexNormals();
  const features: FeatureInstance[] = [
    {
      id: 'a-leverhole', type: 'hole',
      params: {
        holeType: 0, diameter: 8, posX: -22, posZ: 0, depth: 999,
        counterboreDia: 12, counterboreDepth: 2, countersinkAngle: 90, engine: 1,
      },
      enabled: true,
    },
  ];
  const res = await applyFeaturePipelineDetailedAsync(base, features, { occtMode: true });
  expect(Object.entries(res.errors)).toEqual([]);
  return res.geometry;
}

// ─── Mate plumbing ───────────────────────────────────────────────────────────

const PIVOT: [number, number, number] = [10, 20, 0];

const sel = (bodyIndex: number, point: [number, number, number], normal: [number, number, number] = [0, 0, 1]): MateSelection => ({
  bodyIndex,
  type: 'face',
  localPoint: new THREE.Vector3(...point),
  localNormal: new THREE.Vector3(...normal),
  localAxis: new THREE.Vector3(0, 0, 1),
});

function makeState(leverAngleRad: number, withLimit: boolean): AssemblyState {
  const holeLocal = new THREE.Vector3(-22, 0, 0);
  const rotated = holeLocal.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), leverAngleRad);
  const leverPos = new THREE.Vector3(...PIVOT).sub(rotated);
  const bodies: AssemblyBody[] = [
    { name: 'bracket', position: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(0, 0, 0), fixed: true },
    { name: 'pin', position: new THREE.Vector3(...PIVOT), rotation: new THREE.Euler(0, 0, 0), fixed: false },
    { name: 'lever', position: leverPos, rotation: new THREE.Euler(0, 0, leverAngleRad), fixed: false },
  ];
  const mates: Mate[] = [
    { id: 'm-pin', type: 'hinge', enabled: true, selections: [sel(0, PIVOT), sel(1, [0, 0, 0])] },
    { id: 'm-lever', type: 'hinge', enabled: true, selections: [sel(0, PIVOT), sel(2, [-22, 0, 0])] },
  ];
  if (withLimit) {
    mates.push({
      id: 'm-limit',
      type: 'limitAngle',
      enabled: true,
      min: 0,
      max: 60,
      selections: [sel(0, PIVOT, [0, 1, 0]), sel(2, [-22, 0, 0], [0, 1, 0])],
    });
  }
  return { bodies, mates };
}

function leverAngleDeg(bodies: { rotation: THREE.Euler }[]): number {
  const n = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(new THREE.Quaternion().setFromEuler(bodies[2].rotation));
  return (Math.acos(THREE.MathUtils.clamp(n.dot(new THREE.Vector3(0, 1, 0)), -1, 1)) * 180) / Math.PI;
}

const drawingConfig = {
  views: ['iso'] as ('iso')[],
  scale: 1,
  paperSize: 'A3' as const,
  orientation: 'landscape' as const,
  showDimensions: true,
  showCenterlines: false,
  titleBlock: {
    partName: 'BRACKET-LEVER-ASSY',
    material: 'AL6061',
    drawnBy: 'ref-parts',
    date: '2026-06-10',
    scale: '1:2',
    revision: 'A',
  },
};

// ─────────────────────────────────────────────────────────────────────────────

describeMaybe('REF-PART 5 · bracket + pin + lever assembly', () => {
  let bracket: THREE.BufferGeometry;
  let pin: THREE.BufferGeometry;
  let lever: THREE.BufferGeometry;

  beforeAll(async () => {
    await ensureOcctReady();
    setOcctGlobalMode(true);
    cacheClear();
    bracket = await buildBracket();
    pin = await buildPin();
    lever = await buildLever();
  }, 300_000);

  afterAll(() => {
    setOcctGlobalMode(false);
    cacheClear();
  });

  it('three parts built through the production pipeline (volumes sane)', () => {
    const vb = meshVolume(bracket), vp = meshVolume(pin), vl = meshVolume(lever);
    console.log(`[REF-PART 5] part volumes: bracket=${vb.toFixed(0)}, pin=${vp.toFixed(0)}, lever=${vl.toFixed(0)}`);
    // bracket: 60×8×30 + 8×40×30 − 8×8×30 leg/base overlap − Ø8×8 hole ≈ 21 678
    const vbExpected = 60 * 8 * 30 + 8 * 40 * 30 - 8 * 8 * 30 - Math.PI * 16 * 8;
    expect(Math.abs(vb - vbExpected)).toBeLessThan(vbExpected * 0.01);
    expect(Math.abs(vp - Math.PI * 16 * 30)).toBeLessThan(60);
    expect(Math.abs(vl - (60 * 6 * 10 - Math.PI * 16 * 6))).toBeLessThan(150);
  });

  it('revolute mates solve: converged, joints closed, DOF = 2 (pin spin + lever swing)', () => {
    const st = makeState((20 * Math.PI) / 180, false);
    const result = solveAssembly(st, 200);
    expect(result.converged).toBe(true);
    expect(result.unsatisfied).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(calculateDOF(st)).toBe(2);
    // Lever hole sits exactly on the pivot.
    const hole = new THREE.Vector3(-22, 0, 0)
      .applyQuaternion(new THREE.Quaternion().setFromEuler(result.bodies[2].rotation))
      .add(result.bodies[2].position);
    expect(hole.distanceTo(new THREE.Vector3(...PIVOT))).toBeLessThan(0.01);
  });

  it('limit-angle mate clamps a 90° lever down to the 60° bound', () => {
    const st = makeState(Math.PI / 2, true);
    const result = solveAssembly(st, 400);
    const deg = leverAngleDeg(result.bodies);
    console.log(`[REF-PART 5] limitAngle: start 90° → solved ${deg.toFixed(2)}° (bound 60°), converged=${result.converged}, unsatisfied=${JSON.stringify(result.unsatisfied)}`);
    expect(deg).toBeLessThan(61);
    expect(deg).toBeGreaterThan(55);
    // Hinge must STILL be closed after the clamp (kinematic consistency).
    const hole = new THREE.Vector3(-22, 0, 0)
      .applyQuaternion(new THREE.Quaternion().setFromEuler(result.bodies[2].rotation))
      .add(result.bodies[2].position);
    expect(hole.distanceTo(new THREE.Vector3(...PIVOT))).toBeLessThan(0.05);
  });

  it('kinematic drag: lever sweeps 0→40° with the pin joint closed every frame', () => {
    const st = makeState(0, true);
    // Solve once so the start pose is on the constraint manifold.
    const placed = solveAssembly(st, 200);
    st.bodies.forEach((b, i) => {
      b.position.copy(placed.bodies[i].position);
      b.rotation.copy(placed.bodies[i].rotation);
    });
    const tip = new THREE.Vector3(28, 0, 0)
      .applyQuaternion(new THREE.Quaternion().setFromEuler(st.bodies[2].rotation))
      .add(st.bodies[2].position);
    const gesture = beginDragGesture(st, 2, tip);
    expect(gesture.mode.kind).toBe('revolute');

    const pivot = new THREE.Vector3(...PIVOT);
    const radius = tip.distanceTo(pivot);
    let maxResidual = 0;
    for (let deg = 2; deg <= 40; deg += 2) {
      const th = (deg * Math.PI) / 180;
      const target = pivot.clone().add(new THREE.Vector3(radius * Math.cos(th), radius * Math.sin(th), 0));
      kinematicDragStep(st, gesture, target, { iterations: 120 });
      const hole = new THREE.Vector3(-22, 0, 0)
        .applyQuaternion(new THREE.Quaternion().setFromEuler(st.bodies[2].rotation))
        .add(st.bodies[2].position);
      maxResidual = Math.max(maxResidual, hole.distanceTo(pivot));
    }
    console.log(`[REF-PART 5] drag sweep max pin residual = ${maxResidual.toFixed(4)} mm`);
    expect(maxResidual).toBeLessThan(0.25);
  });

  it('PROBE — dragging the lever PAST the 60° limit: does the limit mate hold?', () => {
    const st = makeState(0, true);
    const placed = solveAssembly(st, 200);
    st.bodies.forEach((b, i) => {
      b.position.copy(placed.bodies[i].position);
      b.rotation.copy(placed.bodies[i].rotation);
    });
    const tip = new THREE.Vector3(28, 0, 0)
      .applyQuaternion(new THREE.Quaternion().setFromEuler(st.bodies[2].rotation))
      .add(st.bodies[2].position);
    const gesture = beginDragGesture(st, 2, tip);
    const pivot = new THREE.Vector3(...PIVOT);
    const radius = tip.distanceTo(pivot);
    for (let deg = 2; deg <= 85; deg += 2) {
      const th = (deg * Math.PI) / 180;
      kinematicDragStep(st, gesture, pivot.clone().add(new THREE.Vector3(radius * Math.cos(th), radius * Math.sin(th), 0)), { iterations: 120 });
    }
    const finalDeg = leverAngleDeg(st.bodies);
    console.log(`[REF-PART 5] drag-past-limit: final lever angle = ${finalDeg.toFixed(1)}° (limit 60°)`);
    if (finalDeg > 62) {
      recordFinding({
        part: 'P5 assembly',
        severity: 'major',
        title: 'kinematic drag ignores limit-angle mates on the dragged body',
        detail: `dragging the lever to 85° lands at ${finalDeg.toFixed(0)}° despite the 0–60° limitAngle mate — `
          + 'kinematicDragStep pins the dragged body as fixed during the re-solve '
          + '(assembly/kinematicDragSolve.ts), so inequality mates cannot push back. In SolidWorks the drag '
          + 'stops at the limit.',
      });
      expect(finalDeg).toBeGreaterThan(62); // pinned until the drag loop respects limits
    } else {
      expect(finalDeg).toBeLessThanOrEqual(62);
    }
  });

  it('assembly drawing: BOM (3 rows) + balloons + real PDF/DXF/SVG exporters', async () => {
    const parts: AssemblyDrawingPart[] = [
      { id: 'bracket', label: 'Bracket', qty: 1, material: 'AL6061', geometry: bracket },
      { id: 'pin', label: 'Pivot Pin Ø8', qty: 1, material: 'SUS304', geometry: pin },
      { id: 'lever', label: 'Lever', qty: 1, material: 'AL6061', geometry: lever },
    ];
    const asm = generateAssemblyDrawing(parts, drawingConfig);
    expect(asm.bom).toHaveLength(3);
    expect(asm.perPart).toHaveLength(3);
    for (const p of asm.perPart) {
      expect(p.views[0].lines.length).toBeGreaterThan(0);
    }

    // Balloon numbering (production numbering policy).
    const numbering = numberBalloons(
      asm.bom.map(r => ({ instanceId: r.id, partNumber: r.label, quantity: r.qty })),
      { scheme: 'sequential' },
    );
    expect(numbering.numbers.size).toBe(3);
    expect(numbering.numbers.get('bracket')).toBe(1);

    // BOM table SVG — note the type bridge: assemblyDrawing.BomRow and
    // standardParts.BomRow are different shapes; gluing them is manual.
    const stdRows: StdBomRow[] = asm.bom.map(r => ({
      designation: r.label,
      category: 'other' as const,
      qty: r.qty,
      notes: r.material,
    }));
    const table = buildBomTable(stdRows);
    const svgPrims = renderBomTableSvg(table, 10, 10);
    expect(svgPrims.length).toBeGreaterThan(12);
    expect(tableMetrics(table).rowCount).toBe(3);
    recordFinding({
      part: 'P5 assembly',
      severity: 'minor',
      title: 'three disconnected BOM row models, no balloon→view anchoring',
      detail: 'analysis/assemblyDrawing.BomRow, standardParts/bomAggregation.BomRow and io/bomExport.BomRow are '
        + 'separate shapes with no production bridge; balloon NUMBERS exist (drawing/balloonAutoNumbering) but '
        + 'nothing computes balloon anchor coordinates on the generated assembly view — balloons never appear '
        + 'on the exported sheet.',
    });

    // Real exporters, headless.
    const svg = buildDrawingSvgString(asm);
    expect(svg).toContain('<svg');
    const dxf = buildDrawingDxfString(asm);
    expect(dxf).toContain('ENTITIES');
    const pdf = await buildDrawingPdfArrayBuffer(asm);
    expect(pdf.byteLength).toBeGreaterThan(2000);
    console.log(`[REF-PART 5] SCORECARD sheet: bom=3 rows, svg=${svg.length}B, dxf=${dxf.length}B, pdf=${pdf.byteLength}B`);

    // The PDF/DXF sheets contain the FIRST part's view + title block but no BOM
    // table or balloons — verify and document honestly.
    const bomInPdfPath = dxf.includes('Pivot Pin');
    if (!bomInPdfPath) {
      recordFinding({
        part: 'P5 assembly',
        severity: 'major',
        title: 'assembly BOM rows are not rendered into the exported PDF/DXF sheet',
        detail: 'generateAssemblyDrawing returns `bom` as supplemental data ("renderers add the rows"), but '
          + 'buildDrawingDxfString/buildDrawingPdfArrayBuffer render only views + title block — the shipped '
          + 'sheet has no parts list. Roadmap Phase 3 acceptance ("BOM+벌룬 → PDF") is not met end-to-end.',
      });
    }
  }, 120_000);

  it('.nfab assembly snapshot round-trip preserves hinge + limitAngle mates', () => {
    const placedParts: import('../../assembly/PartPlacementPanel').PlacedPart[] = [
      { id: 'pp-bracket', name: 'Bracket', shapeId: 'lBracket', params: { width: 60, height: 40, thickness: 8, depth: 30 }, qty: 1, position: [0, 0, 0], rotation: [0, 0, 0] },
      { id: 'pp-pin', name: 'Pivot Pin', shapeId: 'cylinder', params: { diameter: 8, height: 30 }, qty: 1, position: PIVOT, rotation: [90, 0, 0] },
      { id: 'pp-lever', name: 'Lever', shapeId: 'box', params: { width: 60, height: 6, depth: 10 }, qty: 1, position: [32, 20, 0], rotation: [0, 0, 0] },
    ];
    const mates: AssemblyMate[] = [
      { id: 'am-1', type: 'hinge', partA: 'pp-bracket', partB: 'pp-pin', faceA: 0, faceB: 0, locked: false },
      { id: 'am-2', type: 'hinge', partA: 'pp-bracket', partB: 'pp-lever', faceA: 0, faceB: 0, locked: false },
      { id: 'am-3', type: 'limitAngle', partA: 'pp-bracket', partB: 'pp-lever', faceA: 0, faceB: 0, min: 0, max: 60, locked: false },
    ];
    const project = serializeProject({
      name: 'ref-part-5-assembly',
      history: featuresToHistory([]),
      scene: minimalScene(),
      assembly: { placedParts, mates },
    });
    const reparsed = parseProject(toJsonString(project));
    expect(reparsed.assembly?.placedParts).toHaveLength(3);
    expect(reparsed.assembly?.mates).toHaveLength(3);
    const limit = reparsed.assembly?.mates.find(m => m.type === 'limitAngle');
    expect(limit?.min).toBe(0);
    expect(limit?.max).toBe(60);
  });
});
