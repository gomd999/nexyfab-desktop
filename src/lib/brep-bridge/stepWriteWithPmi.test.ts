/**
 * stepWriteWithPmi — orchestrator tests.
 *
 * Validates that geometry from stepWrite (extrude / polygon / assembly) and
 * the PMI fragment from pmiExport compose into a single ISO-10303-21 STEP
 * file with non-colliding entity ids and a structurally valid envelope.
 */
import { describe, it, expect } from 'vitest';
import {
  writeStepWithPmi,
  __internal,
  type WriteStepWithPmiOptions,
} from './stepWriteWithPmi';
import {
  writeExtrudeAsStep,
  writeExtrudePolygonAsStep,
  writeAssemblyAsStep,
  type AssemblyPart,
} from './stepWrite';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── fixtures ─────────────────────────────────────────────────────────────

function rectFeature(): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth: 3,
    direction: 'one_sided',
    mode: 'add',
  };
}

function pentagonFeature(): ExtrudeFeature {
  // Convex regular pentagon (7 ADVANCED_FACE = 5 side + top + bottom).
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * 10, y: Math.sin(a) * 10 });
  }
  return {
    kind: 'extrude',
    loop: pts,
    depth: 4,
    direction: 'one_sided',
    mode: 'add',
  };
}

const HEADER_FIXED = { timestamp: '2026-01-01T00:00:00.000Z' };

function emptySheet(): Sheet {
  return {
    id: 'sheet-empty',
    name: 'empty',
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
  dimensions: ReadonlyArray<Dimension> = [],
  gdtCallouts: ReadonlyArray<GdtCallout> = [],
): Sheet {
  return {
    id: 'sheet-pmi',
    name: 'pmi',
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

function linearDim(id: string, value = 20): Dimension {
  return {
    id,
    viewportId: 'vp-1',
    kind: 'linear',
    refs: ['face-a', 'face-b'],
    valueOverride: value,
  };
}

function flatnessGdt(id: string, tol = 0.05): GdtCallout {
  return {
    id,
    viewportId: 'vp-1',
    kind: 'flatness',
    targetRef: 'face-1',
    toleranceValue: tol,
  };
}

function twoBoxAssembly(): AssemblyPart[] {
  return [
    { id: 'housing', name: 'housing', x0: 0, y0: 0, z0: 0, x1: 50, y1: 50, z1: 20 },
    { id: 'shaft', name: 'shaft', x0: 5, y0: 5, z0: 0, x1: 15, y1: 15, z1: 40 },
  ];
}

function makeOpts(
  geometry: WriteStepWithPmiOptions['geometry'],
  pmi?: WriteStepWithPmiOptions['pmi'],
): WriteStepWithPmiOptions {
  return { geometry, pmi, header: HEADER_FIXED };
}

// ─── basic plumbing ───────────────────────────────────────────────────────

describe('writeStepWithPmi — geometry passthrough (no PMI)', () => {
  it('extrude box without pmi returns byte-identical stepWrite output', () => {
    const out = writeStepWithPmi(makeOpts({ kind: 'extrude', feature: rectFeature() }));
    const direct = writeExtrudeAsStep(rectFeature(), HEADER_FIXED);
    expect(out).toBe(direct);
  });

  it('polygon pentagon without pmi returns byte-identical stepWrite output', () => {
    const out = writeStepWithPmi(makeOpts({ kind: 'polygon', feature: pentagonFeature() }));
    const direct = writeExtrudePolygonAsStep(pentagonFeature(), HEADER_FIXED);
    expect(out).toBe(direct);
  });

  it('assembly without pmi returns byte-identical stepWrite output', () => {
    const out = writeStepWithPmi(
      makeOpts({ kind: 'assembly', assemblyName: 'asm', parts: twoBoxAssembly() }),
    );
    const direct = writeAssemblyAsStep(
      { assemblyName: 'asm', parts: twoBoxAssembly() },
      HEADER_FIXED,
    );
    expect(out).toBe(direct);
  });
});

describe('writeStepWithPmi — empty PMI sheet', () => {
  it('extrude + sheet with NO dim and NO gdt → identical to stepWrite output', () => {
    const out = writeStepWithPmi(
      makeOpts({ kind: 'extrude', feature: rectFeature() }, { sheet: emptySheet() }),
    );
    const direct = writeExtrudeAsStep(rectFeature(), HEADER_FIXED);
    expect(out).toBe(direct);
  });

  it('assembly + sheet with empty arrays (length 0) → identical to stepWrite output', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'assembly', assemblyName: 'asm', parts: twoBoxAssembly() },
        { sheet: sheetWith([], []) },
      ),
    );
    const direct = writeAssemblyAsStep(
      { assemblyName: 'asm', parts: twoBoxAssembly() },
      HEADER_FIXED,
    );
    expect(out).toBe(direct);
  });
});

// ─── PMI splicing ─────────────────────────────────────────────────────────

describe('writeStepWithPmi — PMI splice (single dim)', () => {
  it('box + 1 linear dim → contains DIMENSIONAL_SIZE', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith([linearDim('dim-1')]) },
      ),
    );
    expect(out).toContain('DIMENSIONAL_SIZE(');
  });

  it('PMI fragment appears inside the DATA section (before ENDSEC;)', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith([linearDim('dim-1')]) },
      ),
    );
    const dataIdx = out.indexOf('DATA;');
    const pmiIdx = out.indexOf('DIMENSIONAL_SIZE(');
    // Find the DATA-closing ENDSEC (the last ENDSEC before END-ISO).
    const endIso = out.indexOf('END-ISO-10303-21;');
    const endsecIdx = out.lastIndexOf('ENDSEC;', endIso);
    expect(pmiIdx).toBeGreaterThan(dataIdx);
    expect(pmiIdx).toBeLessThan(endsecIdx);
  });
});

describe('writeStepWithPmi — multi-annotation', () => {
  it('box + 3 dim + 2 gdt → 3 DIMENSIONAL_SIZE + 2 GD&T entities, unique ids', () => {
    const dims = [linearDim('d1'), linearDim('d2', 5), linearDim('d3', 30)];
    const gdts = [flatnessGdt('g1'), flatnessGdt('g2', 0.1)];
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith(dims, gdts) },
      ),
    );
    const dimMatches = out.match(/=DIMENSIONAL_SIZE\(/g) ?? [];
    expect(dimMatches.length).toBe(3);
    const flatMatches = out.match(/=FLATNESS_TOLERANCE\(/g) ?? [];
    expect(flatMatches.length).toBe(2);

    // Entity-id uniqueness: extract all `#N=` lines and assert no duplicates.
    const ids = new Set<number>();
    const dupes: number[] = [];
    const re = /^#(\d+)\s*=/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      const n = Number.parseInt(m[1]!, 10);
      if (ids.has(n)) dupes.push(n);
      ids.add(n);
    }
    expect(dupes).toEqual([]);
  });

  it('pentagon polygon + 1 flatness gdt → 7 ADVANCED_FACE + FLATNESS_TOLERANCE', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'polygon', feature: pentagonFeature() },
        { sheet: sheetWith([], [flatnessGdt('g1')]) },
      ),
    );
    const faces = out.match(/=ADVANCED_FACE\(/g) ?? [];
    expect(faces.length).toBe(7); // 5 sides + top + bottom
    expect(out).toContain('FLATNESS_TOLERANCE(');
  });

  it('assembly (2 parts) + 2 dim → 2 SOLID + 2 DIMENSIONAL_SIZE', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'assembly', assemblyName: 'asm', parts: twoBoxAssembly() },
        { sheet: sheetWith([linearDim('d1'), linearDim('d2', 10)]) },
      ),
    );
    const solids = out.match(/=MANIFOLD_SOLID_BREP\(/g) ?? [];
    expect(solids.length).toBe(2);
    const dims = out.match(/=DIMENSIONAL_SIZE\(/g) ?? [];
    expect(dims.length).toBe(2);
  });
});

// ─── envelope / structural invariants ─────────────────────────────────────

describe('writeStepWithPmi — envelope invariants', () => {
  it('starts with ISO-10303-21; and ends with END-ISO-10303-21;', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith([linearDim('d1')]) },
      ),
    );
    expect(out.startsWith('ISO-10303-21;')).toBe(true);
    expect(out.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('marker order: HEADER → ENDSEC → DATA → ENDSEC → END-ISO-10303-21', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith([linearDim('d1'), linearDim('d2', 7)]) },
      ),
    );
    const headerIdx = out.indexOf('HEADER;');
    const dataIdx = out.indexOf('DATA;');
    const endIsoIdx = out.indexOf('END-ISO-10303-21;');
    // Header's ENDSEC is the FIRST ENDSEC; (between HEADER and DATA).
    const headerEndsec = out.indexOf('ENDSEC;', headerIdx);
    // Data's ENDSEC is the LAST ENDSEC; before END-ISO.
    const dataEndsec = out.lastIndexOf('ENDSEC;', endIsoIdx);
    expect(headerIdx).toBeLessThan(headerEndsec);
    expect(headerEndsec).toBeLessThan(dataIdx);
    expect(dataIdx).toBeLessThan(dataEndsec);
    expect(dataEndsec).toBeLessThan(endIsoIdx);
  });

  it('HEADER block is unchanged after PMI splice (PMI lives in DATA only)', () => {
    const withPmi = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith([linearDim('d1')]) },
      ),
    );
    const noPmi = writeExtrudeAsStep(rectFeature(), HEADER_FIXED);
    const headerOf = (s: string) => s.slice(0, s.indexOf('DATA;'));
    expect(headerOf(withPmi)).toBe(headerOf(noPmi));
  });

  it('exactly 2 ENDSEC; markers (one for HEADER, one for DATA)', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith([linearDim('d1'), linearDim('d2', 7)]) },
      ),
    );
    const endsecCount = (out.match(/ENDSEC;/g) ?? []).length;
    expect(endsecCount).toBe(2);
  });
});

// ─── entity id monotonicity ───────────────────────────────────────────────

describe('writeStepWithPmi — entity id allocation', () => {
  it('PMI ids start strictly above max geometry id (no overlap)', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith([linearDim('d1')]) },
      ),
    );
    // Geometry id range = entity lines BEFORE the PMI fragment comment line.
    const pmiMarker = out.indexOf("PMI from sheet");
    expect(pmiMarker).toBeGreaterThan(-1);
    const geomBlock = out.slice(0, pmiMarker);
    const pmiBlock = out.slice(pmiMarker);
    const re = /^#(\d+)\s*=/gm;
    let m: RegExpExecArray | null;
    let geomMax = 0;
    while ((m = re.exec(geomBlock)) !== null) {
      const n = Number.parseInt(m[1]!, 10);
      if (n > geomMax) geomMax = n;
    }
    re.lastIndex = 0;
    let pmiMin = Infinity;
    while ((m = re.exec(pmiBlock)) !== null) {
      const n = Number.parseInt(m[1]!, 10);
      if (n < pmiMin) pmiMin = n;
    }
    expect(geomMax).toBeGreaterThan(0);
    expect(pmiMin).toBeGreaterThan(geomMax);
  });

  it('box + 10 dim → PMI id range sits entirely after geometry id range', () => {
    const dims: Dimension[] = [];
    for (let i = 0; i < 10; i++) dims.push(linearDim(`d${i}`, i + 1));
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith(dims) },
      ),
    );
    const dimMatches = out.match(/=DIMENSIONAL_SIZE\(/g) ?? [];
    expect(dimMatches.length).toBe(10);

    // Same boundary check as above.
    const pmiMarker = out.indexOf("PMI from sheet");
    const geomBlock = out.slice(0, pmiMarker);
    const pmiBlock = out.slice(pmiMarker);
    let geomMax = 0;
    let pmiMin = Infinity;
    let m: RegExpExecArray | null;
    const re = /^#(\d+)\s*=/gm;
    while ((m = re.exec(geomBlock)) !== null) {
      const n = Number.parseInt(m[1]!, 10);
      if (n > geomMax) geomMax = n;
    }
    re.lastIndex = 0;
    while ((m = re.exec(pmiBlock)) !== null) {
      const n = Number.parseInt(m[1]!, 10);
      if (n < pmiMin) pmiMin = n;
    }
    expect(pmiMin).toBeGreaterThan(geomMax);
  });
});

// ─── error paths ──────────────────────────────────────────────────────────

describe('writeStepWithPmi — error handling', () => {
  it('throws when sheet has dimension referencing unknown viewport', () => {
    const badSheet: Sheet = {
      ...emptySheet(),
      dimensions: [
        {
          id: 'bad',
          viewportId: 'does-not-exist',
          kind: 'linear',
          refs: ['a', 'b'],
        },
      ],
    };
    expect(() =>
      writeStepWithPmi(
        makeOpts({ kind: 'extrude', feature: rectFeature() }, { sheet: badSheet }),
      ),
    ).toThrow();
  });

  it('throws when sheet id is empty (validateSheet rejects)', () => {
    const badSheet = { ...emptySheet(), id: '' } as Sheet;
    expect(() =>
      writeStepWithPmi(
        makeOpts({ kind: 'extrude', feature: rectFeature() }, { sheet: badSheet }),
      ),
    ).toThrow();
  });

  it('throws when geometry kind is invalid (defensive cast)', () => {
    expect(() =>
      writeStepWithPmi({
        geometry: { kind: 'bogus' as 'extrude', feature: rectFeature() },
      }),
    ).toThrow();
  });
});

// ─── internal: splitStepFile / scanMaxEntityId ────────────────────────────

describe('writeStepWithPmi — splitStepFile internals', () => {
  it('splits a stepWrite extrude output into header + entities + tail', () => {
    const step = writeExtrudeAsStep(rectFeature(), HEADER_FIXED);
    const split = __internal.splitStepFile(step);
    expect(split.headerBlock).toContain('ISO-10303-21;');
    expect(split.headerBlock).toContain('FILE_DESCRIPTION(');
    expect(split.dataEntities.startsWith('DATA;')).toBe(true);
    expect(split.dataEntities).not.toContain('ENDSEC;');
    expect(split.tail.startsWith('ENDSEC;')).toBe(true);
    expect(split.tail).toContain('END-ISO-10303-21;');
    expect(split.maxEntityId).toBeGreaterThan(0);
  });

  it('throws when DATA; marker is absent', () => {
    expect(() =>
      __internal.splitStepFile('ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n'),
    ).toThrow(/DATA;/);
  });

  it('throws when END-ISO-10303-21; trailer is absent', () => {
    expect(() =>
      __internal.splitStepFile('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\n'),
    ).toThrow(/END-ISO-10303-21;/);
  });

  it('scanMaxEntityId returns 0 on empty input', () => {
    expect(__internal.scanMaxEntityId('')).toBe(0);
  });

  it('scanMaxEntityId picks the largest id even at unusual magnitudes (#999999)', () => {
    const sample = ['#10=FOO();', '#42=BAR();', '#999999=BAZ();', '#7=QUX();'].join('\n');
    expect(__internal.scanMaxEntityId(sample)).toBe(999999);
  });

  it('scanMaxEntityId ignores #N references inside entity bodies', () => {
    // Only the line-anchored `#N=` counts — inline refs like `#88` do not.
    const sample = '#5=FOO(#88,#900);\n#9=BAR(#9999);\n';
    expect(__internal.scanMaxEntityId(sample)).toBe(9);
  });
});

// ─── header validation ───────────────────────────────────────────────────

describe('writeStepWithPmi — header validation', () => {
  it('assertValidHeader accepts a real writeStepHeader output', () => {
    const step = writeExtrudeAsStep(rectFeature(), HEADER_FIXED);
    const header = step.slice(0, step.indexOf('DATA;'));
    expect(() => __internal.assertValidHeader(header)).not.toThrow();
  });

  it('assertValidHeader rejects a header missing FILE_SCHEMA', () => {
    const bad =
      "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('x'),'2;1');\nFILE_NAME('','','','','','','');\nENDSEC;\n";
    expect(() => __internal.assertValidHeader(bad)).toThrow(/FILE_SCHEMA/);
  });

  it('assertValidHeader rejects input missing the ISO-10303-21; opener', () => {
    expect(() => __internal.assertValidHeader('HEADER;\nFILE_DESCRIPTION();\nFILE_NAME();\nFILE_SCHEMA();\nENDSEC;\n')).toThrow(/ISO-10303-21/);
  });
});

// ─── end-to-end validity ──────────────────────────────────────────────────

describe('writeStepWithPmi — end-to-end ISO-10303-21 validity', () => {
  it('marker sequence parses cleanly: HEADER…ENDSEC…DATA…ENDSEC…END-ISO-10303-21', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'polygon', feature: pentagonFeature() },
        { sheet: sheetWith([linearDim('d1')], [flatnessGdt('g1')]) },
      ),
    );
    // Re-derive the marker indices through regex to be sure the sequence is
    // valid (catches accidental splice mis-ordering).
    const order = ['ISO-10303-21;', 'HEADER;', 'ENDSEC;', 'DATA;', 'ENDSEC;', 'END-ISO-10303-21;'];
    let cursor = 0;
    for (const marker of order) {
      const idx = out.indexOf(marker, cursor);
      expect(idx).toBeGreaterThanOrEqual(cursor);
      cursor = idx + marker.length;
    }
  });

  it('output is a single string (no nested STEP files / no double trailer)', () => {
    const out = writeStepWithPmi(
      makeOpts(
        { kind: 'extrude', feature: rectFeature() },
        { sheet: sheetWith([linearDim('d1')]) },
      ),
    );
    // Opener match must NOT include END-ISO-10303-21; (which contains the
    // ISO-10303-21; substring). Anchor to start of line.
    const isoStarts = (out.match(/^ISO-10303-21;/gm) ?? []).length;
    const isoEnds = (out.match(/END-ISO-10303-21;/g) ?? []).length;
    expect(isoStarts).toBe(1);
    expect(isoEnds).toBe(1);
  });
});
