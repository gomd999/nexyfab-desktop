/**
 * pmiExport — AP242 PMI fragment writer tests (Phase 5.3 Phase 1).
 */
import { describe, it, expect } from 'vitest';
import {
  writePmiFragment,
  writePmiFragmentWithSavedView,
  __internal,
} from './pmiExport';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';

// ─── fixture helpers ──────────────────────────────────────────────────────

function makeSheet(opts: {
  dimensions?: ReadonlyArray<Dimension>;
  gdtCallouts?: ReadonlyArray<GdtCallout>;
} = {}): Sheet {
  return {
    id: 'sheet-1',
    name: 'Test Sheet',
    paperSize: 'A3',
    viewports: [
      {
        id: 'vp-1',
        sourceId: 'part-1',
        projection: { kind: 'standard', view: 'front' },
        centerOnSheet: { x: 100, y: 100 },
        widthOnSheet: 150,
        scale: 1,
      },
    ],
    dimensions: opts.dimensions,
    gdtCallouts: opts.gdtCallouts,
  };
}

function linearDim(overrides: Partial<Dimension> = {}): Dimension {
  return {
    id: 'dim-lin-1',
    viewportId: 'vp-1',
    kind: 'linear',
    refs: ['face-a', 'face-b'],
    valueOverride: 20,
    ...overrides,
  } as Dimension;
}

function radialDim(overrides: Partial<Dimension> = {}): Dimension {
  return {
    id: 'dim-rad-1',
    viewportId: 'vp-1',
    kind: 'radial',
    refs: ['edge-a'],
    valueOverride: 5,
    ...overrides,
  } as Dimension;
}

function angularDim(overrides: Partial<Dimension> = {}): Dimension {
  return {
    id: 'dim-ang-1',
    viewportId: 'vp-1',
    kind: 'angular',
    refs: ['edge-a', 'edge-b'],
    valueOverride: 1.5708, // ~90 deg in radians
    ...overrides,
  } as Dimension;
}

function flatnessGdt(overrides: Partial<GdtCallout> = {}): GdtCallout {
  return {
    id: 'gdt-flt-1',
    viewportId: 'vp-1',
    kind: 'flatness',
    targetRef: 'face-1',
    toleranceValue: 0.05,
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────

describe('writePmiFragment — empty', () => {
  it('empty sheet → empty source + lastEntityId == startEntityId', () => {
    const res = writePmiFragment(makeSheet(), 100);
    expect(res.source).toBe('');
    expect(res.lastEntityId).toBe(100);
    expect(res.mapping.size).toBe(0);
  });
});

describe('writePmiFragment — dimensions', () => {
  it('1 linear dim → contains DIMENSIONAL_SIZE', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('DIMENSIONAL_SIZE(');
    expect(res.mapping.get('dim-lin-1')).toBeDefined();
  });

  it('1 radial dim → contains DIMENSIONAL_SIZE with kind hint', () => {
    const sheet = makeSheet({ dimensions: [radialDim()] });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('DIMENSIONAL_SIZE(');
    // kind hint is embedded in the entity name attribute.
    expect(res.source).toContain('radial');
  });

  it('1 angular dim → contains DIMENSIONAL_LOCATION', () => {
    const sheet = makeSheet({ dimensions: [angularDim()] });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('DIMENSIONAL_LOCATION(');
    expect(res.source).not.toContain('DIMENSIONAL_SIZE(');
  });
});

describe('writePmiFragment — tolerances', () => {
  it('bilateral tolerance → PLUS_MINUS_TOLERANCE', () => {
    const sheet = makeSheet({
      dimensions: [
        linearDim({
          tolerance: { kind: 'bilateral', upper: 0.1, lower: 0.1 },
        }),
      ],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('PLUS_MINUS_TOLERANCE(');
    expect(res.source).toContain("'bilateral'");
  });

  it('unilateral tolerance → PLUS_MINUS_TOLERANCE with one zero', () => {
    const sheet = makeSheet({
      dimensions: [
        linearDim({
          tolerance: { kind: 'unilateral', upper: 0.2, lower: 0 },
        }),
      ],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('PLUS_MINUS_TOLERANCE(');
    expect(res.source).toContain("'unilateral'");
    // lower bound is 0 → LENGTH_MEASURE(0.) appears
    expect(res.source).toMatch(/LENGTH_MEASURE\(0\.\)/);
  });

  it('limit tolerance → DIMENSIONAL_SIZE_WITH_PATH', () => {
    const sheet = makeSheet({
      dimensions: [
        linearDim({
          tolerance: { kind: 'limit', min: 19.9, max: 20.1 },
        }),
      ],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('DIMENSIONAL_SIZE_WITH_PATH(');
  });

  it('iso_fit "H7" → text label appears', () => {
    const sheet = makeSheet({
      dimensions: [
        linearDim({
          tolerance: { kind: 'iso_fit', designation: 'H7' },
        }),
      ],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain("'H7'");
    expect(res.source).toContain('iso_fit');
  });
});

describe('writePmiFragment — prefix/suffix', () => {
  it('prefix "Ø" → DESCRIPTOR contains it', () => {
    const sheet = makeSheet({
      dimensions: [linearDim({ prefix: 'Ø' })],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('DESCRIPTIVE_REPRESENTATION_ITEM(');
    expect(res.source).toContain('Ø');
    expect(res.source).toContain("'prefix'");
  });
});

describe('writePmiFragment — GD&T subtypes', () => {
  it('flatness GD&T → FLATNESS_TOLERANCE', () => {
    const sheet = makeSheet({ gdtCallouts: [flatnessGdt()] });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('FLATNESS_TOLERANCE(');
    expect(res.mapping.get('gdt-flt-1')).toBeDefined();
  });

  it('cylindricity → CYLINDRICITY_TOLERANCE', () => {
    const sheet = makeSheet({
      gdtCallouts: [
        flatnessGdt({ id: 'gdt-cyl-1', kind: 'cylindricity' }),
      ],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('CYLINDRICITY_TOLERANCE(');
  });

  it('position with datums [A,B,C] → DATUM_SYSTEM with 3 datums', () => {
    const sheet = makeSheet({
      gdtCallouts: [
        flatnessGdt({
          id: 'gdt-pos-1',
          kind: 'position',
          datums: ['A', 'B', 'C'],
        }),
      ],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('DATUM_SYSTEM(');
    // 3 DATUM_REFERENCE rows (use =DATUM_REFERENCE( anchor to avoid matching
    // the substring inside GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE).
    const datumRefMatches = res.source.match(/=DATUM_REFERENCE\(/g) ?? [];
    expect(datumRefMatches.length).toBe(3);
    // 3 individual DATUM(...) entities, one per letter
    expect(res.source).toContain("DATUM('A'");
    expect(res.source).toContain("DATUM('B'");
    expect(res.source).toContain("DATUM('C'");
  });
});

describe('writePmiFragment — material condition modifiers', () => {
  it('max_material modifier → MODIFIED_GEOMETRIC_TOLERANCE', () => {
    const sheet = makeSheet({
      gdtCallouts: [
        flatnessGdt({
          id: 'gdt-pos-mmc',
          kind: 'position',
          datums: ['A'],
          materialCondition: 'M',
        }),
      ],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('MODIFIED_GEOMETRIC_TOLERANCE(');
    expect(res.source).toContain('.MAXIMUM_MATERIAL_CONDITION.');
  });

  it('regardless_of_feature_size → no modifier wrapper', () => {
    // Both '' and undefined map to RFS; verify no wrapper is emitted.
    const sheetA = makeSheet({
      gdtCallouts: [flatnessGdt({ id: 'gdt-a', materialCondition: '' })],
    });
    const sheetB = makeSheet({
      gdtCallouts: [flatnessGdt({ id: 'gdt-b' })], // undefined
    });
    expect(writePmiFragment(sheetA, 100).source).not.toContain('MODIFIED_GEOMETRIC_TOLERANCE(');
    expect(writePmiFragment(sheetB, 100).source).not.toContain('MODIFIED_GEOMETRIC_TOLERANCE(');
  });
});

describe('writePmiFragment — mixed sheets + mapping', () => {
  it('mixed sheet (3 dims + 2 gdt) → mapping has 5 entries', () => {
    const sheet = makeSheet({
      dimensions: [
        linearDim({ id: 'd1' }),
        radialDim({ id: 'd2' }),
        angularDim({ id: 'd3' }),
      ],
      gdtCallouts: [
        flatnessGdt({ id: 'g1' }),
        flatnessGdt({ id: 'g2', kind: 'cylindricity' }),
      ],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.mapping.size).toBe(5);
    expect(res.mapping.has('d1')).toBe(true);
    expect(res.mapping.has('d2')).toBe(true);
    expect(res.mapping.has('d3')).toBe(true);
    expect(res.mapping.has('g1')).toBe(true);
    expect(res.mapping.has('g2')).toBe(true);
  });

  it('entity ids monotonically increase from startEntityId', () => {
    const sheet = makeSheet({
      dimensions: [linearDim({ id: 'd1' }), linearDim({ id: 'd2' })],
      gdtCallouts: [flatnessGdt({ id: 'g1' })],
    });
    const res = writePmiFragment(sheet, 500);

    // Every #N in source must be >= 500.
    const idMatches = res.source.match(/#(\d+)/g) ?? [];
    expect(idMatches.length).toBeGreaterThan(0);
    for (const m of idMatches) {
      const n = Number.parseInt(m.slice(1), 10);
      expect(n).toBeGreaterThanOrEqual(500);
    }

    // Mapping values are positive ints, strictly within [start, lastEntityId].
    for (const v of res.mapping.values()) {
      expect(v).toBeGreaterThanOrEqual(500);
      expect(v).toBeLessThanOrEqual(res.lastEntityId);
    }

    // Mapping entries should be in input order: d1 < d2 < g1.
    const d1 = res.mapping.get('d1')!;
    const d2 = res.mapping.get('d2')!;
    const g1 = res.mapping.get('g1')!;
    expect(d1).toBeLessThan(d2);
    expect(d2).toBeLessThan(g1);
  });

  it("mapping.get('non-existent') → undefined", () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const res = writePmiFragment(sheet, 100);
    expect(res.mapping.get('does-not-exist')).toBeUndefined();
  });

  it('startEntityId is respected — no overlap with lower ids', () => {
    const sheet = makeSheet({
      dimensions: [linearDim()],
      gdtCallouts: [flatnessGdt()],
    });
    const res = writePmiFragment(sheet, 1000);
    const idMatches = res.source.match(/#(\d+)/g) ?? [];
    for (const m of idMatches) {
      const n = Number.parseInt(m.slice(1), 10);
      expect(n).toBeGreaterThanOrEqual(1000);
    }
    expect(res.lastEntityId).toBeGreaterThanOrEqual(1000);
  });

  it('sheet with dims but no gdt → only dim entities', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const res = writePmiFragment(sheet, 100);
    // No GD&T subtype names should appear.
    expect(res.source).not.toContain('FLATNESS_TOLERANCE(');
    expect(res.source).not.toContain('CYLINDRICITY_TOLERANCE(');
    expect(res.source).not.toContain('POSITION_TOLERANCE(');
    expect(res.source).not.toContain('DATUM_SYSTEM(');
    expect(res.source).toContain('DIMENSIONAL_SIZE(');
  });

  it('sheet with gdt but no dims → only gdt entities', () => {
    const sheet = makeSheet({ gdtCallouts: [flatnessGdt()] });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).not.toContain('DIMENSIONAL_SIZE(');
    expect(res.source).not.toContain('DIMENSIONAL_LOCATION(');
    expect(res.source).toContain('FLATNESS_TOLERANCE(');
  });
});

describe('writePmiFragment — header comment', () => {
  it('contains 1-line header comment with sheet id + counts', () => {
    const sheet = makeSheet({
      dimensions: [linearDim()],
      gdtCallouts: [flatnessGdt(), flatnessGdt({ id: 'g2' })],
    });
    const res = writePmiFragment(sheet, 100);
    expect(res.source).toContain('/* PMI from sheet sheet-1');
    expect(res.source).toContain('1 dimensions');
    expect(res.source).toContain('2 GD&T');
  });
});

// ─── Phase 2: saved-view + datum-target tests ─────────────────────────────

describe('writePmiFragmentWithSavedView — DRAUGHTING_MODEL container', () => {
  it('empty sheet → DRAUGHTING_MODEL with empty items list', () => {
    const res = writePmiFragmentWithSavedView(makeSheet(), 100);
    expect(res.source).toContain('DRAUGHTING_MODEL(');
    // empty items list — exact form is "DRAUGHTING_MODEL('Default PMI View',(),#N)".
    expect(res.source).toMatch(/DRAUGHTING_MODEL\('Default PMI View',\(\),#\d+\)/);
    // saved_view mapping must be populated even for empty sheets.
    expect(res.mapping.get('saved_view')).toBeDefined();
    expect(res.mapping.get('saved_view')).toBeGreaterThanOrEqual(100);
  });

  it('1 dim → DRAUGHTING_MODEL.items contains the dim ref', () => {
    const sheet = makeSheet({ dimensions: [linearDim({ id: 'd1' })] });
    const res = writePmiFragmentWithSavedView(sheet, 100);
    const dimId = res.mapping.get('d1');
    expect(dimId).toBeDefined();
    // DRAUGHTING_MODEL items list must include `#<dimId>` exactly.
    const dmMatch = res.source.match(/DRAUGHTING_MODEL\('[^']*',\(([^)]*)\),#\d+\)/);
    expect(dmMatch).not.toBeNull();
    const items = dmMatch![1].split(',').filter((s) => s.length > 0);
    expect(items).toContain(`#${dimId}`);
  });

  it('5 items (3 dim + 2 gdt) → DRAUGHTING_MODEL.items length 5', () => {
    const sheet = makeSheet({
      dimensions: [
        linearDim({ id: 'd1' }),
        radialDim({ id: 'd2' }),
        angularDim({ id: 'd3' }),
      ],
      gdtCallouts: [
        flatnessGdt({ id: 'g1' }),
        flatnessGdt({ id: 'g2', kind: 'cylindricity' }),
      ],
    });
    const res = writePmiFragmentWithSavedView(sheet, 100);
    const dmMatch = res.source.match(/DRAUGHTING_MODEL\('[^']*',\(([^)]*)\),#\d+\)/);
    expect(dmMatch).not.toBeNull();
    const items = dmMatch![1].split(',').filter((s) => s.length > 0);
    expect(items).toHaveLength(5);
    // Each PMI id from the mapping (other than 'saved_view') must appear.
    for (const [key, id] of res.mapping) {
      if (key === 'saved_view') continue;
      if (key.startsWith('datum_target:')) continue;
      expect(items).toContain(`#${id}`);
    }
  });

  it('viewName option → DRAUGHTING_MODEL.name uses it verbatim', () => {
    const res = writePmiFragmentWithSavedView(makeSheet(), 100, {
      viewName: 'My Inspection View',
    });
    expect(res.source).toContain("DRAUGHTING_MODEL('My Inspection View'");
  });

  it('mapping has saved_view key with the correct entity id', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const res = writePmiFragmentWithSavedView(sheet, 200);
    const id = res.mapping.get('saved_view');
    expect(id).toBeDefined();
    // The id must point at the DRAUGHTING_MODEL line in source.
    expect(res.source).toContain(`#${id}=DRAUGHTING_MODEL(`);
  });

  it('emits a REPRESENTATION mirroring DRAUGHTING_MODEL items', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const res = writePmiFragmentWithSavedView(sheet, 100);
    // Both DRAUGHTING_MODEL and REPRESENTATION present.
    expect(res.source).toContain('DRAUGHTING_MODEL(');
    expect(res.source).toMatch(/=REPRESENTATION\('[^']*',/);
  });

  it('emits PROPERTY_DEFINITION + PROPERTY_DEFINITION_REPRESENTATION', () => {
    const res = writePmiFragmentWithSavedView(makeSheet(), 100);
    expect(res.source).toContain('PROPERTY_DEFINITION(');
    expect(res.source).toContain('PROPERTY_DEFINITION_REPRESENTATION(');
  });

  it('default viewName is "Default PMI View"', () => {
    const res = writePmiFragmentWithSavedView(makeSheet(), 100);
    expect(res.source).toContain("DRAUGHTING_MODEL('Default PMI View'");
  });
});

describe('writePmiFragmentWithSavedView — datum targets', () => {
  it('3 targets [point, line, area] → 3 PLACED_DATUM_TARGET_FEATURE entities', () => {
    const sheet = makeSheet({
      gdtCallouts: [
        flatnessGdt({
          id: 'gdt-pos-1',
          kind: 'position',
          datums: ['A', 'B', 'C'],
        }),
      ],
    });
    const res = writePmiFragmentWithSavedView(sheet, 100, {
      datumTargets: [
        { name: 'A', targetType: 'point' },
        { name: 'B', targetType: 'line' },
        { name: 'C', targetType: 'area', size: 5 },
      ],
    });
    const placed = res.source.match(/=PLACED_DATUM_TARGET_FEATURE\(/g) ?? [];
    expect(placed.length).toBe(3);
    expect(res.mapping.get('datum_target:A')).toBeDefined();
    expect(res.mapping.get('datum_target:B')).toBeDefined();
    expect(res.mapping.get('datum_target:C')).toBeDefined();
  });

  it("DATUM_TARGET links to DATUM by name match (GdtCallout.datums = ['A'])", () => {
    const sheet = makeSheet({
      gdtCallouts: [
        flatnessGdt({
          id: 'gdt-pos-1',
          kind: 'position',
          datums: ['A'],
        }),
      ],
    });
    const res = writePmiFragmentWithSavedView(sheet, 100, {
      datumTargets: [{ name: 'A', targetType: 'point' }],
    });
    // Find the DATUM('A',...) entity id.
    const datumMatch = res.source.match(/#(\d+)=DATUM\('A'/);
    expect(datumMatch).not.toBeNull();
    const datumId = datumMatch![1];
    // PLACED_DATUM_TARGET_FEATURE's last arg must be `#<datumId>` (not `$`).
    // Use a per-line match anchored to the start of the line to avoid the
    // greedy `[^)]*` getting confused by earlier `)` in source.
    const placedLine = res.source
      .split('\n')
      .find((l) => l.includes('=PLACED_DATUM_TARGET_FEATURE('));
    expect(placedLine).toBeDefined();
    const placedMatch = placedLine!.match(
      /=PLACED_DATUM_TARGET_FEATURE\([^)]*,(#\d+|\$)\)/,
    );
    expect(placedMatch).not.toBeNull();
    expect(placedMatch![1]).toBe(`#${datumId}`);
  });

  it('unmatched datum target name → parent_datum slot is $', () => {
    // No GD&T callouts → no DATUM entities → target 'Z' has no parent.
    const res = writePmiFragmentWithSavedView(makeSheet(), 100, {
      datumTargets: [{ name: 'Z', targetType: 'point' }],
    });
    const placedLine = res.source
      .split('\n')
      .find((l) => l.includes('=PLACED_DATUM_TARGET_FEATURE('));
    expect(placedLine).toBeDefined();
    const placedMatch = placedLine!.match(
      /=PLACED_DATUM_TARGET_FEATURE\([^)]*,(#\d+|\$)\)/,
    );
    expect(placedMatch).not.toBeNull();
    expect(placedMatch![1]).toBe('$');
  });

  it('area datum target with size > 0 → CIRCULAR_AREA(..., size)', () => {
    const res = writePmiFragmentWithSavedView(makeSheet(), 100, {
      datumTargets: [{ name: 'A', targetType: 'area', size: 7.5 }],
    });
    expect(res.source).toContain('CIRCULAR_AREA(');
    // Size 7.5 → `fmt(7.5)` = `'7.5.'` (trailing `.` for STEP REAL literal).
    expect(res.source).toMatch(/CIRCULAR_AREA\('A\.1',#\d+,7\.5\.\)/);
  });

  it("point target → CARTESIAN_POINT (no LINE / no CIRCULAR_AREA)", () => {
    const res = writePmiFragmentWithSavedView(makeSheet(), 100, {
      datumTargets: [{ name: 'A', targetType: 'point' }],
    });
    expect(res.source).toContain('CARTESIAN_POINT(');
    expect(res.source).not.toContain('LINE(');
    expect(res.source).not.toContain('CIRCULAR_AREA(');
  });

  it("line target → LINE entity emitted", () => {
    const res = writePmiFragmentWithSavedView(makeSheet(), 100, {
      datumTargets: [{ name: 'A', targetType: 'line' }],
    });
    expect(res.source).toMatch(/=LINE\('A\.1'/);
    expect(res.source).toContain('VECTOR(');
    expect(res.source).toContain('DIRECTION(');
  });

  it('area target with missing/zero size → CIRCULAR_AREA(..., 0.)', () => {
    const res = writePmiFragmentWithSavedView(makeSheet(), 100, {
      datumTargets: [{ name: 'A', targetType: 'area' }],
    });
    expect(res.source).toMatch(/CIRCULAR_AREA\('A\.1',#\d+,0\.\)/);
  });
});

describe('writePmiFragmentWithSavedView — non-regression', () => {
  it('writePmiFragment output is unchanged when called directly', () => {
    // Sanity: snapshot a non-trivial output, then call the saved-view wrapper
    // with the same inputs and confirm the body prefix matches byte-for-byte.
    const sheet = makeSheet({
      dimensions: [linearDim({ id: 'd1' }), angularDim({ id: 'd2' })],
      gdtCallouts: [flatnessGdt({ id: 'g1', datums: [] })],
    });
    const bare = writePmiFragment(sheet, 100);
    const wrapped = writePmiFragmentWithSavedView(sheet, 100);
    expect(wrapped.source.startsWith(bare.source)).toBe(true);
    // Bare mapping entries must survive verbatim.
    for (const [k, v] of bare.mapping) {
      expect(wrapped.mapping.get(k)).toBe(v);
    }
  });

  it('entity ids monotonically increase through the saved-view tail', () => {
    const sheet = makeSheet({
      dimensions: [linearDim({ id: 'd1' })],
      gdtCallouts: [flatnessGdt({ id: 'g1' })],
    });
    const res = writePmiFragmentWithSavedView(sheet, 500, {
      datumTargets: [{ name: 'A', targetType: 'area', size: 2 }],
    });
    const idMatches = res.source.match(/#(\d+)/g) ?? [];
    expect(idMatches.length).toBeGreaterThan(0);
    for (const m of idMatches) {
      const n = Number.parseInt(m.slice(1), 10);
      expect(n).toBeGreaterThanOrEqual(500);
      expect(n).toBeLessThanOrEqual(res.lastEntityId);
    }
    // saved_view id must be > every dim/gdt id (it's emitted after body).
    const savedId = res.mapping.get('saved_view')!;
    expect(savedId).toBeGreaterThan(res.mapping.get('d1')!);
    expect(savedId).toBeGreaterThan(res.mapping.get('g1')!);
  });

  it('saved_view id is strictly greater than every dim/gdt mapping id', () => {
    const sheet = makeSheet({
      dimensions: [
        linearDim({ id: 'd1' }),
        radialDim({ id: 'd2' }),
        angularDim({ id: 'd3' }),
      ],
      gdtCallouts: [
        flatnessGdt({ id: 'g1' }),
        flatnessGdt({ id: 'g2', kind: 'position', datums: ['A'] }),
      ],
    });
    const res = writePmiFragmentWithSavedView(sheet, 100);
    const savedId = res.mapping.get('saved_view')!;
    for (const [k, v] of res.mapping) {
      if (k === 'saved_view') continue;
      expect(v).toBeLessThan(savedId);
    }
  });

  it('lastEntityId is the highest #N actually written', () => {
    const sheet = makeSheet({ dimensions: [linearDim()] });
    const res = writePmiFragmentWithSavedView(sheet, 100, {
      datumTargets: [{ name: 'A', targetType: 'line' }],
    });
    const idMatches = res.source.match(/#(\d+)/g) ?? [];
    const maxId = Math.max(...idMatches.map((m) => Number.parseInt(m.slice(1), 10)));
    expect(res.lastEntityId).toBe(maxId);
  });

  it('startEntityId validation still throws on invalid input', () => {
    // The wrapper delegates to writePmiFragment, which validates the seed.
    expect(() => writePmiFragmentWithSavedView(makeSheet(), 0)).toThrow();
    expect(() => writePmiFragmentWithSavedView(makeSheet(), -1)).toThrow();
    expect(() => writePmiFragmentWithSavedView(makeSheet(), 1.5)).toThrow();
  });

  it('parseDatumIdsByName ignores DATUM_REFERENCE / DATUM_SYSTEM / DATUM_TARGET', () => {
    // Build a faux source that has all four constructs; only DATUM('A',...)
    // should be captured.
    const fake =
      "#10=DATUM('A','A','',.T.,'A');\n" +
      "#11=DATUM_REFERENCE(1,#10);\n" +
      "#12=DATUM_SYSTEM('s',(#11));\n" +
      "#13=DATUM('B','B','',.T.,'B');\n";
    const out = __internal.parseDatumIdsByName(fake);
    expect(out.get('A')).toBe(10);
    expect(out.get('B')).toBe(13);
    expect(out.size).toBe(2);
  });
});
