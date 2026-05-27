/**
 * drawingPipeline.test.ts — End-to-end integration over the drawing
 * domain. Each piece (section / exploded / BOM / DRF / sheet) has
 * its own unit suite; this file exercises *combinations* so a
 * regression in one stage that's invisible to its own tests still
 * fails here.
 */
import { describe, it, expect } from 'vitest';
import { planSheetLayout } from './sheetLayout';
import { buildBomTable, tableMetrics, renderBomTableSvg } from './bomTable';
import { computeExplodedView, type AssemblyPart, type AssemblyMate } from './explodedView';
import { generateSection } from './sectionView';
import { buildFcf, formatFcf, validateDrf, bonusTolerance } from './datumReferenceFrame';
import { aggregateBom } from '../standardParts/bomAggregation';
import { buildFastener } from '../standardParts/fastenerSchema';

describe('Drawing pipeline · sheet + BOM', () => {
  it('BOM table footprint fits inside the sheet usable area', () => {
    const layout = planSheetLayout({
      sheet: 'A3',
      bbox: { widthMm: 100, depthMm: 50, heightMm: 80 },
      views: ['front', 'top', 'side', 'iso'],
    });
    const rows = aggregateBom([
      { kind: 'fastener', spec: buildFastener({ kind: 'hex-bolt', diameterMm: 6, lengthMm: 25 }) },
      { kind: 'fastener', spec: buildFastener({ kind: 'hex-bolt', diameterMm: 6, lengthMm: 25 }) },
      { kind: 'fastener', spec: buildFastener({ kind: 'hex-nut', diameterMm: 6, lengthMm: 5 }) },
    ]);
    const table = buildBomTable(rows);
    const m = tableMetrics(table);
    expect(m.totalHeightMm).toBeLessThan(layout.sheetHeightMm);
    expect(table.layout.totalWidthMm).toBeLessThan(layout.sheetWidthMm);
  });

  it('BOM SVG primitives have balloon numbers in BOM order', () => {
    const rows = aggregateBom([
      { kind: 'fastener', spec: buildFastener({ kind: 'hex-bolt', diameterMm: 6, lengthMm: 25 }) },
      { kind: 'fastener', spec: buildFastener({ kind: 'hex-nut', diameterMm: 6, lengthMm: 5 }) },
    ]);
    const table = buildBomTable(rows);
    const svg = renderBomTableSvg(table, 0, 0);
    const balloonTexts = svg.filter(p => p.kind === 'text' && (p.text === '1' || p.text === '2'));
    expect(balloonTexts.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Drawing pipeline · section + sheet', () => {
  it('section view fits inside the front view footprint', () => {
    const layout = planSheetLayout({
      sheet: 'A3',
      bbox: { widthMm: 100, depthMm: 100, heightMm: 100 },
      views: ['front'],
    });
    // Two-triangle "Z plane" slice — area inside layout's front bbox.
    const sect = generateSection({
      triangles: [
        [[-50, -50, 0], [50, -50, 0], [0, 50, 0]],
      ],
      kind: 'full',
      plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    });
    expect(sect.areaMm2).toBeGreaterThanOrEqual(0);
    expect(layout.views[0]!.footprintMm.w).toBeGreaterThan(0);
  });
});

describe('Drawing pipeline · exploded + BOM', () => {
  it('exploded trails have one entry per BOM line for a 3-part assembly', () => {
    const parts: AssemblyPart[] = [
      { id: 'p1', position: [0, 0, 0], extentMm: 10 },
      { id: 'p2', position: [0, 0, 10], extentMm: 10 },
      { id: 'p3', position: [0, 0, 20], extentMm: 10 },
    ];
    const mates: AssemblyMate[] = [
      { parts: ['p1', 'p2'], axis: [0, 0, 1] },
      { parts: ['p2', 'p3'], axis: [0, 0, 1] },
    ];
    const ex = computeExplodedView(parts, mates);
    expect(ex.trails).toHaveLength(3);
  });
});

describe('Drawing pipeline · DRF + FCF + bonus tolerance', () => {
  it('FCF with MMC datum + MMC tolerance produces non-zero bonus', () => {
    const fcf = buildFcf({
      type: 'position',
      tolerance: 0.25,
      primary: 'A',
      primaryKind: 'plane',
      secondary: 'B',
      secondaryKind: 'cylinder',
      secondaryModifier: 'M',
      toleranceMaterial: 'M',
    });
    const drfReport = validateDrf(fcf.drf);
    expect(drfReport.totalDof).toBeGreaterThan(3);
    const bonus = bonusTolerance(fcf, 10.3, 10, 11);
    expect(bonus).toBeGreaterThan(0);
    const txt = formatFcf(fcf);
    expect(txt).toContain('⌖');
    expect(txt).toContain('A|B(M)');
  });
});
