import { describe, it, expect } from 'vitest';
import {
  extractHoleMeta,
  aggregateHoleMeta,
  projectAndAggregate,
} from '../holeMeta';
import type {
  HoleArrayDefinition,
  HoleSpec,
  DrilledHoleSpec,
  CounterboreHoleSpec,
  CountersinkHoleSpec,
  CounterdrillHoleSpec,
  TapHoleSpec,
  PipeTapHoleSpec,
} from '../holeArray';

// ─── Fixture builders ──────────────────────────────────────────────────────

function makeManualDef(
  id: string,
  designation: string,
  points: Array<{ id: string; x: number; y: number }>,
  termination: HoleArrayDefinition['terminationParams'] = { kind: 'through' },
): HoleArrayDefinition {
  return {
    id,
    kind: 'manual',
    params: { kind: 'manual', data: { points } },
    holeSpec: { series: 'ISO', designation, fitClass: 'normal' },
    terminationKind: termination.kind,
    terminationParams: termination,
  };
}

function makeLinearDef(
  id: string,
  designation: string,
  count: number,
  termination: HoleArrayDefinition['terminationParams'] = { kind: 'through' },
): HoleArrayDefinition {
  return {
    id,
    kind: 'linear',
    params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 10, dy: 0, count } },
    holeSpec: { series: 'ISO', designation, fitClass: 'normal' },
    terminationKind: termination.kind,
    terminationParams: termination,
  };
}

function makeRectDef(
  id: string,
  designation: string,
  rows: number,
  cols: number,
): HoleArrayDefinition {
  return {
    id,
    kind: 'rect',
    params: { kind: 'rect', data: { startX: 0, startY: 0, stepX: 10, stepY: 10, rows, cols } },
    holeSpec: { series: 'ISO', designation, fitClass: 'normal' },
    terminationKind: 'through',
    terminationParams: { kind: 'through' },
  };
}

function makeCircularDef(
  id: string,
  designation: string,
  count: number,
): HoleArrayDefinition {
  return {
    id,
    kind: 'circular',
    params: { kind: 'circular', data: { centerX: 0, centerY: 0, radius: 20, count, startAngle: 0 } },
    holeSpec: { series: 'ISO', designation, fitClass: 'normal' },
    terminationKind: 'through',
    terminationParams: { kind: 'through' },
  };
}

function drilled(diameter: number): DrilledHoleSpec {
  return { kind: 'drilled', diameter, drillTipAngle: 118 };
}

function cbore(d: number, hd: number, hdp: number): CounterboreHoleSpec {
  return { kind: 'counterbore', diameter: d, headDiameter: hd, headDepth: hdp, drillTipAngle: 118 };
}

function csk(d: number, cd: number, ca = 90): CountersinkHoleSpec {
  return { kind: 'countersink', diameter: d, coneDiameter: cd, coneAngle: ca, drillTipAngle: 118 };
}

function cdrill(): CounterdrillHoleSpec {
  return {
    kind: 'counterdrill',
    diameter: 5,
    headDiameter: 15,
    headDepth: 5,
    middleDiameter: 8,
    middleDepth: 8,
    drillTipAngle: 118,
  };
}

function tap(d: number, pitch: number, tapDepth: number): TapHoleSpec {
  return {
    kind: 'tap',
    diameter: d,
    pitch,
    tapClass: '6H',
    tapDepth,
    drillTipAngle: 118,
  };
}

function pipeTap(
  d = 11.43,
  taper = 1.7833,
  cls: PipeTapHoleSpec['pipeTapClass'] = 'NPT',
): PipeTapHoleSpec {
  return {
    kind: 'pipe_tap',
    diameter: d,
    pipeStandard: 'NPT',
    pipeSizeKey: '1/4-18',
    engagementDepth: 10,
    pipeTapClass: cls,
    taperAngle: taper,
  };
}

// ─── extractHoleMeta — per hole-kind callout grammar ───────────────────────

describe('extractHoleMeta — callout grammar by kind', () => {
  it('drilled through emits "N × ØD THRU"', () => {
    const def = makeManualDef('arr-drill-1', 'M3', [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
      { id: 'p3', x: 0, y: 10 },
      { id: 'p4', x: 10, y: 10 },
    ]);
    const meta = extractHoleMeta(drilled(3.4), def);
    expect(meta.kind).toBe('drilled');
    expect(meta.count).toBe(4);
    expect(meta.callout.text).toBe('4 × Ø3.4 THRU');
    expect(meta.callout.drillDiameter).toBe(3.4);
    expect(meta.terminationSummary.kind).toBe('through');
    expect(meta.dfmFlags).toEqual([]);
  });

  it('drilled blind emits "N × ØD ▼ depth"', () => {
    const def = makeLinearDef('arr-blind', 'M3', 2, { kind: 'blind', depth: 8 });
    const meta = extractHoleMeta(drilled(3), def);
    expect(meta.callout.text).toBe('2 × Ø3 ▼ 8');
    expect(meta.terminationSummary.depthMm).toBe(8);
  });

  it('counterbore emits both bore and cbore glyphs', () => {
    const def = makeLinearDef('arr-cbore', 'M8', 1);
    const meta = extractHoleMeta(cbore(8, 14, 8.5), def);
    expect(meta.kind).toBe('counterbore');
    expect(meta.callout.text).toBe('Ø8 THRU, Ø14 ⌴ 8.5');
    expect(meta.callout.headDiameter).toBe(14);
  });

  it('countersink emits cone diameter + angle', () => {
    const def = makeLinearDef('arr-csk', 'M5', 1);
    const meta = extractHoleMeta(csk(5, 10, 90), def);
    expect(meta.callout.text).toBe('Ø5 THRU, Ø10 ⌵ 90°');
  });

  it('countersink at 82° (UTS default) renders the angle', () => {
    const def = makeLinearDef('arr-csk-uts', '1/4-20', 1);
    const meta = extractHoleMeta(csk(6.35, 12, 82), def);
    expect(meta.callout.text).toContain('⌵ 82°');
  });

  it('counterdrill emits three steps in head-middle-bore order', () => {
    const def = makeLinearDef('arr-cdrill', 'M5', 1);
    const meta = extractHoleMeta(cdrill(), def);
    expect(meta.callout.text).toContain('Ø15 ⌴ 5');
    expect(meta.callout.text).toContain('Ø8 ⌴ 8');
    expect(meta.callout.text).toContain('Ø5 THRU');
  });

  it('tap emits designation × pitch with TAP depth glyph', () => {
    const def = makeLinearDef('arr-tap', 'M6', 4, { kind: 'blind', depth: 15 });
    const meta = extractHoleMeta(tap(5, 1, 10), def);
    expect(meta.callout.text).toBe('4 × M6×1 ▼ 15, TAP ▼ 10');
    expect(meta.callout.pitch).toBe(1);
    expect(meta.threadRef).toBeDefined();
    expect(meta.threadRef?.family).toBe('metric');
    expect(meta.threadRef?.classCode).toBe('6H');
    expect(meta.threadRef?.pitchMm).toBe(1);
  });

  it('pipe_tap emits pipeStandard + engagement depth', () => {
    const def = makeLinearDef('arr-npt', '1/4-18', 1);
    const meta = extractHoleMeta(pipeTap(), def);
    expect(meta.callout.text).toBe('1/4-18 NPT ▼ 10');
    expect(meta.isPipe).toBe(true);
    expect(meta.isTapered).toBe(true);
    expect(meta.threadRef?.family).toBe('npt');
  });
});

// ─── threadRef derivation ──────────────────────────────────────────────────

describe('extractHoleMeta — threadRef', () => {
  it('tap on ANSI series surfaces UNC family', () => {
    const def: HoleArrayDefinition = {
      id: 'tap-uts',
      kind: 'linear',
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 10, dy: 0, count: 1 } },
      holeSpec: { series: 'ANSI', designation: '1/4-20 UNC' },
      terminationKind: 'through',
      terminationParams: { kind: 'through' },
    };
    const spec: TapHoleSpec = {
      kind: 'tap',
      diameter: 5.1,
      pitch: 1.27,
      tapClass: '2B',
      tapDepth: 6,
      drillTipAngle: 118,
    };
    const meta = extractHoleMeta(spec, def);
    expect(meta.threadRef?.family).toBe('unc');
    expect(meta.threadRef?.classCode).toBe('2B');
  });

  it('tap on ANSI UNF designation surfaces UNF family', () => {
    const def: HoleArrayDefinition = {
      id: 'tap-unf',
      kind: 'linear',
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 10, dy: 0, count: 1 } },
      holeSpec: { series: 'ANSI', designation: '1/4-28 UNF' },
      terminationKind: 'through',
      terminationParams: { kind: 'through' },
    };
    const spec: TapHoleSpec = {
      kind: 'tap',
      diameter: 5.5,
      pitch: 0.907,
      tapClass: '3B',
      tapDepth: 6,
      drillTipAngle: 118,
    };
    const meta = extractHoleMeta(spec, def);
    expect(meta.threadRef?.family).toBe('unf');
  });

  it('drilled holes carry no threadRef', () => {
    const meta = extractHoleMeta(drilled(5), makeLinearDef('d', 'M5', 1));
    expect(meta.threadRef).toBeUndefined();
  });

  it('pipe_tap BSP designation maps to bsp family', () => {
    const def: HoleArrayDefinition = {
      id: 'pt-bsp',
      kind: 'linear',
      params: { kind: 'linear', data: { startX: 0, startY: 0, dx: 10, dy: 0, count: 1 } },
      holeSpec: { series: 'BSP', designation: 'G1/4' },
      terminationKind: 'through',
      terminationParams: { kind: 'through' },
    };
    const spec: PipeTapHoleSpec = {
      kind: 'pipe_tap',
      diameter: 11,
      pipeStandard: 'BSPP',
      pipeSizeKey: 'G1/4',
      engagementDepth: 10,
      pipeTapClass: 'BSP_parallel',
      taperAngle: 0,
    };
    const meta = extractHoleMeta(spec, def);
    expect(meta.threadRef?.family).toBe('bsp');
    expect(meta.isTapered).toBe(false);
  });
});

// ─── count resolution ──────────────────────────────────────────────────────

describe('extractHoleMeta — count resolution', () => {
  it('linear: count comes from params.count', () => {
    const meta = extractHoleMeta(drilled(3), makeLinearDef('l', 'M3', 7));
    expect(meta.count).toBe(7);
  });

  it('rect: count = rows × cols', () => {
    const meta = extractHoleMeta(drilled(3), makeRectDef('r', 'M3', 3, 4));
    expect(meta.count).toBe(12);
  });

  it('circular: count = params.count', () => {
    const meta = extractHoleMeta(drilled(3), makeCircularDef('c', 'M3', 8));
    expect(meta.count).toBe(8);
  });

  it('manual: count comes from points array', () => {
    const meta = extractHoleMeta(
      drilled(3),
      makeManualDef('m', 'M3', [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 0 },
      ]),
    );
    expect(meta.count).toBe(2);
  });

  it('ctx.positions overrides — sketch-driven counts', () => {
    const def: HoleArrayDefinition = {
      id: 's',
      kind: 'fromSketch',
      params: { kind: 'fromSketch', data: { sketchFeatureId: 'sk1' } },
      holeSpec: { series: 'ISO', designation: 'M3' },
      terminationKind: 'through',
      terminationParams: { kind: 'through' },
    };
    const meta = extractHoleMeta(drilled(3), def, {
      positions: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 0 },
        { id: 'p3', x: 20, y: 0 },
      ],
    });
    expect(meta.count).toBe(3);
  });

  it('fromSketch without ctx.positions reports 0', () => {
    const def: HoleArrayDefinition = {
      id: 's-empty',
      kind: 'fromSketch',
      params: { kind: 'fromSketch', data: { sketchFeatureId: 'sk' } },
      holeSpec: { series: 'ISO', designation: 'M3' },
      terminationKind: 'through',
      terminationParams: { kind: 'through' },
    };
    const meta = extractHoleMeta(drilled(3), def);
    expect(meta.count).toBe(0);
  });
});

// ─── DFM flags ─────────────────────────────────────────────────────────────

describe('extractHoleMeta — DFM flags', () => {
  it('TAP_BOTTOM_RISK fires when tapDepth ≥ drillDepth', () => {
    const def = makeLinearDef('tap-bad', 'M6', 1, { kind: 'blind', depth: 8 });
    const meta = extractHoleMeta(tap(5, 1, 9), def);
    expect(meta.dfmFlags.find((f) => f.code === 'TAP_BOTTOM_RISK')?.severity).toBe('error');
  });

  it('TAP_BOTTOM_RISK warning fires within the 2×pitch buffer', () => {
    const def = makeLinearDef('tap-warn', 'M6', 1, { kind: 'blind', depth: 11 });
    const meta = extractHoleMeta(tap(5, 1, 10), def);
    const flag = meta.dfmFlags.find((f) => f.code === 'TAP_BOTTOM_RISK');
    expect(flag?.severity).toBe('warning');
  });

  it('TAP_BOTTOM_RISK not raised when margin ≥ 2×pitch', () => {
    const def = makeLinearDef('tap-ok', 'M6', 1, { kind: 'blind', depth: 15 });
    const meta = extractHoleMeta(tap(5, 1, 10), def);
    expect(meta.dfmFlags.find((f) => f.code === 'TAP_BOTTOM_RISK')).toBeUndefined();
  });

  it('SMALL_DRILL_AT_LARGE_DEPTH fires when ratio > 10', () => {
    const def = makeLinearDef('tiny-deep', 'M1', 1, { kind: 'blind', depth: 20 });
    const meta = extractHoleMeta(drilled(1), def);
    expect(meta.dfmFlags.find((f) => f.code === 'SMALL_DRILL_AT_LARGE_DEPTH')).toBeDefined();
  });

  it('SMALL_DRILL not raised for normal-size drill', () => {
    const def = makeLinearDef('m6-blind', 'M6', 1, { kind: 'blind', depth: 20 });
    const meta = extractHoleMeta(drilled(6), def);
    expect(meta.dfmFlags.find((f) => f.code === 'SMALL_DRILL_AT_LARGE_DEPTH')).toBeUndefined();
  });

  it('CLOSE_HOLE_SPACING fires with positions provided', () => {
    const def = makeLinearDef('crowded', 'M6', 2);
    const meta = extractHoleMeta(drilled(6), def, {
      positions: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5, y: 0 }, // < 1.5 × 6 = 9
      ],
    });
    expect(meta.dfmFlags.find((f) => f.code === 'CLOSE_HOLE_SPACING')).toBeDefined();
  });

  it('CLOSE_HOLE_SPACING does not fire when positions are spaced', () => {
    const def = makeLinearDef('spaced', 'M6', 2);
    const meta = extractHoleMeta(drilled(6), def, {
      positions: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 20, y: 0 },
      ],
    });
    expect(meta.dfmFlags.find((f) => f.code === 'CLOSE_HOLE_SPACING')).toBeUndefined();
  });

  it('PIPE_TAP_CLASS_TAPER_MISMATCH fires for parallel class + non-zero taper', () => {
    const def = makeLinearDef('pt-mismatch', 'G1/4', 1);
    const meta = extractHoleMeta(pipeTap(11, 1.0, 'NPSM'), def);
    expect(meta.dfmFlags.find((f) => f.code === 'PIPE_TAP_CLASS_TAPER_MISMATCH')).toBeDefined();
  });

  it('PIPE_TAP_CLASS_TAPER_MISMATCH OK when parallel + zero taper', () => {
    const def = makeLinearDef('pt-clean', 'G1/4', 1);
    const meta = extractHoleMeta(pipeTap(11, 0, 'NPSM'), def);
    expect(meta.dfmFlags.find((f) => f.code === 'PIPE_TAP_CLASS_TAPER_MISMATCH')).toBeUndefined();
  });

  it('CBORE_DEEPER_THAN_HOLE fires when cbore ≥ blind depth', () => {
    const def = makeLinearDef('cbore-deep', 'M5', 1, { kind: 'blind', depth: 8 });
    const meta = extractHoleMeta(cbore(5, 10, 8), def);
    expect(meta.dfmFlags.find((f) => f.code === 'CBORE_DEEPER_THAN_HOLE')).toBeDefined();
  });

  it('TAP_SHALLOW_ENGAGEMENT fires when tapDepth ≤ pitch', () => {
    const def = makeLinearDef('shallow-tap', 'M6', 1, { kind: 'blind', depth: 10 });
    const meta = extractHoleMeta(tap(5, 1, 1), def);
    expect(meta.dfmFlags.find((f) => f.code === 'TAP_SHALLOW_ENGAGEMENT')).toBeDefined();
  });
});

// ─── aggregateHoleMeta — BOM rollup ────────────────────────────────────────

describe('aggregateHoleMeta', () => {
  it('groups identical (kind, designation, callout) into one row', () => {
    const meta1 = extractHoleMeta(drilled(3.4), makeManualDef('arr1', 'M3', [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 10, y: 0 },
    ]));
    const meta2 = extractHoleMeta(drilled(3.4), makeManualDef('arr2', 'M3', [
      { id: 'q1', x: 100, y: 0 },
      { id: 'q2', x: 110, y: 0 },
      { id: 'q3', x: 120, y: 0 },
    ]));
    const agg = aggregateHoleMeta([meta1, meta2]);
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0].totalCount).toBe(5);
    expect(agg.rows[0].arrayCount).toBe(2);
    expect(agg.rows[0].arrayIds.sort()).toEqual(['arr1', 'arr2']);
    expect(agg.grandTotal).toBe(5);
  });

  it('keeps blind and through separate (different callout)', () => {
    const through = extractHoleMeta(drilled(3.4), makeLinearDef('a', 'M3', 4));
    const blind = extractHoleMeta(
      drilled(3.4),
      makeLinearDef('b', 'M3', 4, { kind: 'blind', depth: 10 }),
    );
    const agg = aggregateHoleMeta([through, blind]);
    expect(agg.rows).toHaveLength(2);
    expect(agg.grandTotal).toBe(8);
  });

  it('rows sorted by (kind, designation)', () => {
    const m3 = extractHoleMeta(drilled(3.4), makeLinearDef('a', 'M3', 2));
    const m6 = extractHoleMeta(drilled(6), makeLinearDef('b', 'M6', 2));
    const tapM5 = extractHoleMeta(tap(4.2, 0.8, 6), makeLinearDef('c', 'M5', 2));
    const agg = aggregateHoleMeta([tapM5, m6, m3]);
    // counterbore < drilled < tap alphabetically; drilled M3 < drilled M6
    expect(agg.rows[0].designation).toBe('M3');
    expect(agg.rows[1].designation).toBe('M6');
    expect(agg.rows[2].kind).toBe('tap');
  });

  it('empty input returns zero rows + zero total', () => {
    const agg = aggregateHoleMeta([]);
    expect(agg.rows).toEqual([]);
    expect(agg.grandTotal).toBe(0);
  });

  it('arrayIds dedupe — same arrayId only counts once', () => {
    const def = makeLinearDef('same-arr', 'M3', 2);
    const m1 = extractHoleMeta(drilled(3), def);
    const m2 = extractHoleMeta(drilled(3), def);
    const agg = aggregateHoleMeta([m1, m2]);
    expect(agg.rows[0].arrayCount).toBe(1);
    expect(agg.rows[0].arrayIds).toEqual(['same-arr']);
    // totalCount stacks both passes — each meta carries count=2.
    expect(agg.rows[0].totalCount).toBe(4);
  });
});

// ─── projectAndAggregate convenience ───────────────────────────────────────

describe('projectAndAggregate', () => {
  it('runs the pipeline end-to-end with mixed kinds', () => {
    const pairs: Array<{ spec: HoleSpec; def: HoleArrayDefinition }> = [
      { spec: drilled(3.4), def: makeLinearDef('d1', 'M3', 4) },
      { spec: tap(5, 1, 10), def: makeLinearDef('t1', 'M6', 2, { kind: 'blind', depth: 15 }) },
      { spec: cbore(8, 14, 5), def: makeRectDef('cb1', 'M8', 2, 2) },
      { spec: pipeTap(), def: makeLinearDef('p1', '1/4-18', 1) },
    ];
    const result = projectAndAggregate(pairs);
    expect(result.metas).toHaveLength(4);
    expect(result.aggregate.grandTotal).toBe(4 + 2 + 4 + 1);
    expect(result.aggregate.rows).toHaveLength(4);
  });
});

// ─── 6 kinds sanity sweep ──────────────────────────────────────────────────

describe('extractHoleMeta — 6-kind sanity sweep', () => {
  const kinds: Array<{
    label: string;
    spec: () => HoleSpec;
    expectedKind: HoleSpec['kind'];
  }> = [
    { label: 'drilled', spec: () => drilled(5), expectedKind: 'drilled' },
    { label: 'counterbore', spec: () => cbore(5, 10, 4), expectedKind: 'counterbore' },
    { label: 'countersink', spec: () => csk(5, 10), expectedKind: 'countersink' },
    { label: 'counterdrill', spec: () => cdrill(), expectedKind: 'counterdrill' },
    { label: 'tap', spec: () => tap(5, 1, 8), expectedKind: 'tap' },
    { label: 'pipe_tap', spec: () => pipeTap(), expectedKind: 'pipe_tap' },
  ];

  for (const { label, spec, expectedKind } of kinds) {
    it(`emits meta with kind=${label} and non-empty callout`, () => {
      const meta = extractHoleMeta(spec(), makeLinearDef('a', 'M5', 2));
      expect(meta.kind).toBe(expectedKind);
      expect(meta.callout.text.length).toBeGreaterThan(0);
      expect(meta.callout.drillDiameter).toBeGreaterThan(0);
      expect(meta.terminationSummary.glyph).toBeTruthy();
    });
  }
});
