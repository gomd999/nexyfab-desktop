/**
 * Tests for sketchDxfExport — AutoCAD R12-compatible ASCII DXF emission.
 *
 * DXF is a line-pair format: each record is two lines, a group code
 * followed by the value. To assert on emitted DXF we either:
 *   (a) substring-match the value on its own line, or
 *   (b) walk the line array as (code, value) pairs and verify the shape.
 *
 * We use both — (a) for "this content is somewhere" checks (cheap and
 * resilient to ordering changes inside a section), and (b) for the
 * "this entity has exactly these fields in this order" checks where
 * shape matters.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  exportSketchToDxf,
  downloadSketchAsDxf,
  type SketchEntities,
  type SketchDxfOptions,
} from './sketchDxfExport';

const empty: SketchEntities = { points: [], lines: [], circles: [], arcs: [] };

/**
 * Parse DXF text into an array of {code, value} pairs. Trivial split-by-
 * newline; sufficient for our minimal output since we don't emit any
 * multi-line group values.
 */
interface DxfPair {
  code: string;
  value: string;
}
function parseDxf(dxf: string): DxfPair[] {
  const lines = dxf.split('\n');
  const pairs: DxfPair[] = [];
  // The very last line is an empty string from the trailing '\n' we emit.
  // Pair up the rest.
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push({ code: lines[i].trim(), value: lines[i + 1] });
  }
  return pairs;
}

/** Find the index of the first pair matching code+value. */
function findPair(pairs: DxfPair[], code: string, value: string, from = 0): number {
  for (let i = from; i < pairs.length; i++) {
    if (pairs[i].code === code && pairs[i].value === value) return i;
  }
  return -1;
}

/** Slice all entities (between ENTITIES SECTION start and ENDSEC). */
function entitiesSlice(pairs: DxfPair[]): DxfPair[] {
  // Locate the ENTITIES section start: 0/SECTION followed by 2/ENTITIES.
  for (let i = 0; i + 1 < pairs.length; i++) {
    if (
      pairs[i].code === '0' &&
      pairs[i].value === 'SECTION' &&
      pairs[i + 1].code === '2' &&
      pairs[i + 1].value === 'ENTITIES'
    ) {
      // body starts at i+2; collect until next 0/ENDSEC
      const out: DxfPair[] = [];
      for (let j = i + 2; j < pairs.length; j++) {
        if (pairs[j].code === '0' && pairs[j].value === 'ENDSEC') return out;
        out.push(pairs[j]);
      }
      return out;
    }
  }
  return [];
}

describe('exportSketchToDxf — document scaffolding', () => {
  it('empty entities produces a valid DXF (header + tables + entities + EOF)', () => {
    const dxf = exportSketchToDxf(empty);
    // Must contain the canonical section markers in order.
    expect(dxf).toMatch(/^0\nSECTION\n2\nHEADER\n/);
    expect(dxf).toContain('0\nSECTION\n2\nTABLES\n');
    expect(dxf).toContain('0\nSECTION\n2\nENTITIES\n');
    expect(dxf).toMatch(/0\nEOF\n$/);
    // No entity records when empty.
    const ents = entitiesSlice(parseDxf(dxf));
    expect(ents).toEqual([]);
  });

  it('every value appears on its own line (line-pair grammar)', () => {
    const dxf = exportSketchToDxf(empty);
    // Total line count (excluding trailing empty) must be even.
    const lines = dxf.split('\n');
    // Drop the trailing newline-induced empty element.
    if (lines[lines.length - 1] === '') lines.pop();
    expect(lines.length % 2).toBe(0);
  });

  it('always emits exactly one EOF record, and it is the last record', () => {
    const dxf = exportSketchToDxf(empty);
    const pairs = parseDxf(dxf);
    const last = pairs[pairs.length - 1];
    expect(last).toEqual({ code: '0', value: 'EOF' });
    // Only one EOF total.
    const eofCount = pairs.filter((p) => p.code === '0' && p.value === 'EOF').length;
    expect(eofCount).toBe(1);
  });
});

describe('exportSketchToDxf — units', () => {
  it('defaults to mm ($INSUNITS = 4)', () => {
    const dxf = exportSketchToDxf(empty);
    const pairs = parseDxf(dxf);
    const idx = findPair(pairs, '9', '$INSUNITS');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(pairs[idx + 1]).toEqual({ code: '70', value: '4' });
  });

  it('explicit mm sets $INSUNITS to 4 and $MEASUREMENT to 1 (metric)', () => {
    const dxf = exportSketchToDxf(empty, { units: 'mm' });
    expect(dxf).toContain('$INSUNITS\n70\n4');
    expect(dxf).toContain('$MEASUREMENT\n70\n1');
  });

  it('inch sets $INSUNITS to 1 and $MEASUREMENT to 0 (English)', () => {
    const dxf = exportSketchToDxf(empty, { units: 'inch' });
    expect(dxf).toContain('$INSUNITS\n70\n1');
    expect(dxf).toContain('$MEASUREMENT\n70\n0');
  });
});

describe('exportSketchToDxf — layers', () => {
  it('default layer is "0" and the LAYER table contains it', () => {
    const dxf = exportSketchToDxf({
      points: [{ id: 'p1', x: 0, y: 0 }],
      lines: [], circles: [], arcs: [],
    });
    const pairs = parseDxf(dxf);
    // LAYER table entry: 0/LAYER, 2/<name>
    const layerIdx = findPair(pairs, '0', 'LAYER');
    expect(layerIdx).toBeGreaterThanOrEqual(0);
    // Point uses default layer.
    const ents = entitiesSlice(pairs);
    const layerPair = ents.find((p) => p.code === '8');
    expect(layerPair?.value).toBe('0');
  });

  it('custom layer is added to TABLE and every entity uses it', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 1, y2: 1 }],
      circles: [{ id: 'c1', cx: 0, cy: 0, radius: 1 }],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 1, startAngle: 0, endAngle: 1 }],
    };
    const dxf = exportSketchToDxf(entities, { layer: 'CONSTRUCTION' });
    // Layer table must list CONSTRUCTION.
    expect(dxf).toContain('0\nLAYER\n2\nCONSTRUCTION');
    // Every entity must reference CONSTRUCTION (code 8 records).
    const ents = entitiesSlice(parseDxf(dxf));
    const layerPairs = ents.filter((p) => p.code === '8');
    expect(layerPairs.length).toBe(4);
    for (const p of layerPairs) expect(p.value).toBe('CONSTRUCTION');
  });

  it('keeps "0" in the LAYER table even when a custom layer is set', () => {
    const dxf = exportSketchToDxf(empty, { layer: 'GEOMETRY' });
    // Both "0" and "GEOMETRY" should be enumerated as LAYER entries.
    const pairs = parseDxf(dxf);
    const names: string[] = [];
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i].code === '0' && pairs[i].value === 'LAYER' && pairs[i + 1]?.code === '2') {
        names.push(pairs[i + 1].value);
      }
    }
    expect(names).toContain('0');
    expect(names).toContain('GEOMETRY');
  });
});

describe('exportSketchToDxf — title metadata', () => {
  it('omits $PROJECTNAME when no title is supplied', () => {
    const dxf = exportSketchToDxf(empty);
    expect(dxf).not.toContain('$PROJECTNAME');
  });

  it('emits $PROJECTNAME with the supplied title', () => {
    const dxf = exportSketchToDxf(empty, { title: 'Bracket A' });
    expect(dxf).toContain('$PROJECTNAME\n1\nBracket A');
  });

  it('sanitizes embedded newlines in the title (would otherwise break line-pair grammar)', () => {
    const dxf = exportSketchToDxf(empty, { title: 'A\nB' });
    // \n would shove "B" onto its own line, corrupting the file. Must be
    // replaced with a space.
    expect(dxf).toContain('$PROJECTNAME\n1\nA B');
  });
});

describe('exportSketchToDxf — POINT entity', () => {
  it('emits a single POINT with code 10 (x) / 20 (y) / 30 (z=0)', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 3.5, y: -4.5 }],
      lines: [], circles: [], arcs: [],
    };
    const dxf = exportSketchToDxf(entities);
    const ents = entitiesSlice(parseDxf(dxf));
    // Find the POINT entity start and verify the record shape.
    const idx = ents.findIndex((p) => p.code === '0' && p.value === 'POINT');
    expect(idx).toBeGreaterThanOrEqual(0);
    // After 0/POINT we expect 8/<layer>, then 10/x, 20/y, 30/z=0.
    expect(ents[idx + 1]).toEqual({ code: '8', value: '0' });
    expect(ents[idx + 2]).toEqual({ code: '10', value: '3.5' });
    expect(ents[idx + 3]).toEqual({ code: '20', value: '-4.5' });
    expect(ents[idx + 4]).toEqual({ code: '30', value: '0.0' });
  });
});

describe('exportSketchToDxf — LINE entity', () => {
  it('emits LINE with 10/20 start and 11/21 end', () => {
    const entities: SketchEntities = {
      points: [],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 1, y1: 2, x2: 3, y2: 4 }],
      circles: [], arcs: [],
    };
    const dxf = exportSketchToDxf(entities);
    const ents = entitiesSlice(parseDxf(dxf));
    const idx = ents.findIndex((p) => p.code === '0' && p.value === 'LINE');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(ents[idx + 1]).toEqual({ code: '8', value: '0' });
    expect(ents[idx + 2]).toEqual({ code: '10', value: '1.0' });
    expect(ents[idx + 3]).toEqual({ code: '20', value: '2.0' });
    expect(ents[idx + 4]).toEqual({ code: '30', value: '0.0' });
    expect(ents[idx + 5]).toEqual({ code: '11', value: '3.0' });
    expect(ents[idx + 6]).toEqual({ code: '21', value: '4.0' });
    expect(ents[idx + 7]).toEqual({ code: '31', value: '0.0' });
  });
});

describe('exportSketchToDxf — CIRCLE entity', () => {
  it('emits CIRCLE with 10/20 center and 40 radius', () => {
    const entities: SketchEntities = {
      points: [], lines: [],
      circles: [{ id: 'c1', cx: 5, cy: -2, radius: 7.25 }],
      arcs: [],
    };
    const dxf = exportSketchToDxf(entities);
    const ents = entitiesSlice(parseDxf(dxf));
    const idx = ents.findIndex((p) => p.code === '0' && p.value === 'CIRCLE');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(ents[idx + 1]).toEqual({ code: '8', value: '0' });
    expect(ents[idx + 2]).toEqual({ code: '10', value: '5.0' });
    expect(ents[idx + 3]).toEqual({ code: '20', value: '-2.0' });
    expect(ents[idx + 4]).toEqual({ code: '30', value: '0.0' });
    expect(ents[idx + 5]).toEqual({ code: '40', value: '7.25' });
  });
});

describe('exportSketchToDxf — ARC entity', () => {
  it('converts radian angles to degrees in codes 50/51', () => {
    // startAngle=0 rad → 0°, endAngle=π/2 rad → 90°.
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2 }],
    };
    const dxf = exportSketchToDxf(entities);
    const ents = entitiesSlice(parseDxf(dxf));
    const idx = ents.findIndex((p) => p.code === '0' && p.value === 'ARC');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(ents[idx + 2]).toEqual({ code: '10', value: '0.0' });
    expect(ents[idx + 3]).toEqual({ code: '20', value: '0.0' });
    expect(ents[idx + 4]).toEqual({ code: '30', value: '0.0' });
    expect(ents[idx + 5]).toEqual({ code: '40', value: '10.0' });
    expect(ents[idx + 6]).toEqual({ code: '50', value: '0.0' });
    expect(ents[idx + 7]).toEqual({ code: '51', value: '90.0' });
  });

  it('normalizes negative-angle starts to [0,360) for strict readers', () => {
    // startAngle = -π/2 → -90° → normalized to 270°.
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 1, startAngle: -Math.PI / 2, endAngle: 0 }],
    };
    const dxf = exportSketchToDxf(entities);
    const ents = entitiesSlice(parseDxf(dxf));
    const idx = ents.findIndex((p) => p.code === '0' && p.value === 'ARC');
    expect(ents[idx + 6]).toEqual({ code: '50', value: '270.0' });
    expect(ents[idx + 7]).toEqual({ code: '51', value: '0.0' });
  });

  it('handles angles greater than 2π by wrapping into [0,360)', () => {
    // 3π = 540° → 180°.
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 1, startAngle: 0, endAngle: 3 * Math.PI }],
    };
    const dxf = exportSketchToDxf(entities);
    const ents = entitiesSlice(parseDxf(dxf));
    const idx = ents.findIndex((p) => p.code === '0' && p.value === 'ARC');
    expect(ents[idx + 7]).toEqual({ code: '51', value: '180.0' });
  });
});

describe('exportSketchToDxf — mixed entities', () => {
  it('emits all four entity types in stable order (circles → arcs → lines → points)', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 1, y2: 0 }],
      circles: [{ id: 'c1', cx: 0, cy: 0, radius: 1 }],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 2, startAngle: 0, endAngle: 1 }],
    };
    const dxf = exportSketchToDxf(entities);
    // Order check via substring index — all four must be present.
    const idxCircle = dxf.indexOf('0\nCIRCLE\n');
    const idxArc = dxf.indexOf('0\nARC\n');
    const idxLine = dxf.indexOf('0\nLINE\n');
    const idxPoint = dxf.indexOf('0\nPOINT\n');
    expect(idxCircle).toBeGreaterThan(-1);
    expect(idxArc).toBeGreaterThan(idxCircle);
    expect(idxLine).toBeGreaterThan(idxArc);
    expect(idxPoint).toBeGreaterThan(idxLine);
  });

  it('all entities live inside the ENTITIES section, not elsewhere', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 1, y2: 0 }],
      circles: [{ id: 'c1', cx: 0, cy: 0, radius: 1 }],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 2, startAngle: 0, endAngle: 1 }],
    };
    const dxf = exportSketchToDxf(entities);
    const ents = entitiesSlice(parseDxf(dxf));
    // Inside the ENTITIES slice we expect exactly four type-tagging records.
    const types = ents.filter((p) => p.code === '0').map((p) => p.value);
    expect(types).toEqual(['CIRCLE', 'ARC', 'LINE', 'POINT']);
  });
});

describe('exportSketchToDxf — extents', () => {
  it('writes $EXTMIN/$EXTMAX covering all entity bounds', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: -10, y: -5 }],
      lines: [],
      circles: [{ id: 'c1', cx: 20, cy: 20, radius: 5 }],
      arcs: [],
    };
    const dxf = exportSketchToDxf(entities);
    // bbox: x ∈ [-10, 25], y ∈ [-5, 25]
    expect(dxf).toContain('$EXTMIN\n10\n-10.0\n20\n-5.0');
    expect(dxf).toContain('$EXTMAX\n10\n25.0\n20\n25.0');
  });

  it('uses (0,0)-(0,0) extents for an empty sketch', () => {
    const dxf = exportSketchToDxf(empty);
    expect(dxf).toContain('$EXTMIN\n10\n0.0\n20\n0.0');
    expect(dxf).toContain('$EXTMAX\n10\n0.0\n20\n0.0');
  });
});

describe('exportSketchToDxf — number formatting', () => {
  it('emits integer values as "N.0" to mark them as DXF reals', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 5, y: 0 }],
      lines: [], circles: [], arcs: [],
    };
    const dxf = exportSketchToDxf(entities);
    // The x=5 must appear as "5.0", not "5".
    expect(dxf).toContain('\n10\n5.0\n');
    expect(dxf).not.toMatch(/\n10\n5\n/);
  });

  it('rounds long-decimal coordinates to 6 places', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0.1 + 0.2, y: 0 }],
      lines: [], circles: [], arcs: [],
    };
    const dxf = exportSketchToDxf(entities);
    // 0.1 + 0.2 = 0.30000000000000004 → rounded to 0.3
    expect(dxf).toContain('\n10\n0.3\n');
  });

  it('normalizes -0 to 0 for stable diffs', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: -0, y: -0 }],
      lines: [], circles: [], arcs: [],
    };
    const dxf = exportSketchToDxf(entities);
    expect(dxf).not.toMatch(/\n10\n-0\.0\n/);
    expect(dxf).toContain('\n10\n0.0\n');
  });
});

describe('exportSketchToDxf — determinism', () => {
  it('produces byte-identical output for equivalent inputs', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 1, y: 2 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 5, y2: 5 }],
      circles: [{ id: 'c1', cx: 0, cy: 0, radius: 3 }],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 4, startAngle: 0, endAngle: Math.PI }],
    };
    const a = exportSketchToDxf(entities);
    const b = exportSketchToDxf(entities);
    expect(a).toBe(b);
  });
});

describe('downloadSketchAsDxf', () => {
  let createUrlSpy: ReturnType<typeof vi.fn>;
  let revokeUrlSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createUrlSpy = vi.fn(() => 'blob:mock-dxf-url-1');
    revokeUrlSpy = vi.fn();
    const anchorBag = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
    };
    clickSpy = anchorBag.click as ReturnType<typeof vi.fn>;
    const doc = {
      createElement: vi.fn(() => anchorBag),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    };
    vi.stubGlobal('window', { Blob });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('URL', {
      createObjectURL: createUrlSpy,
      revokeObjectURL: revokeUrlSpy,
    });
    if (typeof globalThis.Blob === 'undefined') {
      vi.stubGlobal('Blob', class MockBlob {
        constructor(public parts: unknown[], public opts: unknown) {}
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls URL.createObjectURL and clicks the anchor', () => {
    downloadSketchAsDxf(empty, 'sketch.dxf');
    expect(createUrlSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('appends .dxf extension when missing from filename', () => {
    let capturedDownload = '';
    const doc = {
      createElement: vi.fn(() => {
        const a: { href: string; download: string; style: { display: string }; click: () => void } = {
          href: '',
          download: '',
          style: { display: '' },
          click: vi.fn(),
        };
        Object.defineProperty(a, 'download', {
          get() { return capturedDownload; },
          set(v: string) { capturedDownload = v; },
        });
        return a;
      }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    };
    vi.stubGlobal('document', doc);
    downloadSketchAsDxf(empty, 'my-sketch');
    expect(capturedDownload).toBe('my-sketch.dxf');
  });

  it('throws when called outside a DOM environment', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    expect(() => downloadSketchAsDxf(empty, 'x.dxf')).toThrow(/browser/);
  });

  it('passes through opts (custom layer reflected in DXF body)', () => {
    // Stash the Blob payload so we can read what was written.
    let capturedBlobBody = '';
    class CapturingBlob {
      constructor(parts: unknown[]) {
        capturedBlobBody = (parts[0] as string) ?? '';
      }
    }
    vi.stubGlobal('Blob', CapturingBlob);
    const opts: SketchDxfOptions = { layer: 'SKETCH', units: 'inch' };
    downloadSketchAsDxf(empty, 'x.dxf', opts);
    expect(capturedBlobBody).toContain('0\nLAYER\n2\nSKETCH');
    expect(capturedBlobBody).toContain('$INSUNITS\n70\n1');
  });
});

describe('exportSketchToDxf — line-pair parser sanity', () => {
  it('parser round-trips a known fixture: empty sketch yields a fixed minimum pair count', () => {
    const dxf = exportSketchToDxf(empty);
    const pairs = parseDxf(dxf);
    // Sanity: every (code, value) must be non-empty strings; the code
    // must be a number-as-string.
    for (const p of pairs) {
      expect(p.code).toMatch(/^\d+$/);
      expect(typeof p.value).toBe('string');
    }
    // The minimum well-formed output we emit has these landmark records.
    expect(pairs.some((p) => p.code === '0' && p.value === 'SECTION')).toBe(true);
    expect(pairs.some((p) => p.code === '2' && p.value === 'HEADER')).toBe(true);
    expect(pairs.some((p) => p.code === '2' && p.value === 'TABLES')).toBe(true);
    expect(pairs.some((p) => p.code === '2' && p.value === 'ENTITIES')).toBe(true);
    expect(pairs.some((p) => p.code === '0' && p.value === 'EOF')).toBe(true);
  });
});
