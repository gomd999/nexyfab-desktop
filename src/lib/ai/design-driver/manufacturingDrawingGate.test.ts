import { describe, expect, it } from 'vitest';
import type { DrawingArtifact, PlannedMeasurement } from './drawingGate';
import type { ExactDrawingArtifact, ExactDrawingViewArtifact } from './exactDrawingGate';
import {
  buildManufacturingDrawingArtifact,
  manufacturingDrawingGate,
} from './manufacturingDrawingGate';
import type { DesignPlan, PlanPart } from './types';

const SOURCE_HASH = 'a'.repeat(64);

function exactView(view: 'front' | 'top' | 'right'): ExactDrawingViewArtifact {
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">',
    '<g id="visible"><path data-layer="visible" d="M 0 0 L 40 0 L 40 20 L 0 20 Z"/></g>',
    '<g id="hidden"><path data-layer="hidden" d="M 5 10 L 35 10"/></g>',
    '</svg>',
  ].join('\n');
  return {
    bodyId: 'body-1',
    view,
    method: 'replicad-hlr',
    visiblePathCount: 1,
    hiddenPathCount: 1,
    analyticCurveEvidence: false,
    sourceStepSha256: SOURCE_HASH,
    svgSha256: 'b'.repeat(64),
    svg,
    curveRecordSha256: 'c'.repeat(64),
    curveCount: 2,
    curveTypes: [1],
    exactDxfSha256: 'd'.repeat(64),
    exactDxf: '0\nEOF\n',
  };
}

function fixture(dimensionCount: number): {
  part: PlanPart;
  plan: DesignPlan;
  exact: ExactDrawingArtifact;
  drawing: DrawingArtifact;
} {
  const part = {
    partId: 'part-1',
    name: 'Commercial bracket',
    material: '6061-T6',
    bodies: [{ bodyId: 'body-1' }],
  } as PlanPart;
  const measurements: PlannedMeasurement[] = Array.from({ length: dimensionCount }, (_, index) => ({
    spec: {
      id: `dim-${String(index + 1).padStart(3, '0')}`,
      partId: part.partId,
      bodyId: 'body-1',
      view: index % 2 === 0 ? 'front' : 'top',
      kind: 'linear',
      refs: ['f.cap.bottom', 'f.cap.top'],
      expected: index + 1,
      tolerance: { kind: 'bilateral', upper: 0.1, lower: 0.1 },
    },
    viewportId: index % 2 === 0 ? 'front' : 'top',
    result: { ok: true, kind: 'linear', value: index + 1, valueBasis: 'projected', unit: 'mm' },
  }));
  const plan = {
    planId: 'plan-commercial-drawing',
    parts: [part],
    drawing: { paperSize: 'A3', scale: 1, dimensions: measurements.map(item => item.spec) },
  } as DesignPlan;
  return {
    part,
    plan,
    exact: { ok: true, partId: part.partId, views: ['front', 'top', 'right'].map(view => exactView(view as 'front' | 'top' | 'right')) },
    drawing: { sheets: new Map(), topologies: new Map(), measurements, buildErrors: [] },
  };
}

describe('manufacturingDrawingGate', () => {
  it('combines exact HLR geometry, measured dimensions, traceability, and explicit review status', () => {
    const { plan, part, exact, drawing } = fixture(4);
    const artifact = buildManufacturingDrawingArtifact(plan, part, exact, drawing);
    expect(artifact.ok).toBe(true);
    expect(artifact.releaseEligible).toBe(false);
    expect(artifact.sheets).toHaveLength(1);
    expect(artifact.sheets[0]).toMatchObject({
      role: 'geometry-and-dimensions',
      exactViewCount: 3,
      dimensionCount: 4,
      releaseStatus: 'engineering-review-required',
      sourceStepSha256: SOURCE_HASH,
    });
    expect(artifact.sheets[0]!.svg).toContain('VERIFIED STEP/OCCT HLR');
    expect(artifact.sheets[0]!.svg).toContain('ENGINEERING REVIEW REQUIRED · NOT RELEASED');
    expect(artifact.sheets[0]!.svg).toContain('± 0.1');
    expect(artifact.sheets[0]!.svg).toContain('data-source-step-sha256');
    expect(manufacturingDrawingGate(part, artifact).pass).toBe(true);
  });

  it('creates deterministic continuation sheets without dropping complex-product dimensions', () => {
    const { plan, part, exact, drawing } = fixture(67);
    const artifact = buildManufacturingDrawingArtifact(plan, part, exact, drawing);
    expect(artifact.ok).toBe(true);
    expect(artifact.sheets.map(sheet => sheet.dimensionCount)).toEqual([18, 48, 1]);
    expect(artifact.sheets.map(sheet => sheet.sheetNumber)).toEqual([1, 2, 3]);
    expect(artifact.sheets.every(sheet => sheet.sheetCount === 3)).toBe(true);
    expect(artifact.includedDimensionCount).toBe(67);
    expect(manufacturingDrawingGate(part, artifact)).toMatchObject({
      pass: true,
      metrics: { totalSheetCount: 3, plannedDimensionCount: 67, includedDimensionCount: 67 },
    });
  });

  it('fails closed on active SVG content and on a tampered packaged sheet', () => {
    const { plan, part, exact, drawing } = fixture(1);
    exact.views[0]!.svg = exact.views[0]!.svg.replace('</svg>', '<script>alert(1)</script></svg>');
    const refused = buildManufacturingDrawingArtifact(plan, part, exact, drawing);
    expect(refused).toMatchObject({ ok: false, sheets: [] });
    expect(refused.reason).toMatch(/disallowed active/i);

    const clean = fixture(1);
    const built = buildManufacturingDrawingArtifact(clean.plan, clean.part, clean.exact, clean.drawing);
    built.sheets[0]!.svg += '<!-- tampered -->';
    expect(manufacturingDrawingGate(clean.part, built)).toMatchObject({ pass: false });
  });
});
