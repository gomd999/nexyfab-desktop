/**
 * dxfExportDimensions.test.ts — W4 G2 follow-up: DXF(R12) dimension carry.
 *
 * The G2 gate's pinned limitation was "R12 DXF path has NO dimension
 * entities". This suite proves the fix by EXECUTION (실행하지 않은 판정은
 * 판정이 아니다):
 *
 *   (a) backward compat — without `opts.topologies` the exporter's output
 *       is byte-identical whether or not the sheet carries dimensions, and
 *       contains no DIM layers (the pre-W4 stream);
 *   (b) with topologies, the SAME L-bracket + boss fixture the G2 harness
 *       measures produces a DXF whose TEXT payloads carry the REAL measured
 *       values ('60', '12', '%%c50' = ⌀50, '90%%d' = 90°) on DIM_<id>
 *       layers, with LINE dimension/extension lines + SOLID arrowheads;
 *   (c) an unmeasurable dimension (lost topo ref) emits NO number — the
 *       `<kind>` placeholder text plus a 999 comment with the explicit
 *       failure reason (값 날조 금지);
 *   (d) drafting glyphs travel as R12 %%-codes, incl. tolerance ± → %%p.
 *
 * NOTE on entity choice: values ride as exploded LINE+SOLID+TEXT, NOT a
 * true DIMENSION entity — an R12 DIMENSION renders only through its
 * anonymous `*D` BLOCKS-section block, which this minimal exporter does not
 * emit; a blockless DIMENSION is blank in strict viewers. Rationale is
 * documented in dxfExport.ts's module header.
 */
import { describe, it, expect } from 'vitest';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import { validateSheet } from '@/lib/drawing/sheet';
import type { Dimension } from '@/lib/drawing/dimension';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { buildExtrudeTopo, type NamedTopology } from '@/lib/cad/topoNaming';
import { measureSheetDimension, formatMeasuredValue } from '@/lib/drawing/associativeUpdate';
import { sheetToDxf } from '@/lib/drawing/dxfExport';

// ─── fixtures — SAME part as the G2 harness (g2MachinedPartGate.test.tsx) ─

/** L-브래킷: 60×50 L-프로파일 × 두께 12. */
function lBracket(): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 50 },
      { x: 0, y: 50 },
    ],
    depth: 12,
    direction: 'one_sided',
    mode: 'add',
  };
}

/** ⌀50 원형 보스(16각 근사 — 캡 정점은 진원 위). */
function boss(): ExtrudeFeature {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 16; i += 1) {
    const th = (2 * Math.PI * i) / 16;
    pts.push({ x: 25 * Math.cos(th), y: 25 * Math.sin(th) });
  }
  return { kind: 'extrude', loop: pts, depth: 30, direction: 'one_sided', mode: 'add' };
}

function vp(id: string, sourceId: string, view: 'front' | 'top', x: number): Viewport {
  return {
    id,
    sourceId,
    projection: { kind: 'standard', view },
    centerOnSheet: { x, y: 160 },
    widthOnSheet: 110,
    scale: 1,
    label: id.toUpperCase(),
  };
}

const DIMS: ReadonlyArray<Dimension> = [
  { id: 'd-width', viewportId: 'front', kind: 'linear', refs: ['f.side.5', 'f.side.1'] }, // 60
  { id: 'd-thick', viewportId: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'] }, // 12
  { id: 'd-angle', viewportId: 'front', kind: 'angular', refs: ['e.bottom.0-1', 'e.vert.1'] }, // 90°
  { id: 'd-boss', viewportId: 'boss-top', kind: 'diametric', refs: ['f.cap.top'] }, // ⌀50
];

function makeSheet(extraDims: ReadonlyArray<Dimension> = []): Sheet {
  return {
    id: 'dxf-dim-sheet',
    name: 'DXF dimension carry — L-bracket + boss',
    paperSize: 'A3',
    viewports: [
      vp('front', 'dxf-bracket', 'front', 80),
      vp('boss-top', 'dxf-boss', 'top', 340),
    ],
    dimensions: [...DIMS, ...extraDims],
  };
}

function topoMap(): Map<string, NamedTopology> {
  return new Map([
    ['dxf-bracket', buildExtrudeTopo(lBracket())],
    ['dxf-boss', buildExtrudeTopo(boss())],
  ]);
}

/**
 * Extract TEXT payloads (the value line after each group-code-1 line).
 * emit() renders code 1 as '  1' (right-justified, 3 chars) — matching on
 * the exact code line avoids false hits on coordinates like '160'.
 */
function textPayloads(dxf: string): string[] {
  const lines = dxf.split('\n');
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (l === '  1' && i + 1 < lines.length) out.push(lines[i + 1]!);
  });
  return out;
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('sheetToDxf — dimension carry (W4 G2 limitation lifted)', () => {
  it('(a) without topologies the output is byte-identical to the pre-W4 stream (dimensions inert)', () => {
    const withDims = makeSheet();
    validateSheet(withDims);
    const noDims: Sheet = { ...withDims, dimensions: [] };

    // Dimensions present but no topologies → EXACTLY the same bytes as a
    // dimensionless sheet, and the same whether opts is omitted or empty.
    expect(sheetToDxf(withDims)).toBe(sheetToDxf(noDims));
    expect(sheetToDxf(withDims)).toBe(sheetToDxf(withDims, {}));
    expect(sheetToDxf(withDims)).not.toContain('DIM_');
    expect(sheetToDxf(withDims)).not.toContain('SOLID');
  });

  it('(b) with topologies the DXF carries REAL measured values on DIM_<id> layers', () => {
    const sheet = makeSheet();
    const topologies = topoMap();

    // Cross-check the ground truth through the same measurement engine the
    // exporter uses — the numbers asserted below are executed, not assumed.
    const width = measureSheetDimension(DIMS[0]!, sheet.viewports, topologies);
    const thick = measureSheetDimension(DIMS[1]!, sheet.viewports, topologies);
    if (!width?.ok || !thick?.ok) throw new Error('fixture measurement failed');
    expect(formatMeasuredValue(width.value)).toBe('60');
    expect(formatMeasuredValue(thick.value)).toBe('12');

    const dxf = sheetToDxf(sheet, { topologies });
    // One dedicated layer per dimension.
    for (const d of DIMS) expect(dxf, d.id).toContain(`DIM_${d.id}`);
    // Measured values ride as TEXT payloads with R12 %%-glyph encoding.
    const texts = textPayloads(dxf);
    expect(texts).toContain('60');
    expect(texts).toContain('12');
    expect(texts).toContain('90%%d'); // 90°
    expect(texts).toContain('%%c50'); // ⌀50
    // Structure: dimension/extension LINEs + filled SOLID arrowheads exist
    // on a DIM layer (2 arrowheads per measured dimension → 8 SOLIDs).
    const solidCount = (dxf.match(/^SOLID$/gm) ?? []).length;
    expect(solidCount).toBe(DIMS.length * 2);
    // No unmeasured-dimension comments for this fully-measurable sheet.
    expect(dxf).not.toContain('NEXYFAB_DIM_UNMEASURED');
    // Placeholder text never appears when everything measured.
    expect(texts.some((t) => t.startsWith('<'))).toBe(false);
  });

  it('(c) a lost topo ref emits NO number — <kind> placeholder + 999 reason comment', () => {
    const broken: Dimension = {
      id: 'd-broken', viewportId: 'front', kind: 'linear', refs: ['f.side.99', 'f.side.1'],
    };
    const sheet = makeSheet([broken]);
    const dxf = sheetToDxf(sheet, { topologies: topoMap() });

    // Explicit failure comment with the measure engine's reason.
    expect(dxf).toMatch(/NEXYFAB_DIM_UNMEASURED:d-broken reason=unresolved-ref/);
    // The broken dimension's label is the placeholder, not a number.
    const texts = textPayloads(dxf);
    expect(texts).toContain('<linear>');
    // Its layer still exists (the call is drawn, value honestly withheld).
    expect(dxf).toContain('DIM_d-broken');
  });

  it('(c2) a viewport whose source has no topology → no-measurement-context comment, no number', () => {
    const sheet = makeSheet();
    // Supply ONLY the boss topo — bracket dims lose their context.
    const topologies = new Map([['dxf-boss', buildExtrudeTopo(boss())]]);
    const dxf = sheetToDxf(sheet, { topologies });
    expect(dxf).toMatch(/NEXYFAB_DIM_UNMEASURED:d-width reason=no-measurement-context/);
    const texts = textPayloads(dxf);
    expect(texts).toContain('<linear>');
    expect(texts).toContain('%%c50'); // the boss dim still measures for real
    expect(texts).not.toContain('60'); // no fabricated bracket numbers
  });

  it('(d) tolerance ± is encoded as the R12 %%p control code', () => {
    const toleranced: Dimension = {
      id: 'd-tol', viewportId: 'front', kind: 'linear',
      refs: ['f.side.5', 'f.side.1'],
      tolerance: { kind: 'bilateral', upper: 0.1, lower: 0.1 },
    };
    const sheet = makeSheet([toleranced]);
    const dxf = sheetToDxf(sheet, { topologies: topoMap() });
    const texts = textPayloads(dxf);
    expect(texts).toContain('60 %%p 0.1');
  });
});
