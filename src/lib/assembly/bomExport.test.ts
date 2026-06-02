/**
 * bomExport — unit tests (Phase 4.5).
 *
 * Covers buildBom, bomToCsv, bomToJson, plus the volume helpers
 * (signedArea / centroidX / estimatePartVolume).
 */
import { describe, it, expect } from 'vitest';
import {
  buildBom,
  bomToCsv,
  bomToJson,
  estimatePartVolume,
  signedArea,
  centroidX,
  escapeCsvField,
  BOM_CSV_COLUMNS,
  DEFAULT_DENSITIES,
  DEFAULT_MATERIAL,
} from './bomExport';
import {
  IDENTITY_QUAT,
  partInstance,
  type AssemblyState,
} from './assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';

// ─── builders ─────────────────────────────────────────────────────────────

function makePart(id: string, opts: Partial<{ name: string; fixed: boolean }> = {}) {
  return partInstance({
    id,
    name: opts.name ?? id,
    partTemplateId: 'tpl',
    position: { x: 0, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed: opts.fixed ?? false,
  });
}

/** A 10 × 10 mm square in the XY plane (CCW). Area = 100 mm². */
const SQUARE_10x10: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function extrudeNode(id: string, depth = 5, mode: ExtrudeFeature['mode'] = 'add'): FeatureTree {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: SQUARE_10x10,
    depth,
    direction: 'one_sided',
    mode,
  };
  return {
    nodes: [
      { id, name: id, dependencies: [], payload },
    ],
  };
}

function makeAssembly(parts: ReturnType<typeof makePart>[]): AssemblyState {
  return { parts, mates: [] };
}

const FIXED_ISO = '2026-01-01T00:00:00.000Z';

// ─── signedArea / centroidX ───────────────────────────────────────────────

describe('signedArea', () => {
  it('returns 100 for a 10x10 CCW square', () => {
    expect(signedArea(SQUARE_10x10)).toBe(100);
  });

  it('returns -100 when the same square is reversed (CW)', () => {
    expect(signedArea([...SQUARE_10x10].reverse())).toBe(-100);
  });

  it('returns 0 for fewer than 3 points', () => {
    expect(signedArea([])).toBe(0);
    expect(signedArea([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(0);
  });
});

describe('centroidX', () => {
  it('returns 5 for the 10x10 square (geometric center)', () => {
    expect(centroidX(SQUARE_10x10)).toBeCloseTo(5);
  });

  it('falls back to bbox midpoint for collinear points', () => {
    // 3 collinear points → degenerate polygon, bbox X ∈ [0, 4], mid = 2.
    expect(centroidX([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ])).toBeCloseTo(2);
  });
});

// ─── estimatePartVolume ───────────────────────────────────────────────────

describe('estimatePartVolume', () => {
  it('returns undefined when no tree is provided', () => {
    expect(estimatePartVolume(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty tree (no nodes)', () => {
    expect(estimatePartVolume({ nodes: [] })).toBeUndefined();
  });

  it('computes area × depth for a one-sided extrude', () => {
    // 10x10 square × 5 mm depth = 500 mm³.
    expect(estimatePartVolume(extrudeNode('e1', 5))).toBe(500);
  });

  it('doubles the depth for a two-sided extrude', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'e1',
          name: 'e1',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: SQUARE_10x10,
            depth: 5,
            direction: 'two_sided',
            mode: 'add',
          } as ExtrudeFeature,
        },
      ],
    };
    expect(estimatePartVolume(tree)).toBe(1000);
  });

  it('subtracts cut-mode extrude volumes', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'boss',
          name: 'boss',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: SQUARE_10x10,
            depth: 5,
            direction: 'one_sided',
            mode: 'add',
          } as ExtrudeFeature,
        },
        {
          id: 'pocket',
          name: 'pocket',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: SQUARE_10x10,
            depth: 1,
            direction: 'one_sided',
            mode: 'cut',
          } as ExtrudeFeature,
        },
      ],
    };
    // 500 (boss) - 100 (cut) = 400.
    expect(estimatePartVolume(tree)).toBe(400);
  });

  it('skips suppressed nodes', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'e1',
          name: 'e1',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: SQUARE_10x10,
            depth: 5,
            direction: 'one_sided',
            mode: 'add',
          } as ExtrudeFeature,
        },
        {
          id: 'e2',
          name: 'e2',
          dependencies: [],
          suppressed: true,
          payload: {
            kind: 'extrude',
            loop: SQUARE_10x10,
            depth: 5,
            direction: 'one_sided',
            mode: 'add',
          } as ExtrudeFeature,
        },
      ],
    };
    expect(estimatePartVolume(tree)).toBe(500);
  });

  it('floors negative-sum trees at 0 (all-cut never produces negative BOM)', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'cut',
          name: 'cut',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: SQUARE_10x10,
            depth: 5,
            direction: 'one_sided',
            mode: 'cut',
          } as ExtrudeFeature,
        },
      ],
    };
    expect(estimatePartVolume(tree)).toBe(0);
  });

  it('uses Pappus theorem for revolve volume (full 360°)', () => {
    // 10×10 square offset to X ∈ [5, 15] revolved around Y axis →
    // V = A × 2π × r_c = 100 × 2π × 10 = 2000π ≈ 6283.185.
    const loop = [
      { x: 5, y: 0 },
      { x: 15, y: 0 },
      { x: 15, y: 10 },
      { x: 5, y: 10 },
    ];
    const payload: RevolveFeature = {
      kind: 'revolve',
      loop,
      angleDegrees: 360,
      mode: 'add',
    };
    const tree: FeatureTree = {
      nodes: [{ id: 'r1', name: 'r1', dependencies: [], payload }],
    };
    expect(estimatePartVolume(tree)).toBeCloseTo(2000 * Math.PI, 3);
  });

  it('scales revolve volume linearly with sweep angle', () => {
    const loop = [
      { x: 5, y: 0 },
      { x: 15, y: 0 },
      { x: 15, y: 10 },
      { x: 5, y: 10 },
    ];
    const tree: FeatureTree = {
      nodes: [{
        id: 'r1',
        name: 'r1',
        dependencies: [],
        payload: {
          kind: 'revolve',
          loop,
          angleDegrees: 180,
          mode: 'add',
        } as RevolveFeature,
      }],
    };
    expect(estimatePartVolume(tree)).toBeCloseTo(1000 * Math.PI, 3);
  });

  it('returns undefined for trees containing only hole / fillet / chamfer (Phase 1 unmodelled)', () => {
    const tree: FeatureTree = {
      nodes: [{
        id: 'h1',
        name: 'h1',
        dependencies: [],
        payload: {
          kind: 'hole',
          // Cast: holeProfile shape doesn't matter — buildBom never touches it.
        } as unknown as ExtrudeFeature,
      }],
    };
    expect(estimatePartVolume(tree)).toBeUndefined();
  });
});

// ─── buildBom ─────────────────────────────────────────────────────────────

describe('buildBom', () => {
  it('returns 0 entries / 0 totalParts for an empty assembly', () => {
    const bom = buildBom(makeAssembly([]), { generatedAt: FIXED_ISO });
    expect(bom.entries).toEqual([]);
    expect(bom.totalParts).toBe(0);
    expect(bom.totalMass).toBeUndefined();
    expect(bom.generatedAt).toBe(FIXED_ISO);
  });

  it('emits one BomEntry per PartInstance', () => {
    const bom = buildBom(makeAssembly([
      makePart('p1', { name: 'Base', fixed: true }),
      makePart('p2', { name: 'Arm' }),
    ]), { generatedAt: FIXED_ISO });
    expect(bom.entries).toHaveLength(2);
    expect(bom.entries[0]!.partId).toBe('p1');
    expect(bom.entries[0]!.name).toBe('Base');
    expect(bom.entries[1]!.partId).toBe('p2');
    expect(bom.entries[1]!.name).toBe('Arm');
    expect(bom.totalParts).toBe(2);
  });

  it('quantity is always 1 in Phase 1', () => {
    const bom = buildBom(makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
      makePart('p2_dup'),
    ]), { generatedAt: FIXED_ISO });
    expect(bom.entries.every((e) => e.quantity === 1)).toBe(true);
  });

  it('attaches volume when featureTrees provide one', () => {
    const bom = buildBom(makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]), {
      featureTrees: {
        p1: extrudeNode('e1', 5),
        p2: extrudeNode('e2', 3),
      },
      generatedAt: FIXED_ISO,
    });
    expect(bom.entries[0]!.volume).toBe(500);
    expect(bom.entries[1]!.volume).toBe(300);
  });

  it('computes mass = volume × density when material + density resolve', () => {
    const bom = buildBom(makeAssembly([makePart('p1', { fixed: true })]), {
      featureTrees: { p1: extrudeNode('e1', 5) }, // 500 mm³
      materials: { p1: 'steel' },                  // 0.00785 g/mm³
      generatedAt: FIXED_ISO,
    });
    expect(bom.entries[0]!.material).toBe('steel');
    expect(bom.entries[0]!.mass).toBeCloseTo(500 * DEFAULT_DENSITIES.steel!, 6);
    expect(bom.totalMass).toBeCloseTo(500 * DEFAULT_DENSITIES.steel!, 6);
  });

  it('totalMass sums across every entry that resolved a mass', () => {
    const bom = buildBom(makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]), {
      featureTrees: {
        p1: extrudeNode('e1', 5),
        p2: extrudeNode('e2', 5),
      },
      materials: { p1: 'aluminum', p2: 'steel' },
      generatedAt: FIXED_ISO,
    });
    const expected =
      500 * DEFAULT_DENSITIES.aluminum! +
      500 * DEFAULT_DENSITIES.steel!;
    expect(bom.totalMass).toBeCloseTo(expected, 6);
  });

  it('defaults material to "unspecified" when none is supplied', () => {
    const bom = buildBom(makeAssembly([makePart('p1', { fixed: true })]), {
      generatedAt: FIXED_ISO,
    });
    expect(bom.entries[0]!.material).toBe(DEFAULT_MATERIAL);
    expect(bom.entries[0]!.mass).toBeUndefined();
    expect(bom.totalMass).toBeUndefined();
  });

  it('lets callers add custom densities without losing the defaults', () => {
    const bom = buildBom(makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]), {
      featureTrees: { p1: extrudeNode('e1', 5), p2: extrudeNode('e2', 5) },
      materials: { p1: 'steel', p2: 'unobtainium' },
      densities: { unobtainium: 0.01 },
      generatedAt: FIXED_ISO,
    });
    // default 'steel' still resolves
    expect(bom.entries[0]!.mass).toBeCloseTo(500 * DEFAULT_DENSITIES.steel!, 6);
    // custom material picked up
    expect(bom.entries[1]!.mass).toBeCloseTo(500 * 0.01, 6);
  });

  it('attaches notes when supplied', () => {
    const bom = buildBom(makeAssembly([makePart('p1', { fixed: true })]), {
      notes: { p1: 'machine before paint' },
      generatedAt: FIXED_ISO,
    });
    expect(bom.entries[0]!.notes).toBe('machine before paint');
  });

  it('mass stays undefined when material has no known density', () => {
    const bom = buildBom(makeAssembly([makePart('p1', { fixed: true })]), {
      featureTrees: { p1: extrudeNode('e1', 5) },
      materials: { p1: 'kryptonite' },
      generatedAt: FIXED_ISO,
    });
    expect(bom.entries[0]!.volume).toBe(500);
    expect(bom.entries[0]!.mass).toBeUndefined();
  });

  it('generatedAt is a parseable ISO string when not injected', () => {
    const before = Date.now();
    const bom = buildBom(makeAssembly([makePart('p1', { fixed: true })]));
    const parsed = Date.parse(bom.generatedAt);
    expect(Number.isNaN(parsed)).toBe(false);
    // sanity: timestamp should land in the same ballpark as now
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
    expect(parsed).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('honours the assemblyName override', () => {
    const bom = buildBom(makeAssembly([]), {
      assemblyName: 'gearbox-v3',
      generatedAt: FIXED_ISO,
    });
    expect(bom.assemblyName).toBe('gearbox-v3');
  });

  it('defaults assemblyName to "assembly"', () => {
    const bom = buildBom(makeAssembly([]), { generatedAt: FIXED_ISO });
    expect(bom.assemblyName).toBe('assembly');
  });
});

// ─── escapeCsvField ──────────────────────────────────────────────────────

describe('escapeCsvField', () => {
  it('renders undefined / null as the empty string', () => {
    expect(escapeCsvField(undefined)).toBe('');
    expect(escapeCsvField(null)).toBe('');
  });

  it('passes through plain ASCII verbatim', () => {
    expect(escapeCsvField('hello')).toBe('hello');
    expect(escapeCsvField(42)).toBe('42');
  });

  it('double-quotes a field containing a comma', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('doubles the embedded double-quote and wraps in quotes', () => {
    expect(escapeCsvField('She said "hi"')).toBe('"She said ""hi"""');
  });

  it('wraps fields containing CR or LF', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });
});

// ─── bomToCsv ────────────────────────────────────────────────────────────

describe('bomToCsv', () => {
  it('starts with the canonical header row', () => {
    const csv = bomToCsv(buildBom(makeAssembly([]), { generatedAt: FIXED_ISO }));
    const [header] = csv.split('\r\n');
    expect(header).toBe(BOM_CSV_COLUMNS.join(','));
  });

  it('emits one data row per entry, CRLF-terminated', () => {
    const bom = buildBom(makeAssembly([
      makePart('p1', { name: 'Base', fixed: true }),
      makePart('p2', { name: 'Arm' }),
    ]), { generatedAt: FIXED_ISO });
    const lines = bomToCsv(bom).split('\r\n');
    // 1 header + 2 rows
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('p1');
    expect(lines[1]).toContain('Base');
    expect(lines[2]).toContain('p2');
    expect(lines[2]).toContain('Arm');
  });

  it('RFC 4180 escapes a name containing a comma', () => {
    const bom = buildBom(makeAssembly([
      makePart('p1', { name: 'Plate, large', fixed: true }),
    ]), { generatedAt: FIXED_ISO });
    const csv = bomToCsv(bom);
    expect(csv).toContain('"Plate, large"');
  });

  it('RFC 4180 escapes a name containing a double quote', () => {
    const bom = buildBom(makeAssembly([
      makePart('p1', { name: 'Bolt "M6"', fixed: true }),
    ]), { generatedAt: FIXED_ISO });
    const csv = bomToCsv(bom);
    expect(csv).toContain('"Bolt ""M6"""');
  });

  it('renders volume / mass numerics without locale grouping', () => {
    const bom = buildBom(makeAssembly([makePart('p1', { fixed: true })]), {
      featureTrees: { p1: extrudeNode('e1', 1500) }, // 100 × 1500 = 150 000 mm³
      generatedAt: FIXED_ISO,
    });
    const csv = bomToCsv(bom);
    // Should not contain a thousands separator like "150,000".
    expect(csv).toContain('150000');
    expect(csv).not.toMatch(/150,000(?!\d)/);
  });

  it('leaves the volume / mass / material / notes columns empty when undefined', () => {
    const bom = buildBom(makeAssembly([makePart('p1', { fixed: true })]), {
      generatedAt: FIXED_ISO,
    });
    const csv = bomToCsv(bom);
    const dataRow = csv.split('\r\n')[1]!;
    // partId,name,quantity,material,volume_mm3,mass_g,notes
    // "p1","p1",1,"unspecified",,,
    const cols = dataRow.split(',');
    expect(cols[0]).toBe('p1');
    expect(cols[1]).toBe('p1');
    expect(cols[2]).toBe('1');
    expect(cols[3]).toBe(DEFAULT_MATERIAL);
    expect(cols[4]).toBe('');
    expect(cols[5]).toBe('');
    expect(cols[6]).toBe('');
  });
});

// ─── bomToJson ───────────────────────────────────────────────────────────

describe('bomToJson', () => {
  it('produces valid JSON that round-trips through JSON.parse', () => {
    const bom = buildBom(makeAssembly([
      makePart('p1', { fixed: true }),
      makePart('p2'),
    ]), {
      featureTrees: { p1: extrudeNode('e1', 5) },
      generatedAt: FIXED_ISO,
    });
    const json = bomToJson(bom);
    const round = JSON.parse(json);
    expect(round.totalParts).toBe(2);
    expect(round.entries).toHaveLength(2);
    expect(round.entries[0].partId).toBe('p1');
    expect(round.entries[0].volume).toBe(500);
    expect(round.generatedAt).toBe(FIXED_ISO);
  });

  it('uses 2-space indentation (pretty-printed)', () => {
    const json = bomToJson(buildBom(makeAssembly([]), { generatedAt: FIXED_ISO }));
    // Pretty-printed output contains literal '\n  ' (newline + 2 spaces).
    expect(json).toContain('\n  ');
  });
});
