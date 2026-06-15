/**
 * stepWriteAssemblyWithPmi — per-part assembly + PMI integration tests.
 *
 * Verifies:
 *   - per-part PMI splicing (0 / 1 / N parts with sheets)
 *   - per-part SHAPE_ASPECT bindings with mapping segregation
 *   - id-range monotonicity: assembly < part1 PMI < part1 bind < part2 PMI < ...
 *   - warning surface for unknown keys + sheet-less bindings
 *   - envelope invariants (HEADER, DATA, ENDSEC, END-ISO)
 *   - throws on empty parts
 *   - helper modules (PartPmiAllocator, joinPartFragment)
 */
import { describe, it, expect } from 'vitest';
import {
  writeAssemblyWithPmi,
  __internal,
  type AssemblyPmiOptions,
} from './stepWriteAssemblyWithPmi';
import {
  PartPmiAllocator,
  isStrictlyIncreasing,
  maxReservedId,
  type PartPmiRange,
} from './partPmi';
import { writeAssemblyAsStep, type AssemblyPart } from './stepWrite';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';

// ─── fixtures ─────────────────────────────────────────────────────────────

const HEADER_FIXED = { timestamp: '2026-01-01T00:00:00.000Z' };

function twoBoxes(): AssemblyPart[] {
  return [
    { id: 'housing', name: 'housing', x0: 0, y0: 0, z0: 0, x1: 50, y1: 50, z1: 20 },
    { id: 'shaft', name: 'shaft', x0: 5, y0: 5, z0: 0, x1: 15, y1: 15, z1: 40 },
  ];
}

function threeBoxes(): AssemblyPart[] {
  return [
    { id: 'A', name: 'A', x0: 0, y0: 0, z0: 0, x1: 10, y1: 10, z1: 10 },
    { id: 'B', name: 'B', x0: 0, y0: 0, z0: 0, x1: 5, y1: 5, z1: 5 },
    { id: 'C', name: 'C', x0: 0, y0: 0, z0: 0, x1: 8, y1: 8, z1: 8 },
  ];
}

function emptySheet(id = 'sheet-empty'): Sheet {
  return {
    id,
    name: id,
    paperSize: 'A4',
    viewports: [
      {
        id: 'vp-1',
        sourceId: 'part-1',
        projection: { kind: 'standard', view: 'front' },
        centerOnSheet: { x: 100, y: 100 },
        widthOnSheet: 80,
        scale: 1,
      },
    ],
  };
}

function sheetWith(
  id: string,
  dimensions: ReadonlyArray<Dimension> = [],
  gdtCallouts: ReadonlyArray<GdtCallout> = [],
): Sheet {
  return {
    id,
    name: id,
    paperSize: 'A4',
    viewports: [
      {
        id: 'vp-1',
        sourceId: 'part-1',
        projection: { kind: 'standard', view: 'front' },
        centerOnSheet: { x: 100, y: 100 },
        widthOnSheet: 80,
        scale: 1,
      },
    ],
    dimensions,
    gdtCallouts,
  };
}

function radialDim(id: string, ref = 'face_07', value = 10): Dimension {
  return {
    id,
    viewportId: 'vp-1',
    kind: 'radial',
    refs: [ref],
    valueOverride: value,
  };
}

function flatnessGdt(id: string, targetRef = 'face_07', tol = 0.05): GdtCallout {
  return {
    id,
    viewportId: 'vp-1',
    kind: 'flatness',
    targetRef,
    toleranceValue: tol,
  };
}

function makeOpts(overrides: Partial<AssemblyPmiOptions> = {}): AssemblyPmiOptions {
  return {
    geometry: { kind: 'assembly', assemblyName: 'asm', parts: twoBoxes() },
    header: HEADER_FIXED,
    ...overrides,
  };
}

function extractIds(source: string): number[] {
  return [...source.matchAll(/^#(\d+)\s*=/gm)].map((m) => Number.parseInt(m[1]!, 10));
}

// ─── no PMI paths ────────────────────────────────────────────────────────

describe('writeAssemblyWithPmi — no PMI', () => {
  it('2-part assembly + no partSheets → byte-equal to writeAssemblyAsStep', () => {
    const res = writeAssemblyWithPmi(makeOpts());
    const direct = writeAssemblyAsStep(
      { assemblyName: 'asm', parts: twoBoxes() },
      HEADER_FIXED,
    );
    expect(res.source).toBe(direct);
    expect(res.pmiMappingByPart.size).toBe(0);
    expect(res.warnings).toEqual([]);
    expect(res.ranges.length).toBe(2);
    for (const r of res.ranges) {
      expect(r.pmiStart).toBeNull();
      expect(r.bindStart).toBeNull();
    }
  });

  it('2-part assembly + empty partSheets {} → identical to no partSheets', () => {
    const res = writeAssemblyWithPmi(makeOpts({ partSheets: {} }));
    const direct = writeAssemblyAsStep(
      { assemblyName: 'asm', parts: twoBoxes() },
      HEADER_FIXED,
    );
    expect(res.source).toBe(direct);
  });
});

// ─── per-part sheets ─────────────────────────────────────────────────────

describe('writeAssemblyWithPmi — per-part PMI', () => {
  it('2-part assembly + 1 part sheet → PMI for that part only', () => {
    const sheet = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const res = writeAssemblyWithPmi(
      makeOpts({ partSheets: { housing: sheet } }),
    );
    expect(res.source).toContain('PMI from sheet s-housing');
    // Only one PMI fragment.
    const pmiCount = (res.source.match(/PMI from sheet/g) ?? []).length;
    expect(pmiCount).toBe(1);
    // No bindings supplied → no SHAPE_ASPECT block.
    expect(res.source).not.toContain('PMI shape binding');
    expect(res.warnings).toEqual([]);
    // Only the housing part has a non-null pmi range.
    expect(res.ranges[0]!.pmiStart).not.toBeNull();
    expect(res.ranges[1]!.pmiStart).toBeNull();
  });

  it('2-part assembly + 2 part sheets → PMI for both parts', () => {
    const sA = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const sB = sheetWith('s-shaft', [radialDim('d2', 'edge_42')]);
    const res = writeAssemblyWithPmi(
      makeOpts({ partSheets: { housing: sA, shaft: sB } }),
    );
    expect(res.source).toContain('PMI from sheet s-housing');
    expect(res.source).toContain('PMI from sheet s-shaft');
    const pmiCount = (res.source.match(/PMI from sheet/g) ?? []).length;
    expect(pmiCount).toBe(2);
    expect(res.warnings).toEqual([]);
    // Both ranges have non-null PMI bounds.
    expect(res.ranges[0]!.pmiStart).not.toBeNull();
    expect(res.ranges[1]!.pmiStart).not.toBeNull();
  });

  it('per-part PMI fragments appear in parts[] order (housing before shaft)', () => {
    const sA = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const sB = sheetWith('s-shaft', [radialDim('d2', 'edge_42')]);
    const res = writeAssemblyWithPmi(
      makeOpts({ partSheets: { housing: sA, shaft: sB } }),
    );
    const housingIdx = res.source.indexOf('PMI from sheet s-housing');
    const shaftIdx = res.source.indexOf('PMI from sheet s-shaft');
    expect(housingIdx).toBeGreaterThan(-1);
    expect(shaftIdx).toBeGreaterThan(housingIdx);
  });
});

// ─── per-part bindings ───────────────────────────────────────────────────

describe('writeAssemblyWithPmi — per-part bindings', () => {
  it('per-part bindings → one SHAPE_ASPECT block per part', () => {
    const sA = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const sB = sheetWith('s-shaft', [radialDim('d2', 'edge_42')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sA, shaft: sB },
        partBindings: {
          housing: [{ ref: 'face_07', entityId: 92, kind: 'face' }],
          shaft: [{ ref: 'edge_42', entityId: 241, kind: 'edge' }],
        },
      }),
    );
    const saCount = (res.source.match(/=SHAPE_ASPECT\(/g) ?? []).length;
    expect(saCount).toBe(2);
    expect(res.source).toContain('face@#92');
    expect(res.source).toContain('edge@#241');
    expect(res.pmiMappingByPart.size).toBe(2);
    expect(res.pmiMappingByPart.get('housing')?.get('face_07')).toBeDefined();
    expect(res.pmiMappingByPart.get('shaft')?.get('edge_42')).toBeDefined();
  });

  it('partBindings for a part with no sheet → warning + bindings ignored', () => {
    const sA = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sA },
        partBindings: {
          shaft: [{ ref: 'edge_42', entityId: 5, kind: 'edge' }],
        },
      }),
    );
    expect(res.warnings).toContain('partBindings for "shaft" ignored: no sheet supplied');
    expect(res.pmiMappingByPart.has('shaft')).toBe(false);
  });

  it('partBindings for empty sheet → warning + bindings ignored', () => {
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: emptySheet() },
        partBindings: {
          housing: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
        },
      }),
    );
    expect(res.warnings).toContain('partBindings for "housing" ignored: empty PMI fragment');
  });

  it('binding ref absent from PMI → forwarded warning with part prefix', () => {
    const sheet = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sheet },
        partBindings: {
          housing: [{ ref: 'ghost', entityId: 1, kind: 'face' }],
        },
      }),
    );
    expect(res.warnings.some((w) => w.startsWith('part "housing":') && w.includes('ghost'))).toBe(
      true,
    );
    expect(res.pmiMappingByPart.has('housing')).toBe(false);
  });
});

// ─── unknown keys ────────────────────────────────────────────────────────

describe('writeAssemblyWithPmi — unknown keys', () => {
  it('partSheets has key not in parts → warning', () => {
    const sheet = sheetWith('s-other', [radialDim('d1', 'face_07')]);
    const res = writeAssemblyWithPmi(
      makeOpts({ partSheets: { housing: sheet, ghost_part: sheet } }),
    );
    expect(res.warnings).toContain('partSheets key "ghost_part" does not match any part — ignored');
    // Ghost-part PMI must NOT be in the output.
    const pmiCount = (res.source.match(/PMI from sheet/g) ?? []).length;
    expect(pmiCount).toBe(1);
  });

  it('partBindings has key not in parts → warning', () => {
    const sheet = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sheet },
        partBindings: {
          housing: [{ ref: 'face_07', entityId: 1, kind: 'face' }],
          ghost_part: [{ ref: 'face_07', entityId: 2, kind: 'face' }],
        },
      }),
    );
    expect(res.warnings).toContain(
      'partBindings key "ghost_part" does not match any part — ignored',
    );
  });
});

// ─── empty parts → throws ────────────────────────────────────────────────

describe('writeAssemblyWithPmi — empty parts', () => {
  it('empty parts → throws', () => {
    expect(() =>
      writeAssemblyWithPmi({
        geometry: { kind: 'assembly', parts: [] },
        header: HEADER_FIXED,
      }),
    ).toThrow(/at least one part/);
  });

  it('wrong geometry.kind → throws', () => {
    expect(() =>
      writeAssemblyWithPmi({
        // @ts-expect-error — intentional bad input for the runtime guard.
        geometry: { kind: 'extrude', parts: [] },
        header: HEADER_FIXED,
      }),
    ).toThrow(/kind must be 'assembly'/);
  });
});

// ─── id-range monotonicity ───────────────────────────────────────────────

describe('writeAssemblyWithPmi — id monotonicity', () => {
  it('assembly < part1 PMI < part1 bind < part2 PMI < part2 bind', () => {
    const sA = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const sB = sheetWith('s-shaft', [radialDim('d2', 'edge_42')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sA, shaft: sB },
        partBindings: {
          housing: [{ ref: 'face_07', entityId: 92, kind: 'face' }],
          shaft: [{ ref: 'edge_42', entityId: 241, kind: 'edge' }],
        },
      }),
    );
    expect(isStrictlyIncreasing(res.ranges)).toBe(true);
    expect(res.ranges.length).toBe(2);
    const [r1, r2] = res.ranges;
    expect(r1!.pmiStart).not.toBeNull();
    expect(r1!.bindStart).not.toBeNull();
    expect(r2!.pmiStart).not.toBeNull();
    expect(r2!.bindStart).not.toBeNull();
    expect(r1!.pmiEnd!).toBeLessThan(r1!.bindStart!);
    expect(r1!.bindEnd!).toBeLessThan(r2!.pmiStart!);
    expect(r2!.pmiEnd!).toBeLessThan(r2!.bindStart!);
  });

  it('all #N= ids in the final source are unique', () => {
    const sA = sheetWith(
      's-housing',
      [radialDim('d1', 'face_07')],
      [flatnessGdt('g1', 'face_07')],
    );
    const sB = sheetWith(
      's-shaft',
      [radialDim('d2', 'edge_42')],
      [flatnessGdt('g2', 'edge_42', 0.02)],
    );
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sA, shaft: sB },
        partBindings: {
          housing: [{ ref: 'face_07', entityId: 92, kind: 'face' }],
          shaft: [{ ref: 'edge_42', entityId: 241, kind: 'edge' }],
        },
      }),
    );
    const ids = extractIds(res.source);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('three parts → ranges strictly increase across all three', () => {
    const parts = threeBoxes();
    const sA = sheetWith('s-A', [radialDim('dA', 'face_07')]);
    const sB = sheetWith('s-B', [radialDim('dB', 'face_08')]);
    const sC = sheetWith('s-C', [radialDim('dC', 'face_09')]);
    const res = writeAssemblyWithPmi({
      geometry: { kind: 'assembly', parts },
      header: HEADER_FIXED,
      partSheets: { A: sA, B: sB, C: sC },
      partBindings: {
        A: [{ ref: 'face_07', entityId: 50, kind: 'face' }],
        B: [{ ref: 'face_08', entityId: 60, kind: 'face' }],
        C: [{ ref: 'face_09', entityId: 70, kind: 'face' }],
      },
    });
    expect(res.ranges.length).toBe(3);
    expect(isStrictlyIncreasing(res.ranges)).toBe(true);
    const saCount = (res.source.match(/=SHAPE_ASPECT\(/g) ?? []).length;
    expect(saCount).toBe(3);
  });
});

// ─── mappingByPart structure ─────────────────────────────────────────────

describe('writeAssemblyWithPmi — mappingByPart structure', () => {
  it('mappingByPart keys match part ids', () => {
    const sA = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const sB = sheetWith('s-shaft', [radialDim('d2', 'edge_42')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sA, shaft: sB },
        partBindings: {
          housing: [{ ref: 'face_07', entityId: 92, kind: 'face' }],
          shaft: [{ ref: 'edge_42', entityId: 241, kind: 'edge' }],
        },
      }),
    );
    expect([...res.pmiMappingByPart.keys()].sort()).toEqual(['housing', 'shaft']);
  });

  it('partial bindings → only resolved parts appear in mappingByPart', () => {
    const sA = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const sB = sheetWith('s-shaft', [radialDim('d2', 'edge_42')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sA, shaft: sB },
        partBindings: {
          housing: [{ ref: 'face_07', entityId: 92, kind: 'face' }],
          // No binding for shaft → no mapping entry for shaft.
        },
      }),
    );
    expect(res.pmiMappingByPart.has('housing')).toBe(true);
    expect(res.pmiMappingByPart.has('shaft')).toBe(false);
  });

  it('binding ref values inside the part-map equal the allocated SHAPE_ASPECT id', () => {
    const sheet = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sheet },
        partBindings: {
          housing: [{ ref: 'face_07', entityId: 92, kind: 'face' }],
        },
      }),
    );
    const saId = res.pmiMappingByPart.get('housing')!.get('face_07')!;
    // The SHAPE_ASPECT line for housing has id == saId.
    expect(res.source).toMatch(new RegExp(`#${saId}=SHAPE_ASPECT\\(`));
  });
});

// ─── envelope structure ──────────────────────────────────────────────────

describe('writeAssemblyWithPmi — envelope structure', () => {
  it('starts with ISO-10303-21; and ends with END-ISO-10303-21;', () => {
    const sheet = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const res = writeAssemblyWithPmi(
      makeOpts({ partSheets: { housing: sheet } }),
    );
    expect(res.source.startsWith('ISO-10303-21;')).toBe(true);
    expect(res.source.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('exactly 2 ENDSEC; markers (HEADER + DATA)', () => {
    const sheet = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sheet },
        partBindings: { housing: [{ ref: 'face_07', entityId: 1, kind: 'face' }] },
      }),
    );
    const endsecCount = (res.source.match(/ENDSEC;/g) ?? []).length;
    expect(endsecCount).toBe(2);
    // SHAPE_ASPECT must be inside the DATA section, not after it.
    const saIdx = res.source.lastIndexOf('SHAPE_ASPECT(');
    const endIso = res.source.indexOf('END-ISO-10303-21;');
    const dataEndsec = res.source.lastIndexOf('ENDSEC;', endIso);
    expect(saIdx).toBeGreaterThan(-1);
    expect(saIdx).toBeLessThan(dataEndsec);
  });

  it('HEADER block is byte-identical to a no-PMI assembly run', () => {
    const sheet = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const withPmi = writeAssemblyWithPmi(
      makeOpts({ partSheets: { housing: sheet } }),
    );
    const noPmi = writeAssemblyAsStep(
      { assemblyName: 'asm', parts: twoBoxes() },
      HEADER_FIXED,
    );
    const headerOf = (s: string) => s.slice(0, s.indexOf('DATA;'));
    expect(headerOf(withPmi.source)).toBe(headerOf(noPmi));
  });

  it('assembly NAUO entities (per-part) survive untouched in the output', () => {
    const sheet = sheetWith('s-housing', [radialDim('d1', 'face_07')]);
    const res = writeAssemblyWithPmi(
      makeOpts({
        partSheets: { housing: sheet },
        partBindings: { housing: [{ ref: 'face_07', entityId: 1, kind: 'face' }] },
      }),
    );
    const nauoCount = (res.source.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) ?? []).length;
    expect(nauoCount).toBe(2);
  });
});

// ─── PartPmiAllocator helper ─────────────────────────────────────────────

describe('PartPmiAllocator', () => {
  it('starts cursor at assemblyMaxId + 1', () => {
    const a = new PartPmiAllocator(99);
    expect(a.nextId()).toBe(100);
  });

  it('records pmi then binding, advances cursor', () => {
    const a = new PartPmiAllocator(99);
    a.beginPart('p1');
    a.recordPmi(110);
    expect(a.nextId()).toBe(111);
    a.recordBinding(115);
    expect(a.nextId()).toBe(116);
  });

  it('snapshot returns per-part ranges in beginPart() order', () => {
    const a = new PartPmiAllocator(0);
    a.beginPart('p1');
    a.recordPmi(5);
    a.recordBinding(7);
    a.beginPart('p2');
    a.recordPmi(12);
    a.skipBinding();
    const snap = a.snapshot();
    expect(snap.map((r) => r.partId)).toEqual(['p1', 'p2']);
    expect(snap[0]).toMatchObject({ pmiStart: 1, pmiEnd: 5, bindStart: 6, bindEnd: 7 });
    expect(snap[1]).toMatchObject({ pmiStart: 8, pmiEnd: 12, bindStart: null, bindEnd: null });
  });

  it('skipPmi + skipBinding produce a null-bound range', () => {
    const a = new PartPmiAllocator(10);
    a.beginPart('p1');
    a.skipPmi();
    a.skipBinding();
    const snap = a.snapshot();
    expect(snap[0]).toMatchObject({
      partId: 'p1',
      pmiStart: null,
      pmiEnd: null,
      bindStart: null,
      bindEnd: null,
    });
  });

  it('throws on non-integer assemblyMaxId', () => {
    expect(() => new PartPmiAllocator(-1)).toThrow();
    expect(() => new PartPmiAllocator(1.5)).toThrow();
  });

  it('throws when recordPmi called without beginPart', () => {
    const a = new PartPmiAllocator(0);
    expect(() => a.recordPmi(5)).toThrow(/no active part/);
  });

  it('throws when recordPmi goes backwards', () => {
    const a = new PartPmiAllocator(10);
    a.beginPart('p1');
    // cursor is 11; pmiLastId 10 is < 11 → throws.
    expect(() => a.recordPmi(10)).toThrow(/must be >=/);
  });

  it('throws when partId is empty string', () => {
    const a = new PartPmiAllocator(0);
    expect(() => a.beginPart('')).toThrow();
  });
});

// ─── isStrictlyIncreasing / maxReservedId ────────────────────────────────

describe('partPmi.isStrictlyIncreasing + maxReservedId', () => {
  it('strictly-increasing ranges → true', () => {
    const ranges: PartPmiRange[] = [
      { partId: 'p1', pmiStart: 10, pmiEnd: 15, bindStart: 16, bindEnd: 18 },
      { partId: 'p2', pmiStart: 19, pmiEnd: 22, bindStart: 23, bindEnd: 24 },
    ];
    expect(isStrictlyIncreasing(ranges)).toBe(true);
  });

  it('overlapping ranges → false', () => {
    const ranges: PartPmiRange[] = [
      { partId: 'p1', pmiStart: 10, pmiEnd: 20, bindStart: null, bindEnd: null },
      { partId: 'p2', pmiStart: 15, pmiEnd: 25, bindStart: null, bindEnd: null },
    ];
    expect(isStrictlyIncreasing(ranges)).toBe(false);
  });

  it('skipped part ranges (both null) are tolerated', () => {
    const ranges: PartPmiRange[] = [
      { partId: 'p1', pmiStart: 10, pmiEnd: 15, bindStart: null, bindEnd: null },
      { partId: 'p2', pmiStart: null, pmiEnd: null, bindStart: null, bindEnd: null },
      { partId: 'p3', pmiStart: 16, pmiEnd: 20, bindStart: null, bindEnd: null },
    ];
    expect(isStrictlyIncreasing(ranges)).toBe(true);
  });

  it('maxReservedId returns highest end id across all ranges', () => {
    const ranges: PartPmiRange[] = [
      { partId: 'p1', pmiStart: 10, pmiEnd: 15, bindStart: 16, bindEnd: 18 },
      { partId: 'p2', pmiStart: 19, pmiEnd: 22, bindStart: null, bindEnd: null },
    ];
    expect(maxReservedId(ranges)).toBe(22);
  });

  it('maxReservedId returns -1 for fully-empty snapshot', () => {
    const ranges: PartPmiRange[] = [
      { partId: 'p1', pmiStart: null, pmiEnd: null, bindStart: null, bindEnd: null },
    ];
    expect(maxReservedId(ranges)).toBe(-1);
  });
});

// ─── internal helpers ────────────────────────────────────────────────────

describe('writeAssemblyWithPmi internals', () => {
  it('ensureTrailingNewline appends \\n when missing, keeps empty as empty', () => {
    expect(__internal.ensureTrailingNewline('abc')).toBe('abc\n');
    expect(__internal.ensureTrailingNewline('abc\n')).toBe('abc\n');
    expect(__internal.ensureTrailingNewline('')).toBe('');
  });

  it('joinPartFragment glues pmi + bind with single newlines between', () => {
    const joined = __internal.joinPartFragment('PMI;', 'BIND;');
    expect(joined).toBe('PMI;\nBIND;\n');
  });

  it('joinPartFragment with empty bind returns just pmi', () => {
    expect(__internal.joinPartFragment('PMI;', '')).toBe('PMI;\n');
  });

  it('joinPartFragment with empty pmi returns just bind', () => {
    expect(__internal.joinPartFragment('', 'BIND;')).toBe('BIND;\n');
  });

  it('joinPartFragment with both empty returns empty', () => {
    expect(__internal.joinPartFragment('', '')).toBe('');
  });
});
