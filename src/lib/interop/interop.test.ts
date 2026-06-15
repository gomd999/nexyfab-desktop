/**
 * Phase 5.3 + 5.4 interop tests — DXF read/roundtrip + STL ASCII write.
 */
import { describe, it, expect } from 'vitest';
import { writeStlAscii, countTriangles, StlError, type StlSolid } from './stlWrite';
import { parseDxf, DxfReadError } from './dxfRead';
import { sheetToDxf } from '../drawing/dxfExport';
import { standardThreeViewSheet } from '../drawing/sheet';

// ─── STL ──────────────────────────────────────────────────────────────────

describe('writeStlAscii', () => {
  it('emits solid/endsolid wrapper with the given name', () => {
    const s: StlSolid = {
      name: 'test',
      triangles: [
        {
          vertices: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
          ],
        },
      ],
    };
    const out = writeStlAscii(s);
    expect(out.startsWith('solid test')).toBe(true);
    expect(out.trim().endsWith('endsolid test')).toBe(true);
  });

  it('replaces whitespace in the name with underscores', () => {
    const s: StlSolid = {
      name: 'has spaces',
      triangles: [{
        vertices: [
          { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
        ],
      }],
    };
    expect(writeStlAscii(s)).toContain('solid has_spaces');
  });

  it('throws on empty triangle list', () => {
    expect(() => writeStlAscii({ name: 't', triangles: [] })).toThrow(StlError);
  });

  it('computes normal from winding (CCW = outward, +z for xy triangle)', () => {
    const s: StlSolid = {
      name: 't',
      triangles: [{
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
      }],
    };
    const out = writeStlAscii(s);
    // Cross product (1,0,0) × (0,1,0) = (0,0,1). Normalized = (0,0,1).
    expect(out).toMatch(/facet normal 0 0 1/);
  });

  it('uses provided normal if present (skips computation)', () => {
    const s: StlSolid = {
      name: 't',
      triangles: [{
        vertices: [
          { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
        ],
        normal: { x: 0.1, y: 0.2, z: 0.3 },
      }],
    };
    expect(writeStlAscii(s)).toMatch(/facet normal 0\.1 0\.2 0\.3/);
  });

  it('countTriangles returns triangle count', () => {
    expect(countTriangles({ name: 't', triangles: [
      { vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }] },
      { vertices: [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 1, z: 1 }] },
    ]})).toBe(2);
  });
});

// ─── DXF ──────────────────────────────────────────────────────────────────

describe('parseDxf', () => {
  it('parses a LINE entity emitted by sheetToDxf', () => {
    const sheet = standardThreeViewSheet({
      id: 's1', name: 'T', sourceId: 'src', paperSize: 'A4', scale: 1,
    });
    const dxf = sheetToDxf(sheet);
    const parsed = parseDxf(dxf);
    const lines = parsed.entities.filter((e) => e.kind === 'LINE');
    // 4 sheet border + 4 viewports × 4 lines each = 20.
    expect(lines.length).toBe(20);
  });

  it('parses TEXT entities', () => {
    const sheet = standardThreeViewSheet({
      id: 's1', name: 'T', sourceId: 'src', paperSize: 'A4', scale: 1,
    });
    const dxf = sheetToDxf(sheet);
    const parsed = parseDxf(dxf);
    const texts = parsed.entities.filter((e) => e.kind === 'TEXT');
    expect(texts.length).toBe(4); // FRONT, TOP, RIGHT, ISO
    expect(texts.map((t) => (t as { text: string }).text).sort()).toEqual(['FRONT', 'ISO', 'RIGHT', 'TOP']);
  });

  it('extracts $EXTMAX from header', () => {
    const sheet = standardThreeViewSheet({
      id: 's1', name: 'T', sourceId: 'src', paperSize: 'A4', scale: 1,
    });
    const dxf = sheetToDxf(sheet);
    const parsed = parseDxf(dxf);
    expect(parsed.header.extMax).toEqual({ x: 297, y: 210, z: 0 });
  });

  it('collects unique layer names', () => {
    const sheet = standardThreeViewSheet({
      id: 's1', name: 'T', sourceId: 'src', paperSize: 'A4', scale: 1,
    });
    const dxf = sheetToDxf(sheet);
    const parsed = parseDxf(dxf);
    expect(parsed.layers).toContain('SHEET_BORDER');
    expect(parsed.layers).toContain('VP_front');
  });

  it('parses CIRCLE entity correctly', () => {
    const dxf = [
      '  0', 'SECTION', '  2', 'ENTITIES',
      '  0', 'CIRCLE', '  8', 'L1', ' 10', '5.0', ' 20', '3.0', ' 30', '0.0', ' 40', '7.5',
      '  0', 'ENDSEC', '  0', 'EOF',
    ].join('\n');
    const parsed = parseDxf(dxf);
    expect(parsed.entities.length).toBe(1);
    const c = parsed.entities[0]!;
    expect(c.kind).toBe('CIRCLE');
    if (c.kind === 'CIRCLE') {
      expect(c.x).toBe(5);
      expect(c.y).toBe(3);
      expect(c.radius).toBe(7.5);
      expect(c.layer).toBe('L1');
    }
  });

  it('unknown entity kinds become UNKNOWN with preserved type string', () => {
    const dxf = [
      '  0', 'SECTION', '  2', 'ENTITIES',
      '  0', 'INSERT', '  8', 'L1', '  2', 'BLOCK_X',
      '  0', 'ENDSEC', '  0', 'EOF',
    ].join('\n');
    const parsed = parseDxf(dxf);
    expect(parsed.entities[0]!.kind).toBe('UNKNOWN');
    if (parsed.entities[0]!.kind === 'UNKNOWN') {
      expect(parsed.entities[0]!.type).toBe('INSERT');
    }
  });

  it('throws on malformed group code', () => {
    const dxf = 'NotANumber\nfoo';
    expect(() => parseDxf(dxf)).toThrow(DxfReadError);
  });

  it('parses LWPOLYLINE with closed flag', () => {
    const dxf = [
      '  0', 'SECTION', '  2', 'ENTITIES',
      '  0', 'LWPOLYLINE', '  8', '0', ' 70', '1',
      ' 10', '0', ' 20', '0',
      ' 10', '10', ' 20', '0',
      ' 10', '10', ' 20', '5',
      ' 10', '0', ' 20', '5',
      '  0', 'ENDSEC', '  0', 'EOF',
    ].join('\n');
    const parsed = parseDxf(dxf);
    const p = parsed.entities[0]!;
    expect(p.kind).toBe('LWPOLYLINE');
    if (p.kind === 'LWPOLYLINE') {
      expect(p.vertices.length).toBe(4);
      expect(p.closed).toBe(true);
    }
  });
});
