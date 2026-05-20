import { describe, it, expect } from 'vitest';
import {
  StepWriter, cartesianPoint, direction, emitProduct, emitDimensionalTolerance, emitFeatureControlFrame,
} from './stepAp242Writer';
import { writeJt, buildLodPyramid, JT_VERSION, type JtAssembly } from './jtWriter';
import { IgesWriter } from './igesWriter';

// ── STEP AP242 ────────────────────────────────────────────────────

describe('StepWriter', () => {
  it('emits ISO 10303-21 header + footer', () => {
    const w = new StepWriter();
    cartesianPoint(w, 0, 0, 0);
    const out = w.finish({
      fileName: 'test.stp', author: 'A', organisation: 'B',
      preprocessorVersion: 'v1', originatingSystem: 'NexyFab',
      schema: 'AP242',
    });
    expect(out).toContain('ISO-10303-21');
    expect(out).toContain('END-ISO-10303-21');
  });

  it('AP242 schema URI emitted', () => {
    const w = new StepWriter();
    const out = w.finish({
      fileName: 't', author: 'a', organisation: 'b',
      preprocessorVersion: 'v', originatingSystem: 's', schema: 'AP242',
    });
    expect(out).toContain('AP242');
  });

  it('cartesianPoint produces a CARTESIAN_POINT entity', () => {
    const w = new StepWriter();
    const id = cartesianPoint(w, 1.5, 2.5, 3.5);
    expect(id).toMatch(/^#\d+$/);
    const out = w.finish({
      fileName: 't', author: 'a', organisation: 'b',
      preprocessorVersion: 'v', originatingSystem: 's', schema: 'AP242',
    });
    expect(out).toContain('CARTESIAN_POINT');
    expect(out).toContain('1.500000');
  });

  it('direction entity uses DIRECTION type', () => {
    const w = new StepWriter();
    direction(w, 1, 0, 0);
    const out = w.finish({
      fileName: 't', author: 'a', organisation: 'b',
      preprocessorVersion: 'v', originatingSystem: 's', schema: 'AP242',
    });
    expect(out).toContain('DIRECTION');
  });

  it('emitProduct creates PRODUCT + PRODUCT_DEFINITION', () => {
    const w = new StepWriter();
    const r = emitProduct(w, 'P-001', 'Bracket', 'mounting bracket');
    expect(r.productId).toMatch(/^#\d+$/);
    expect(r.productDefinitionId).toMatch(/^#\d+$/);
  });

  it('emitDimensionalTolerance attaches DIMENSIONAL_LOCATION', () => {
    const w = new StepWriter();
    const id = emitDimensionalTolerance(w, '#10', 0.05, 'hole diameter');
    expect(id).toMatch(/^#\d+$/);
    const out = w.finish({
      fileName: 't', author: 'a', organisation: 'b',
      preprocessorVersion: 'v', originatingSystem: 's', schema: 'AP242',
    });
    expect(out).toContain('DIMENSIONAL_LOCATION');
  });

  it('emitFeatureControlFrame supports flatness', () => {
    const w = new StepWriter();
    emitFeatureControlFrame(w, '#10', 'flatness', 0.02);
    const out = w.finish({
      fileName: 't', author: 'a', organisation: 'b',
      preprocessorVersion: 'v', originatingSystem: 's', schema: 'AP242',
    });
    expect(out).toContain('FLATNESS_TOLERANCE');
  });
});

// ── JT ─────────────────────────────────────────────────────────────

describe('writeJt', () => {
  const part: JtAssembly = {
    name: 'Test',
    parts: [{
      name: 'Cube',
      partNumber: 'P-001',
      lods: [{
        positions: [0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0],
        indices: [0, 1, 2, 0, 2, 3],
      }],
    }],
  };

  it('emits JT version + units header', () => {
    const out = writeJt(part);
    expect(out).toContain(`JT-VERSION: ${JT_VERSION}`);
    expect(out).toContain('UNITS: mm');
  });

  it('encodes part + LOD vertices', () => {
    const out = writeJt(part);
    expect(out).toContain('PART: P-001 Cube');
    expect(out).toContain('LOD: 0');
    expect(out).toContain('VERTICES: 4');
    expect(out).toContain('TRIANGLES: 2');
  });

  it('metadata emitted when present', () => {
    const withMeta: JtAssembly = {
      ...part,
      parts: [{ ...part.parts[0]!, metadata: { material: 'Al6061', mass: '0.12kg' } }],
    };
    const out = writeJt(withMeta);
    expect(out).toContain('META: material = Al6061');
  });
});

describe('buildLodPyramid', () => {
  const positions = Array.from({ length: 90 }, (_, i) => i % 10);
  const indices = Array.from({ length: 30 }, (_, i) => i % 30);

  it('produces N levels', () => {
    const lods = buildLodPyramid(positions, indices, [1.0, 0.5, 0.25]);
    expect(lods).toHaveLength(3);
  });

  it('lower LODs have fewer triangles', () => {
    const lods = buildLodPyramid(positions, indices, [1.0, 0.5, 0.25]);
    expect(lods[0]!.indices.length).toBeGreaterThan(lods[2]!.indices.length);
  });
});

// ── IGES ───────────────────────────────────────────────────────────

describe('IgesWriter', () => {
  it('emits S/G/D/P/T sections', () => {
    const w = new IgesWriter();
    w.addLine([0, 0, 0], [10, 0, 0]);
    const out = w.finish({
      sender: 'NexyFab', fileName: 'test.igs',
      receiver: 'Partner', productId: 'P-001',
      precision: 0.0001, units: 'MM',
    });
    const lines = out.split('\n');
    expect(lines.some(l => /S\s+\d+$/.test(l))).toBe(true);
    expect(lines.some(l => /D\s+\d+$/.test(l))).toBe(true);
    expect(lines.some(l => /P\s+\d+$/.test(l))).toBe(true);
    expect(lines.some(l => /T0000001$/.test(l))).toBe(true);
  });

  it('line entity uses type 110', () => {
    const w = new IgesWriter();
    w.addLine([0, 0, 0], [10, 0, 0]);
    const out = w.finish({
      sender: 'A', fileName: 't', receiver: 'B', productId: 'P',
      precision: 0.0001, units: 'MM',
    });
    expect(out).toContain('110,');
  });

  it('point entity uses type 116', () => {
    const w = new IgesWriter();
    w.addPoint([5, 5, 5]);
    const out = w.finish({
      sender: 'A', fileName: 't', receiver: 'B', productId: 'P',
      precision: 0.0001, units: 'MM',
    });
    expect(out).toContain('116,');
  });

  it('terminate section concludes the file', () => {
    const w = new IgesWriter();
    w.addLine([0, 0, 0], [1, 1, 1]);
    const out = w.finish({
      sender: 'A', fileName: 't', receiver: 'B', productId: 'P',
      precision: 0.0001, units: 'MM',
    });
    expect(out).toMatch(/T0000001$/);
  });
});
