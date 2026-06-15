/**
 * Reference part 3 — Sheet-metal U-channel chassis (검증 트랙).
 *
 * Base 80×160 t2 blank + two 90° flanges (bends), bend reliefs, mounting tab,
 * flat pattern + bend table + DXF, and the drawing exporters (DXF/PDF/SVG)
 * through the REAL production modules. This part runs the sheet-metal family
 * end-to-end and documents where the workflow stalls — and it stalls a lot:
 * several probes below PIN broken production behaviour as findings.
 *
 * Gated with the suite: RUN_OCCT_FEASIBILITY=1 (no OCCT needed here, but the
 * reference-part track runs as one gated batch).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyFeaturePipelineDetailedAsync } from '../../features';
import type { FeatureInstance } from '../../features/types';
import { cacheClear } from '../../features/pipelineCache';
import { getFlatPatternMetadata, applyFlange } from '../../features/sheetMetal';
import { applyTab } from '../../features/tab';
import { getKFactor, bendAllowance } from '../../features/sheetMetalTables';
import { flatPatternToDXFEntities, exportDXF } from '../../io/dxfExporter';
import { generateDrawing } from '../../analysis/autoDrawing';
import {
  buildDrawingSvgString,
  buildDrawingDxfString,
  buildDrawingPdfArrayBuffer,
} from '../../analysis/drawingExport';
import { planSheetLayout } from '../../drawing/sheetLayout';
import { meshVolume, recordFinding, stampedBox } from './refPartsHarness';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

const BW = 80, BT = 2, BL = 160; // blank width × thickness × length
const R = 3, FLANGE_H = 30;

/** The DEFAULT production box base (shapes/box.ts) — BoxGeometry, uv intact. */
function defaultBoxBase(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(BW, BT, BL);
  g.computeVertexNormals();
  return g;
}

const relief = (id: string, positionPct: number): FeatureInstance => ({
  id,
  type: 'bendRelief',
  params: { width: 3, depth: 5, position: positionPct, shape: 1 },
  enabled: true,
});

const flange = (id: string, edgeIndex: number): FeatureInstance => ({
  id,
  type: 'flange',
  params: { height: FLANGE_H, angle: 90, radius: R, edgeIndex },
  enabled: true,
});

const bend = (id: string, positionPct: number): FeatureInstance => ({
  id,
  type: 'bend',
  params: { angle: 90, radius: R, position: positionPct, direction: 0 },
  enabled: true,
});

const flatPattern = (id: string): FeatureInstance => ({
  id,
  type: 'flatPattern',
  params: { thickness: BT, material: 0 },
  enabled: true,
});

const drawingConfig = {
  views: ['front', 'top', 'right', 'iso'] as ('front' | 'top' | 'right' | 'iso')[],
  scale: 1,
  paperSize: 'A3' as const,
  orientation: 'landscape' as const,
  showDimensions: true,
  showCenterlines: true,
  titleBlock: {
    partName: 'U-CHANNEL-CHASSIS',
    material: 'SPCC t2.0',
    drawnBy: 'ref-parts',
    date: '2026-06-10',
    scale: '1:2',
    revision: 'A',
  },
};

/** U-channel geometry via the production geometry FUNCTIONS (applyFlange /
 *  applyTab) — the pipeline route is blocked (see findings below), so the
 *  drawing/flat-pattern stages run on the direct-built body. uv must be
 *  stripped first or applyFlange's merge fails (production gap, pinned). */
function buildUChannelDirect(): THREE.BufferGeometry {
  const base = defaultBoxBase();
  base.deleteAttribute('uv'); // workaround — see 'flange on the default box base' finding
  const f1 = applyFlange(base, { height: FLANGE_H, angle: 90, radius: R, edgeIndex: 0 });
  const f2 = applyFlange(f1, { height: FLANGE_H, angle: 90, radius: R, edgeIndex: 1 });
  return applyTab(f2, { width: 20, length: 10, position: 0.5, edgeIndex: 2 });
}

describeMaybe('REF-PART 3 · sheet-metal U-channel chassis', () => {
  it('FINDING PROBE — flange on the DEFAULT box base fails in the pipeline', async () => {
    cacheClear();
    const res = await applyFeaturePipelineDetailedAsync(defaultBoxBase(), [flange('s-f-probe', 0)], { occtMode: false });
    console.log(`[REF-PART 3] flange-on-default-base error: ${res.errors['s-f-probe'] ?? '(none)'}`);
    if (res.errors['s-f-probe']) {
      recordFinding({
        part: 'P3 U-channel',
        severity: 'critical',
        title: 'flange feature fails on the default box base ("Failed to merge flange geometry")',
        detail: 'applyFlange builds a position-only flange mesh and mergeGeometries rejects the pair because '
          + 'BoxGeometry carries uv (features/sheetMetal.ts:361). The feature\'s own unit tests strip uv to pass '
          + '(features/sheetMetal.test.ts:13-22). tab.ts already has the fix pattern (alignForMerge, tab.ts:43) — '
          + 'flange/hem never adopted it. A user adding the FIRST flange to the standard plate sees an error.',
      });
      expect(res.errors['s-f-probe']).toMatch(/merge/i);
    }
  }, 60_000);

  it('FINDING PROBE — a SECOND flange fails even on a uv-less base (provenance stamp breaks merges)', async () => {
    cacheClear();
    const base = defaultBoxBase();
    base.deleteAttribute('uv');
    const res = await applyFeaturePipelineDetailedAsync(base, [flange('s-f1', 0), flange('s-f2', 1)], { occtMode: false });
    console.log(`[REF-PART 3] second-flange errors: ${JSON.stringify(res.errors)}`);
    expect(res.errors['s-f1']).toBeUndefined(); // first flange merges fine without uv
    if (res.errors['s-f2']) {
      recordFinding({
        part: 'P3 U-channel',
        severity: 'critical',
        title: 'any merge-based feature after another feature fails — pipeline provenance stamp poisons the attribute set',
        detail: 'pipelineManager stamps every feature output with the per-vertex nfabFaceFeatureId attribute '
          + '(pipelineManager.ts:216), but applyFlange/applyHem build tools WITHOUT it, and mergeGeometries '
          + 'hard-fails on any attribute-set mismatch. Consequence: flange→flange, flange→hem, or any '
          + 'merge-feature chain errors on the SECOND feature. A U-channel (two flanges) cannot be built '
          + 'through the feature pipeline at all.',
      });
      expect(res.errors['s-f2']).toMatch(/merge/i);
    }
  }, 60_000);

  it('FINDING PROBE — bendRelief through the pipeline crashes on the default box base', async () => {
    cacheClear();
    const res = await applyFeaturePipelineDetailedAsync(defaultBoxBase(), [relief('s-r-probe', 50)], { occtMode: false });
    console.log(`[REF-PART 3] bendRelief-on-default-base error: ${res.errors['s-r-probe'] ?? '(none)'}`);
    if (res.errors['s-r-probe']) {
      recordFinding({
        part: 'P3 U-channel',
        severity: 'critical',
        title: 'bendRelief (and cornerRelief) crash on the default box base in the pipeline',
        detail: `error "${res.errors['s-r-probe']}" — reliefCuts.csgSubtract stamps the TOOL with `
          + 'nfabFaceFeatureId and configureEvaluatorForProvenance then adds that attribute to the evaluator, '
          + 'but the BASE (feature #1 input) was never stamped, so three-bvh-csg dereferences a missing '
          + 'attribute. The relief features only work when something upstream already stamped the body.',
      });
      expect(res.errors['s-r-probe']).toMatch(/array|attribute/i);
    }
  }, 60_000);

  it('FINDING PROBE — a U needs flanges on BOTH ends; the bend feature refolds the first flange', async () => {
    cacheClear();
    const res = await applyFeaturePipelineDetailedAsync(
      stampedBox(BW, BT, BL),
      [bend('s-bend75', 75), bend('s-bend25', 25)],
      { occtMode: false },
    );
    expect(Object.entries(res.errors)).toEqual([]);
    res.geometry.computeBoundingBox();
    const maxY = res.geometry.boundingBox!.max.y;
    console.log(`[REF-PART 3] two-bend probe maxY=${maxY.toFixed(1)} (a true U-channel would stay ≈ ${FLANGE_H + BT})`);
    if (maxY > 60) {
      recordFinding({
        part: 'P3 U-channel',
        severity: 'major',
        title: 'bend feature cannot produce a U-channel',
        detail: `applyBend always rotates the dist>0 side of the bend line (features/sheetMetal.ts:154), so the `
          + `second bend re-rotates the first flange (bbox maxY ${maxY.toFixed(0)} mm instead of ~32 mm). `
          + 'Both-end flanges require the flange feature — which is itself pipeline-blocked (see prior findings).',
      });
      expect(maxY).toBeGreaterThan(60); // pinned behaviour
    }
  }, 60_000);

  it('U-channel forms via the DIRECT geometry functions (workaround route)', () => {
    const geo = buildUChannelDirect();
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    expect(bb.max.y - bb.min.y).toBeGreaterThan(FLANGE_H * 0.6); // two upstanding flanges
    expect(bb.max.x - bb.min.x).toBeGreaterThan(BW + 5);         // +X tab
    console.log(`[REF-PART 3] SCORECARD U-channel (direct) bbox ${(bb.max.x - bb.min.x).toFixed(1)}×${(bb.max.y - bb.min.y).toFixed(1)}×${(bb.max.z - bb.min.z).toFixed(1)}, vol=${meshVolume(geo).toFixed(0)}`);
  });

  it('FINDING PROBE — flat pattern of the flange-built U-channel: bend table is EMPTY', async () => {
    cacheClear();
    // flatPattern runs fine as a pipeline feature on the direct-built channel.
    const res = await applyFeaturePipelineDetailedAsync(buildUChannelDirect(), [flatPattern('s-fp-flat')], { occtMode: false });
    expect(Object.entries(res.errors)).toEqual([]);
    const meta = getFlatPatternMetadata(res.geometry);
    expect(meta).not.toBeNull();
    console.log(`[REF-PART 3] flange flat pattern: bends=${meta!.bendTable.length}, blank=${meta!.width.toFixed(1)}×${meta!.length.toFixed(1)}`);
    if (meta!.bendTable.length === 0) {
      recordFinding({
        part: 'P3 U-channel',
        severity: 'critical',
        title: 'flange bends are invisible to the flat pattern',
        detail: 'applyFlange never records __bendHistory (features/sheetMetal.ts:215-365 vs applyBend:200-206), '
          + 'so flatPattern of a flange-built part emits a bend table with 0 rows and a blank sized from the '
          + 'FOLDED bbox — the DXF a user sends to the laser cutter has no bend lines and the wrong blank size.',
      });
      expect(meta!.bendTable).toHaveLength(0); // pinned until fixed
    }
  }, 60_000);

  it('L-channel via relief + bend → flat pattern with a real bend table → flat-pattern DXF', async () => {
    cacheClear();
    // Measure the bent body first (the flat-pattern length formula walks ITS bbox).
    const bentRes = await applyFeaturePipelineDetailedAsync(
      stampedBox(BW, BT, BL),
      [relief('s-l-relief', 75), bend('s-l-bend', 75)],
      { occtMode: false },
    );
    expect(Object.entries(bentRes.errors)).toEqual([]);
    bentRes.geometry.computeBoundingBox();
    const bentSizeZ = bentRes.geometry.boundingBox!.max.z - bentRes.geometry.boundingBox!.min.z;

    cacheClear();
    const res = await applyFeaturePipelineDetailedAsync(
      stampedBox(BW, BT, BL),
      [relief('s-l-relief', 75), bend('s-l-bend', 75), flatPattern('s-l-flat')],
      { occtMode: false },
    );
    expect(Object.entries(res.errors)).toEqual([]);
    const meta = getFlatPatternMetadata(res.geometry);
    expect(meta).not.toBeNull();
    expect(meta!.bendTable).toHaveLength(1);
    const row = meta!.bendTable[0];
    expect(row.angle).toBe(90);
    expect(row.radius).toBe(R);
    expect(row.direction).toBe('up');

    const k = getKFactor('mildSteel', R, BT);
    const ba = bendAllowance(90, R, BT, k);
    expect(Math.abs(row.bendAllowance - ba)).toBeLessThan(1e-6);
    expect(Math.abs(row.kFactor - k)).toBeLessThan(1e-6);

    console.log(`[REF-PART 3] SCORECARD L-channel flat: blank ${meta!.width.toFixed(1)}×${meta!.length.toFixed(1)}, `
      + `BA=${ba.toFixed(2)} (K=${k}), bentSizeZ=${bentSizeZ.toFixed(1)}, developed(=original blank)=${BL}`);

    // Honest developed length is the ORIGINAL 160 mm blank (the bend consumed
    // arc out of it). The production formula walks the FOLDED bbox instead.
    if (Math.abs(meta!.length - BL) > 5) {
      recordFinding({
        part: 'P3 U-channel',
        severity: 'critical',
        title: 'flat-pattern developed length computed from the FOLDED bbox',
        detail: `generateFlatPattern walks bb.min.z..bb.max.z of the bent body (features/sheetMetal.ts:594-634): `
          + `blank length ${meta!.length.toFixed(1)} mm vs the true developed ≈ ${BL} mm — the folded flange's `
          + 'height is not unfolded into the blank. Cutting this DXF yields a short part.',
      });
      // Pin the actual formula so a fix is detected.
      expect(Math.abs(meta!.length - (bentSizeZ + ba))).toBeLessThan(2);
    }

    // Flat-pattern DXF IR through the real exporter.
    const entities = flatPatternToDXFEntities({ geometry: res.geometry, ...meta! });
    const cut = entities.filter(e => e.layer === 'CUT');
    const bendLines = entities.filter(e => e.layer === 'BEND_UP' || e.layer === 'BEND_DOWN');
    const notes = entities.filter(e => e.layer === 'ANNOTATE');
    expect(cut.length).toBeGreaterThanOrEqual(1);
    expect(bendLines).toHaveLength(1);
    expect(notes.length).toBeGreaterThanOrEqual(3); // label + table header + row
    console.log(`[REF-PART 3] flat DXF IR: ${entities.length} entities (${cut.length} cut, ${bendLines.length} bend, ${notes.length} annotate)`);

    // exportDXF resolves headlessly but produces NOTHING observable (downloadBlob
    // early-returns without window) — there is no public DXF-string API.
    await expect(exportDXF(entities, 'ref-part-3')).resolves.toBeUndefined();
    recordFinding({
      part: 'P3 U-channel',
      severity: 'minor',
      title: 'no headless DXF text accessor for the flat pattern',
      detail: 'io/dxfExporter.ts keeps generateDXFText private; exportDXF → downloadBlob no-ops without a DOM '
        + '(lib/platform/downloadBlob.ts:15). Server-side / CI export of the flat-pattern DXF text is impossible.',
    });
  }, 60_000);

  it('sheet IR + real drawing exporters (SVG / DXF / PDF) for the U-channel', async () => {
    const geo = buildUChannelDirect();
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new THREE.Vector3());

    // Sheet IR — auto view layout on A3.
    const layout = planSheetLayout({
      sheet: 'A3',
      bbox: { widthMm: size.x, depthMm: size.z, heightMm: size.y },
      views: ['front', 'top', 'side', 'iso'],
    });
    expect(layout.overflowed).toBe(false);
    expect(layout.views).toHaveLength(4);
    for (const v of layout.views) {
      expect(v.footprintMm.w).toBeGreaterThan(0);
      expect(v.footprintMm.h).toBeGreaterThan(0);
    }

    // Real projection pipeline (HLR heuristic) + the three exporters.
    const drawing = generateDrawing(geo, drawingConfig);
    expect(drawing.views.length).toBe(4);
    for (const v of drawing.views) expect(v.lines.length).toBeGreaterThan(0);

    const svg = buildDrawingSvgString(drawing);
    expect(svg).toContain('<svg');
    expect(svg.length).toBeGreaterThan(2000);

    const dxf = buildDrawingDxfString(drawing);
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('U-CHANNEL-CHASSIS');
    expect(dxf.length).toBeGreaterThan(3000);

    const pdf = await buildDrawingPdfArrayBuffer(drawing);
    expect(pdf.byteLength).toBeGreaterThan(2000);
    console.log(`[REF-PART 3] SCORECARD drawing: scale 1:${layout.scaleDenominator}, svg=${svg.length}B, dxf=${dxf.length}B, pdf=${pdf.byteLength}B`);
  }, 60_000);
});
