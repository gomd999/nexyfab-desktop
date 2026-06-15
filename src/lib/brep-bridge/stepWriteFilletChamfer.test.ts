/**
 * stepWriteFilletChamfer — Phase 5.1.3 fillet / chamfer STEP writer tests.
 *
 * Verifies the orchestrator's Phase 1 contract:
 *   - child extrude portion is byte-identical to writeExtrudeAsStep
 *   - SHAPE_ASPECT annotation is spliced before DATA's closing ENDSEC;
 *   - entity ids are monotonic and non-colliding
 *   - radius / distance / vertexRadii / vertexDistances appear verbatim
 *   - negative / non-finite values throw
 */
import { describe, it, expect } from 'vitest';
import {
  writeFilletAsStep,
  writeChamferAsStep,
  previewFilletAnnotationMap,
  previewChamferAnnotationMap,
  __internal,
} from './stepWriteFilletChamfer';
import { writeExtrudeAsStep } from './stepWrite';
import { buildFilletFeature, type FilletFeature } from '@/lib/cad/filletProfile';
import { buildChamferFeature, type ChamferFeature } from '@/lib/cad/chamferProfile';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── fixtures ─────────────────────────────────────────────────────────────

function rectExtrude(depth = 20): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function rectExtrudeLarge(depth = 50): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

/** Strip header timestamps so two outputs differing only by `new Date()` compare equal. */
function stripVolatileFields(s: string): string {
  // FILE_NAME embeds a timestamp; replace with a stable placeholder.
  return s.replace(/FILE_NAME\([^)]*\);/g, "FILE_NAME('<NORM>');");
}

// ─── writeFilletAsStep — happy path ──────────────────────────────────────

describe('writeFilletAsStep', () => {
  it('emits a complete STEP file with ISO markers', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const out = writeFilletAsStep(f);
    expect(out.startsWith('ISO-10303-21;')).toBe(true);
    expect(out.includes('END-ISO-10303-21;')).toBe(true);
    expect(out).toContain('DATA;');
    expect(out).toContain('ENDSEC;');
  });

  it('includes a SHAPE_ASPECT with kind=FILLET', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const out = writeFilletAsStep(f);
    expect(out).toMatch(/SHAPE_ASPECT\([^)]*FILLET/);
  });

  it('embeds the radius value in the SHAPE_ASPECT description', () => {
    const f = buildFilletFeature(rectExtrude(), 1.5, 'all');
    const out = writeFilletAsStep(f);
    expect(out).toContain('radius=1.5');
  });

  it('integer radius gets the REAL marker dot (e.g. radius=2.)', () => {
    const f = buildFilletFeature(rectExtrude(), 2, 'all');
    const out = writeFilletAsStep(f);
    expect(out).toContain('radius=2.');
  });

  it('embeds the edgeSelection value', () => {
    for (const sel of ['all', 'top', 'bottom', 'vertical'] as const) {
      const f = buildFilletFeature(rectExtrude(), 1, sel);
      const out = writeFilletAsStep(f);
      expect(out).toContain(`edges=${sel}`);
    }
  });

  it('child extrude portion is byte-identical to writeExtrudeAsStep', () => {
    // Use a fixed timestamp to make the comparison stable across both calls.
    const ts = '2026-06-02T00:00:00.000Z';
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const filleted = writeFilletAsStep(f, { timestamp: ts });
    const baseline = writeExtrudeAsStep(f.childExtrude, { timestamp: ts });

    // The baseline ends with `<last-geom-line>\nENDSEC;\nEND-ISO-10303-21;\n`.
    // The filleted output inserts annotation lines just before the geometry's
    // closing ENDSEC;. So everything up to that point must match byte-for-byte.
    const endsecBaseIdx = baseline.lastIndexOf('ENDSEC;');
    const baselineBeforeEndsec = baseline.slice(0, endsecBaseIdx);
    expect(filleted.startsWith(baselineBeforeEndsec)).toBe(true);
  });

  it('annotation SHAPE_ASPECT id is monotonic (strictly > all geometry ids)', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const out = writeFilletAsStep(f);
    // Find the SHAPE_ASPECT id.
    const saMatch = /^#(\d+)\s*=\s*SHAPE_ASPECT\(/m.exec(out);
    expect(saMatch).not.toBeNull();
    const saId = Number.parseInt(saMatch![1]!, 10);
    // Find the geometry's max id (excluding the SHAPE_ASPECT block itself).
    // Strategy: find max id of MANIFOLD_SOLID_BREP / ADVANCED_FACE / etc.,
    // i.e. all ids that are NOT the annotation ones.
    const geometryIds: number[] = [];
    const re = /^#(\d+)\s*=/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      const id = Number.parseInt(m[1]!, 10);
      // Skip the SHAPE_ASPECT block ids.
      if (id < saId) geometryIds.push(id);
    }
    expect(geometryIds.length).toBeGreaterThan(0);
    expect(Math.max(...geometryIds)).toBeLessThan(saId);
  });

  it('emits SHAPE_DEFINITION_REPRESENTATION linking SHAPE_ASPECT to a MANIFOLD_SOLID_BREP', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const out = writeFilletAsStep(f);
    const saMatch = /^#(\d+)\s*=\s*SHAPE_ASPECT\(/m.exec(out);
    expect(saMatch).not.toBeNull();
    const saId = saMatch![1]!;
    // There may be MULTIPLE SHAPE_DEFINITION_REPRESENTATION lines (one
    // produced by stepWrite's emitProductForSolid + the one we splice in).
    // We need the one whose first arg is `#<saId>`.
    const sdrRe = new RegExp(
      `^#(\\d+)\\s*=\\s*SHAPE_DEFINITION_REPRESENTATION\\(#${saId},#(\\d+)\\)`,
      'm',
    );
    const sdrMatch = sdrRe.exec(out);
    expect(sdrMatch).not.toBeNull();
    // The SDR's second arg must point at a MANIFOLD_SOLID_BREP entity.
    const solidId = sdrMatch![2]!;
    const solidRe = new RegExp(`^#${solidId}\\s*=\\s*MANIFOLD_SOLID_BREP\\(`, 'm');
    expect(solidRe.test(out)).toBe(true);
  });

  it('uses the supplied featureId as the SHAPE_ASPECT name', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const out = writeFilletAsStep(f, { featureId: 'my-corner-fillet' });
    expect(out).toContain("SHAPE_ASPECT('my-corner-fillet'");
  });

  it('defaults featureId to FILLET_1', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const out = writeFilletAsStep(f);
    expect(out).toContain("SHAPE_ASPECT('FILLET_1'");
  });

  it('embeds vertexRadii list when feature has variable radii', () => {
    const f = buildFilletFeature(rectExtrude(), {
      radius: 1,
      edgeSelection: 'vertical',
      vertexRadii: [0.5, 1, 1.5, 2],
    });
    const out = writeFilletAsStep(f);
    expect(out).toContain('vertexRadii=[0.5,1.,1.5,2.]');
  });

  it('throws when given a non-fillet feature kind', () => {
    const bogus = { kind: 'extrude', childExtrude: rectExtrude(), radius: 1, edgeSelection: 'all' };
    expect(() => writeFilletAsStep(bogus as unknown as FilletFeature)).toThrow(/expected kind='fillet'/);
  });

  it('throws on negative radius (direct object — bypassing the builder)', () => {
    const bad: FilletFeature = {
      kind: 'fillet',
      childExtrude: rectExtrude(),
      radius: -1,
      edgeSelection: 'all',
    };
    expect(() => writeFilletAsStep(bad)).toThrow(/positive/);
  });

  it('throws on non-finite radius (NaN / Infinity)', () => {
    const badNaN: FilletFeature = {
      kind: 'fillet',
      childExtrude: rectExtrude(),
      radius: Number.NaN,
      edgeSelection: 'all',
    };
    expect(() => writeFilletAsStep(badNaN)).toThrow(/positive finite/);
    const badInf: FilletFeature = {
      kind: 'fillet',
      childExtrude: rectExtrude(),
      radius: Number.POSITIVE_INFINITY,
      edgeSelection: 'all',
    };
    expect(() => writeFilletAsStep(badInf)).toThrow(/positive finite/);
  });

  it('throws on non-positive vertexRadii entry', () => {
    const bad: FilletFeature = {
      kind: 'fillet',
      childExtrude: rectExtrude(),
      radius: 1,
      edgeSelection: 'vertical',
      vertexRadii: [1, -0.5, 1, 1],
    };
    expect(() => writeFilletAsStep(bad)).toThrow(/positive finite/);
  });

  it('throws on empty vertexRadii', () => {
    const bad: FilletFeature = {
      kind: 'fillet',
      childExtrude: rectExtrude(),
      radius: 1,
      edgeSelection: 'all',
      vertexRadii: [],
    };
    expect(() => writeFilletAsStep(bad)).toThrow(/non-empty/);
  });
});

// ─── writeChamferAsStep — happy path ─────────────────────────────────────

describe('writeChamferAsStep', () => {
  it('emits a complete STEP file with ISO markers', () => {
    const c = buildChamferFeature(rectExtrude(), 1, 'all');
    const out = writeChamferAsStep(c);
    expect(out.startsWith('ISO-10303-21;')).toBe(true);
    expect(out.includes('END-ISO-10303-21;')).toBe(true);
  });

  it('includes a SHAPE_ASPECT with kind=CHAMFER', () => {
    const c = buildChamferFeature(rectExtrude(), 1, 'all');
    const out = writeChamferAsStep(c);
    expect(out).toMatch(/SHAPE_ASPECT\([^)]*CHAMFER/);
  });

  it('embeds the distance value in the SHAPE_ASPECT description', () => {
    const c = buildChamferFeature(rectExtrude(), 0.75, 'vertical');
    const out = writeChamferAsStep(c);
    expect(out).toContain('distance=0.75');
    expect(out).toContain('edges=vertical');
  });

  it('child extrude portion is byte-identical to writeExtrudeAsStep', () => {
    const ts = '2026-06-02T00:00:00.000Z';
    const c = buildChamferFeature(rectExtrude(), 1, 'all');
    const chamfered = writeChamferAsStep(c, { timestamp: ts });
    const baseline = writeExtrudeAsStep(c.childExtrude, { timestamp: ts });
    const endsecBaseIdx = baseline.lastIndexOf('ENDSEC;');
    expect(chamfered.startsWith(baseline.slice(0, endsecBaseIdx))).toBe(true);
  });

  it('embeds vertexDistances list when feature has variable distances', () => {
    const c = buildChamferFeature(rectExtrude(), {
      distance: 1,
      edgeSelection: 'vertical',
      vertexDistances: [0.25, 0.5, 0.75, 1.25],
    });
    const out = writeChamferAsStep(c);
    expect(out).toContain('vertexDistances=[0.25,0.5,0.75,1.25]');
  });

  it('throws when given a non-chamfer feature kind', () => {
    const bogus = { kind: 'fillet', childExtrude: rectExtrude(), distance: 1, edgeSelection: 'all' };
    expect(() => writeChamferAsStep(bogus as unknown as ChamferFeature)).toThrow(/expected kind='chamfer'/);
  });

  it('throws on negative distance', () => {
    const bad: ChamferFeature = {
      kind: 'chamfer',
      childExtrude: rectExtrude(),
      distance: -1,
      edgeSelection: 'all',
    };
    expect(() => writeChamferAsStep(bad)).toThrow(/positive/);
  });

  it('defaults featureId to CHAMFER_1', () => {
    const c = buildChamferFeature(rectExtrude(), 1, 'all');
    const out = writeChamferAsStep(c);
    expect(out).toContain("SHAPE_ASPECT('CHAMFER_1'");
  });
});

// ─── multi-fillet scenario (different children) ──────────────────────────

describe('writeFilletAsStep — multi-fillet scenarios', () => {
  it('two separate writeFilletAsStep calls each produce their own SHAPE_ASPECT', () => {
    const a = buildFilletFeature(rectExtrude(), 1, 'all');
    const b = buildFilletFeature(rectExtrudeLarge(), 2, 'vertical');
    const outA = writeFilletAsStep(a, { featureId: 'feat-A' });
    const outB = writeFilletAsStep(b, { featureId: 'feat-B' });
    expect(outA).toContain("SHAPE_ASPECT('feat-A'");
    expect(outB).toContain("SHAPE_ASPECT('feat-B'");
    expect(outA).toContain('radius=1.');
    expect(outB).toContain('radius=2.');
    expect(outA).toContain('edges=all');
    expect(outB).toContain('edges=vertical');
  });

  it('different child geometries produce different geometry blocks', () => {
    const ts = '2026-06-02T00:00:00.000Z';
    const a = buildFilletFeature(rectExtrude(), 1, 'all');
    const b = buildFilletFeature(rectExtrudeLarge(), 1, 'all');
    const outA = stripVolatileFields(writeFilletAsStep(a, { timestamp: ts }));
    const outB = stripVolatileFields(writeFilletAsStep(b, { timestamp: ts }));
    expect(outA).not.toBe(outB);
  });

  it('the same input produces identical output (deterministic, ts-stripped)', () => {
    const ts = '2026-06-02T00:00:00.000Z';
    const f = buildFilletFeature(rectExtrude(), 1.5, 'top');
    const o1 = stripVolatileFields(writeFilletAsStep(f, { timestamp: ts }));
    const o2 = stripVolatileFields(writeFilletAsStep(f, { timestamp: ts }));
    expect(o1).toBe(o2);
  });
});

// ─── preview functions ───────────────────────────────────────────────────

describe('preview annotation maps', () => {
  it('previewFilletAnnotationMap returns same id that writeFilletAsStep allocates', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const preview = previewFilletAnnotationMap(f, { featureId: 'F1' });
    const out = writeFilletAsStep(f, { featureId: 'F1' });
    const saMatch = /^#(\d+)\s*=\s*SHAPE_ASPECT\(/m.exec(out);
    expect(saMatch).not.toBeNull();
    expect(Number.parseInt(saMatch![1]!, 10)).toBe(preview.shapeAspectEntityId);
    expect(preview.featureId).toBe('F1');
  });

  it('previewChamferAnnotationMap returns same id that writeChamferAsStep allocates', () => {
    const c = buildChamferFeature(rectExtrude(), 1, 'all');
    const preview = previewChamferAnnotationMap(c, { featureId: 'C1' });
    const out = writeChamferAsStep(c, { featureId: 'C1' });
    const saMatch = /^#(\d+)\s*=\s*SHAPE_ASPECT\(/m.exec(out);
    expect(Number.parseInt(saMatch![1]!, 10)).toBe(preview.shapeAspectEntityId);
  });
});

// ─── internal helper unit tests ──────────────────────────────────────────

describe('__internal helpers', () => {
  it('scanMaxEntityId picks up the largest line-anchored #N=', () => {
    const sample = '#10=A;\n#20=B(#10);\n#15=C;\n,#999,\n';
    // `,#999,` is NOT line-anchored, so the scanner should ignore it.
    expect(__internal.scanMaxEntityId(sample)).toBe(20);
  });

  it('scanMaxEntityId returns 0 on empty / no-entity input', () => {
    expect(__internal.scanMaxEntityId('')).toBe(0);
    expect(__internal.scanMaxEntityId('no entities here\n')).toBe(0);
  });

  it('findManifoldSolidBrepId returns the line-anchored MSB entity id', () => {
    const sample =
      '#10=CARTESIAN_POINT(...);\n#42=MANIFOLD_SOLID_BREP(...,#41);\n#50=APPLICATION_CONTEXT(...);';
    expect(__internal.findManifoldSolidBrepId(sample)).toBe(42);
  });

  it('findManifoldSolidBrepId returns -1 when none present', () => {
    expect(__internal.findManifoldSolidBrepId('#10=CARTESIAN_POINT(...);')).toBe(-1);
  });

  it('fmt matches stepWrite REAL literal contract for integers and fractions', () => {
    expect(__internal.fmt(0)).toBe('0.');
    expect(__internal.fmt(1)).toBe('1.');
    expect(__internal.fmt(-2)).toBe('-2.');
    expect(__internal.fmt(1.5)).toBe('1.5');
    expect(__internal.fmt(2.5)).toBe('2.5');
  });

  it('fmt throws on non-finite', () => {
    expect(() => __internal.fmt(Number.NaN)).toThrow(/non-finite/);
    expect(() => __internal.fmt(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it('esc doubles single quotes and strips control chars', () => {
    expect(__internal.esc("it's")).toBe("it''s");
    expect(__internal.esc('ab')).toBe('a b');
  });

  it('buildFilletDescriptor includes all uniform-path fields', () => {
    const f = buildFilletFeature(rectExtrude(), 1.25, 'top');
    const d = __internal.buildFilletDescriptor(f, 99);
    expect(d).toBe('FILLET(radius=1.25, edges=top, solid=#99)');
  });

  it('buildChamferDescriptor includes all uniform-path fields', () => {
    const c = buildChamferFeature(rectExtrude(), 0.5, 'bottom');
    const d = __internal.buildChamferDescriptor(c, 77);
    expect(d).toBe('CHAMFER(distance=0.5, edges=bottom, solid=#77)');
  });

  it('buildFilletDescriptor switches to vertexRadii path when present', () => {
    const f = buildFilletFeature(rectExtrude(), {
      radius: 1,
      edgeSelection: 'vertical',
      vertexRadii: [0.5, 1, 1.5, 2],
    });
    const d = __internal.buildFilletDescriptor(f, 42);
    expect(d).toBe('FILLET(vertexRadii=[0.5,1.,1.5,2.], edges=vertical, solid=#42)');
  });

  it('spliceAnnotation inserts annotation strictly before closing ENDSEC;', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const out = writeFilletAsStep(f);
    const endsecIdx = out.lastIndexOf('ENDSEC;');
    const saIdx = out.indexOf('SHAPE_ASPECT(');
    expect(saIdx).toBeGreaterThan(0);
    expect(saIdx).toBeLessThan(endsecIdx);
  });

  it('annotation block contains a kind-tagged comment for traceability', () => {
    const f = buildFilletFeature(rectExtrude(), 1, 'all');
    const filletOut = writeFilletAsStep(f, { featureId: 'FX' });
    expect(filletOut).toContain('/* FILLET annotation');
    expect(filletOut).toContain('FX');

    const c = buildChamferFeature(rectExtrude(), 1, 'all');
    const chamferOut = writeChamferAsStep(c, { featureId: 'CX' });
    expect(chamferOut).toContain('/* CHAMFER annotation');
    expect(chamferOut).toContain('CX');
  });
});
