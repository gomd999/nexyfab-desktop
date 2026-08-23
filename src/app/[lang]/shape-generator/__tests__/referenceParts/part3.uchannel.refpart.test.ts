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
import { buildFlatPatternDXFText, flatPatternToDXFEntities, exportDXF } from '../../io/dxfExporter';
import { generateDrawing } from '../../analysis/autoDrawing';
import {
  buildDrawingSvgString,
  buildDrawingDxfString,
  buildDrawingPdfArrayBuffer,
} from '../../analysis/drawingExport';
import { planSheetLayout } from '../../drawing/sheetLayout';
import { meshVolume, recordFinding, stampedBox } from './refPartsHarness';

// W1-A (R0-0): default ON. This suite is the OCCT kernel's real-behaviour gate;
// leaving it opt-IN meant it never ran in CI. Measured cost of enabling: ~18s
// wall across the whole __tests__ dir. Set RUN_OCCT_FEASIBILITY=0 to opt out.
const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
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
 *  applyTab) on the DEFAULT box base (uv intact — the meshMerge unification
 *  layer aligns the attribute sets; the old uv-strip workaround is gone). */
function buildUChannelDirect(): THREE.BufferGeometry {
  const base = defaultBoxBase();
  const f1 = applyFlange(base, { height: FLANGE_H, angle: 90, radius: R, edgeIndex: 0 });
  const f2 = applyFlange(f1, { height: FLANGE_H, angle: 90, radius: R, edgeIndex: 1 });
  return applyTab(f2, { width: 20, length: 10, position: 0.5, edgeIndex: 2 });
}

describeMaybe('REF-PART 3 · sheet-metal U-channel chassis', () => {
  it('flange on the DEFAULT box base applies through the pipeline (FIXED — was a pinned finding)', async () => {
    cacheClear();
    const base = defaultBoxBase();
    const baseVerts = base.attributes.position.count;
    const res = await applyFeaturePipelineDetailedAsync(base, [flange('s-f-probe', 0)], { occtMode: false });
    console.log(`[REF-PART 3] flange-on-default-base error: ${res.errors['s-f-probe'] ?? '(none)'}`);
    // FIXED (meshMerge unification): applyFlange aligns the uv-carrying
    // BoxGeometry base with its position-only flange mesh instead of letting
    // mergeGeometries hard-fail ("Failed to merge flange geometry").
    expect(res.errors['s-f-probe']).toBeUndefined();
    expect(res.geometry.attributes.position.count).toBeGreaterThan(baseVerts);
  }, 60_000);

  it('flange → flange (U-channel) builds through the PIPELINE (FIXED — was a pinned finding)', async () => {
    cacheClear();
    // Default base, uv intact, AND the pipeline's per-vertex provenance stamp
    // on the first flange's output — both used to break the second merge.
    const res = await applyFeaturePipelineDetailedAsync(
      defaultBoxBase(), [flange('s-f1', 0), flange('s-f2', 1)], { occtMode: false });
    console.log(`[REF-PART 3] second-flange errors: ${JSON.stringify(res.errors)}`);
    expect(Object.entries(res.errors)).toEqual([]);
    res.geometry.computeBoundingBox();
    const bb = res.geometry.boundingBox!;
    // Two upstanding flanges → a real U-channel silhouette.
    expect(bb.max.y - bb.min.y).toBeGreaterThan(FLANGE_H * 0.6);
    expect(bb.max.z - bb.min.z).toBeGreaterThan(BL); // both ends flanged outward
    console.log(`[REF-PART 3] pipeline U-channel bbox ${(bb.max.x - bb.min.x).toFixed(1)}×${(bb.max.y - bb.min.y).toFixed(1)}×${(bb.max.z - bb.min.z).toFixed(1)}`);
  }, 60_000);

  it('bendRelief with NO bend in the history fails CLEAN with a clear message (FIXED — was an attribute crash)', async () => {
    cacheClear();
    const res = await applyFeaturePipelineDetailedAsync(defaultBoxBase(), [relief('s-r-probe', 50)], { occtMode: false });
    console.log(`[REF-PART 3] bendRelief-on-default-base error: ${res.errors['s-r-probe'] ?? '(none)'}`);
    // FIXED: the relief locates its bend from __bendHistory. A flat plate with
    // no bend has nothing to relieve — the old behaviour was a three-bvh-csg
    // crash on a missing attribute; now it is a descriptive feature error.
    expect(res.errors['s-r-probe']).toBeDefined();
    expect(res.errors['s-r-probe']).toMatch(/requires a bend/i);
    expect(res.errors['s-r-probe']).not.toMatch(/array|attribute/i);
  }, 60_000);

  it('bendRelief AFTER a bend locates the bend line from the history and cuts (pipeline)', async () => {
    cacheClear();
    const res = await applyFeaturePipelineDetailedAsync(
      stampedBox(BW, BT, BL),
      [bend('s-r-bend', 75), relief('s-r-after', 75)],
      { occtMode: false },
    );
    console.log(`[REF-PART 3] bend→relief errors: ${JSON.stringify(res.errors)}`);
    expect(Object.entries(res.errors)).toEqual([]);
    expect(res.geometry.attributes.position.count).toBeGreaterThan(0);
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

  it('flat pattern of the flange-built U-channel: 2 bend rows + exact developed length (FIXED — table was EMPTY)', async () => {
    cacheClear();
    // flatPattern runs as a pipeline feature on the direct-built channel.
    const res = await applyFeaturePipelineDetailedAsync(buildUChannelDirect(), [flatPattern('s-fp-flat')], { occtMode: false });
    expect(Object.entries(res.errors)).toEqual([]);
    const meta = getFlatPatternMetadata(res.geometry);
    expect(meta).not.toBeNull();
    console.log(`[REF-PART 3] flange flat pattern: bends=${meta!.bendTable.length}, blank=${meta!.width.toFixed(1)}×${meta!.length.toFixed(1)}`);
    // FIXED: applyFlange now records __bendHistory like applyBend, so the
    // flat pattern sees both flange bends and the laser DXF carries them.
    expect(meta!.bendTable).toHaveLength(2);
    // Closed form — U-channel = 3 flats + 2 BA:
    //   flats = base blank 160 + two flange legs (height − radius = 27 each).
    const k = getKFactor('mildSteel', R, BT);
    const ba = bendAllowance(90, R, BT, k);
    const leg = FLANGE_H - R;
    expect(meta!.length).toBeCloseTo(BL + 2 * (leg + ba), 4);
    // Width = extent along the bend-line axis — the 10 mm +X mounting tab
    // (applyTab in buildUChannelDirect) widens the blank to 90.
    expect(meta!.width).toBeCloseTo(BW + 10, 4);
    for (const row of meta!.bendTable) {
      expect(row.angle).toBe(90);
      expect(row.radius).toBe(R);
      expect(Math.abs(row.bendAllowance - ba)).toBeLessThan(1e-6);
    }
    // Bend lines on the blank: end of the leading leg / end of the base blank.
    expect(meta!.bendTable[0].position).toBeCloseTo(leg, 4);
    expect(meta!.bendTable[1].position).toBeCloseTo(leg + ba + BL, 4);
    console.log(`[REF-PART 3] SCORECARD U-channel flat: blank ${meta!.width.toFixed(1)}×${meta!.length.toFixed(1)} `
      + `(= 3 flats [${leg}, ${BL}, ${leg}] + 2×BA ${ba.toFixed(3)})`);
  }, 60_000);

  it('L-channel via bend + relief → flat pattern with a real bend table → flat-pattern DXF', async () => {
    cacheClear();
    // The relief locates the bend from __bendHistory, so the bend comes first
    // in the stack and the relief aligns itself to the recorded bend line.
    const res = await applyFeaturePipelineDetailedAsync(
      stampedBox(BW, BT, BL),
      [bend('s-l-bend', 75), relief('s-l-relief', 75), flatPattern('s-l-flat')],
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

    // FIXED: developed length comes from the bend history (flats + BA), not
    // from walking the FOLDED bbox (which gave 131.1 mm for this part).
    // Closed form — blank = flat1 + flat2 + BA EXACTLY, where the fold
    // consumes its bend allowance out of the original 160 mm blank:
    //   flat1 = 120 (bend line), flat2 = 160 − 120 − BA.
    const flat1 = BL * 0.75;
    const flat2 = BL - flat1 - ba;
    expect(meta!.length).toBeCloseTo(flat1 + ba + flat2, 6);
    expect(meta!.length).toBeCloseTo(BL, 6); // = the original blank
    expect(row.position).toBeCloseTo(flat1, 6);
    expect(meta!.width).toBeCloseTo(BW, 4);

    console.log(`[REF-PART 3] SCORECARD L-channel flat: blank ${meta!.width.toFixed(1)}×${meta!.length.toFixed(1)} `
      + `(= flat1 ${flat1} + BA ${ba.toFixed(3)} + flat2 ${flat2.toFixed(3)}), K=${k}`);

    // Flat-pattern DXF IR through the real exporter.
    const entities = flatPatternToDXFEntities({ geometry: res.geometry, ...meta! });
    const cut = entities.filter(e => e.layer === 'CUT');
    const bendLines = entities.filter(e => e.layer === 'BEND_UP' || e.layer === 'BEND_DOWN');
    const notes = entities.filter(e => e.layer === 'ANNOTATE');
    expect(cut.length).toBeGreaterThanOrEqual(1);
    expect(bendLines).toHaveLength(1);
    expect(notes.length).toBeGreaterThanOrEqual(3); // label + table header + row
    console.log(`[REF-PART 3] flat DXF IR: ${entities.length} entities (${cut.length} cut, ${bendLines.length} bend, ${notes.length} annotate)`);

    // The browser download path remains available; the public text serializer
    // makes the same deterministic content observable to server/CI callers.
    const text = buildFlatPatternDXFText({ geometry: res.geometry, ...meta! });
    expect(text).toContain('BEND TABLE');
    expect(text).toContain('BEND_UP');
    await expect(exportDXF(entities, 'ref-part-3')).resolves.toBeUndefined();
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
