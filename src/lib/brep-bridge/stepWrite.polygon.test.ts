/**
 * stepWrite.polygon — Phase 5.1 polygon-profile extrude writer tests.
 *
 * Covers `writeExtrudePolygonAsStep` (the N-vertex convex-polygon writer)
 * and the polygon variant of `writeAssemblyAsStep`. The writer falls back
 * to the BOX-only path of `writeExtrudeAsStep` for concave or
 * self-intersecting loops — those fallback paths are exercised here too.
 *
 * Entity-count expectations for a CCW convex profile with N vertices,
 * extruded by depth D:
 *
 *     VERTEX_POINT  = 2 * N
 *     EDGE_CURVE    = 3 * N
 *     ADVANCED_FACE = N + 2     (N side rectangles + 1 top + 1 bottom)
 *
 * Companion to stepWrite.test.ts (36 baseline tests must still pass).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  writeExtrudeAsStep,
  writeExtrudePolygonAsStep,
  writeAssemblyAsStep,
  classifyPolygonLoop,
  type AssemblyStepInput,
} from './stepWrite';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── fixtures ─────────────────────────────────────────────────────────────

function polygonExtrude(
  loop: ReadonlyArray<{ x: number; y: number }>,
  depth: number,
): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop,
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function triangleLoop(): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 8 },
  ];
}

function pentagonLoop(): ReadonlyArray<{ x: number; y: number }> {
  // Regular pentagon, CCW, circumradius 10.
  return Array.from({ length: 5 }, (_, i) => {
    const a = (Math.PI / 2) + (2 * Math.PI * i) / 5;
    return { x: 10 * Math.cos(a), y: 10 * Math.sin(a) };
  });
}

function hexagonLoop(): ReadonlyArray<{ x: number; y: number }> {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (2 * Math.PI * i) / 6;
    return { x: 10 * Math.cos(a), y: 10 * Math.sin(a) };
  });
}

/** L-shape: 6-vertex concave polygon (one reflex vertex). */
function concaveLLoop(): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 4 },
    { x: 4, y: 4 },   // reflex vertex
    { x: 4, y: 10 },
    { x: 0, y: 10 },
  ];
}

/** Bowtie: 4-vertex self-intersecting loop. */
function bowtieLoop(): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];
}

function rectLoop(width: number, height: number) {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

function rectExtrude(width: number, height: number, depth: number): ExtrudeFeature {
  return polygonExtrude(rectLoop(width, height), depth);
}

// Helper: count occurrences of an entity keyword in STEP output.
function count(out: string, pattern: RegExp): number {
  return (out.match(pattern) ?? []).length;
}

// ─── classification helper ───────────────────────────────────────────────

describe('classifyPolygonLoop', () => {
  it('reports convex for a CCW triangle', () => {
    expect(classifyPolygonLoop(triangleLoop()).kind).toBe('convex');
  });

  it('reports convex for a regular hexagon', () => {
    expect(classifyPolygonLoop(hexagonLoop()).kind).toBe('convex');
  });

  it('reports concave for an L-shape', () => {
    const cls = classifyPolygonLoop(concaveLLoop());
    expect(cls.kind).toBe('concave');
  });

  it('reports self_intersecting for a bowtie', () => {
    expect(classifyPolygonLoop(bowtieLoop()).kind).toBe('self_intersecting');
  });

  it('reports degenerate for a 2-point loop', () => {
    const cls = classifyPolygonLoop([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(cls.kind).toBe('degenerate');
  });

  it('reports degenerate for a zero-area collinear loop', () => {
    const cls = classifyPolygonLoop([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    ]);
    expect(cls.kind).toBe('degenerate');
  });
});

// ─── writeExtrudePolygonAsStep — convex polygons ─────────────────────────

describe('writeExtrudePolygonAsStep — triangle (N=3)', () => {
  it('emits N+2 = 5 ADVANCED_FACE entries', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(triangleLoop(), 4));
    expect(count(out, /ADVANCED_FACE\(/g)).toBe(5);
  });

  it('emits 2N = 6 VERTEX_POINT entries', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(triangleLoop(), 4));
    expect(count(out, /VERTEX_POINT\(/g)).toBe(6);
  });

  it('emits 3N = 9 EDGE_CURVE entries', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(triangleLoop(), 4));
    expect(count(out, /EDGE_CURVE\(/g)).toBe(9);
  });

  it('emits exactly one MANIFOLD_SOLID_BREP / CLOSED_SHELL', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(triangleLoop(), 4));
    expect(count(out, /MANIFOLD_SOLID_BREP/g)).toBe(1);
    expect(count(out, /CLOSED_SHELL/g)).toBe(1);
  });

  it('every ORIENTED_EDGE has an orientation flag (4 per side, N for each cap)', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(triangleLoop(), 4));
    // N=3: 3 side faces × 4 edges + 2 caps × 3 edges = 12 + 6 = 18.
    const matches = out.match(/ORIENTED_EDGE\([^)]*\.[TF]\.\)/g) ?? [];
    expect(matches.length).toBe(18);
  });

  it('embeds the actual polygon vertices (not bounding box)', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(triangleLoop(), 4));
    // Apex (5,8) is interior to the bbox — its presence proves the polygon
    // wasn't flattened to a bbox.
    expect(out).toContain('(5.,8.,0.)');
    expect(out).toContain('(5.,8.,4.)');
  });

  it('produces a syntactically complete STEP file', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(triangleLoop(), 4));
    expect(out.startsWith('ISO-10303-21;')).toBe(true);
    expect(out.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
    expect(out).toContain('HEADER;');
    expect(out).toContain('DATA;');
  });

  it('every #N reference resolves to a defined entity', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(triangleLoop(), 4));
    const defined = new Set<number>();
    for (const m of out.matchAll(/^#(\d+)=/gm)) defined.add(Number(m[1]));
    const dataSection = out.slice(out.indexOf('DATA;'));
    for (const m of dataSection.matchAll(/#(\d+)/g)) {
      expect(defined.has(Number(m[1]))).toBe(true);
    }
  });
});

describe('writeExtrudePolygonAsStep — pentagon (N=5)', () => {
  it('emits N+2 = 7 ADVANCED_FACE entries', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(pentagonLoop(), 3));
    expect(count(out, /ADVANCED_FACE\(/g)).toBe(7);
  });

  it('emits 2N = 10 VERTEX_POINT and 3N = 15 EDGE_CURVE entries', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(pentagonLoop(), 3));
    expect(count(out, /VERTEX_POINT\(/g)).toBe(10);
    expect(count(out, /EDGE_CURVE\(/g)).toBe(15);
  });
});

describe('writeExtrudePolygonAsStep — hexagon (N=6)', () => {
  it('emits N+2 = 8 ADVANCED_FACE entries', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(hexagonLoop(), 2));
    expect(count(out, /ADVANCED_FACE\(/g)).toBe(8);
  });

  it('emits 2N = 12 VERTEX_POINT and 3N = 18 EDGE_CURVE entries', () => {
    const out = writeExtrudePolygonAsStep(polygonExtrude(hexagonLoop(), 2));
    expect(count(out, /VERTEX_POINT\(/g)).toBe(12);
    expect(count(out, /EDGE_CURVE\(/g)).toBe(18);
  });
});

describe('writeExtrudePolygonAsStep — orientation handling', () => {
  it('accepts a CW input loop and emits the same face count as CCW', () => {
    const ccw = triangleLoop();
    const cw = [...ccw].reverse();
    const outCcw = writeExtrudePolygonAsStep(polygonExtrude(ccw, 4));
    const outCw = writeExtrudePolygonAsStep(polygonExtrude(cw, 4));
    expect(count(outCcw, /ADVANCED_FACE\(/g)).toBe(5);
    expect(count(outCw, /ADVANCED_FACE\(/g)).toBe(5);
  });
});

// ─── fallback paths ───────────────────────────────────────────────────────

describe('writeExtrudePolygonAsStep — fallback paths', () => {
  it('concave L-shape falls back to bbox (6 ADVANCED_FACE, not 8)', () => {
    const onFallback = vi.fn();
    const out = writeExtrudePolygonAsStep(polygonExtrude(concaveLLoop(), 5), { onFallback });
    expect(count(out, /ADVANCED_FACE\(/g)).toBe(6); // bbox = 6 faces
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]?.[0]?.reason).toBe('concave');
  });

  it('self-intersecting bowtie falls back to bbox', () => {
    const onFallback = vi.fn();
    const out = writeExtrudePolygonAsStep(polygonExtrude(bowtieLoop(), 5), { onFallback });
    expect(count(out, /ADVANCED_FACE\(/g)).toBe(6);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]?.[0]?.reason).toBe('self_intersecting');
  });

  it('default fallback handler calls console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      writeExtrudePolygonAsStep(polygonExtrude(concaveLLoop(), 5));
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('throws on a <3 point loop (no fallback for degenerate input)', () => {
    const bad = polygonExtrude([{ x: 0, y: 0 }, { x: 1, y: 0 }], 5);
    expect(() => writeExtrudePolygonAsStep(bad)).toThrow(/at least 3 points/);
  });

  it('throws on non-positive depth', () => {
    expect(() =>
      writeExtrudePolygonAsStep(polygonExtrude(triangleLoop(), 0)),
    ).toThrow(/depth must be positive/);
  });

  it('rejects non-extrude features', () => {
    const bogus = { kind: 'revolve' } as unknown as ExtrudeFeature;
    expect(() => writeExtrudePolygonAsStep(bogus)).toThrow(/expected kind='extrude'/);
  });
});

// ─── backward-compat — BOX writer unchanged ──────────────────────────────

describe('backward-compat — writeExtrudeAsStep still BOX-only', () => {
  it('still emits exactly 6 ADVANCED_FACE entries for a rectangle', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    expect(count(out, /ADVANCED_FACE\(/g)).toBe(6);
  });

  it('still flattens a triangle to its bounding box (6 faces)', () => {
    const out = writeExtrudeAsStep(polygonExtrude(triangleLoop(), 4));
    expect(count(out, /ADVANCED_FACE\(/g)).toBe(6);
  });
});

// ─── assembly with mixed parts ────────────────────────────────────────────

describe('writeAssemblyAsStep — mixed rect + polygon parts', () => {
  function mixedAsm(): AssemblyStepInput {
    return {
      assemblyName: 'mixed-asm',
      parts: [
        { id: 'box-a', name: 'box-a', x0: 0, y0: 0, z0: 0, x1: 10, y1: 10, z1: 5 },
        { kind: 'polygon', id: 'tri-b', name: 'tri-b', loop: triangleLoop(), depth: 4 },
        { kind: 'polygon', id: 'hex-c', name: 'hex-c', loop: hexagonLoop(), depth: 3 },
      ],
    };
  }

  it('produces a complete STEP file', () => {
    const out = writeAssemblyAsStep(mixedAsm());
    expect(out.startsWith('ISO-10303-21;')).toBe(true);
    expect(out.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('emits MANIFOLD_SOLID_BREP per part (3 parts → 3 solids)', () => {
    const out = writeAssemblyAsStep(mixedAsm());
    expect(count(out, /MANIFOLD_SOLID_BREP/g)).toBe(3);
  });

  it('total ADVANCED_FACE = 6 (box) + 5 (tri) + 8 (hex) = 19', () => {
    const out = writeAssemblyAsStep(mixedAsm());
    expect(count(out, /ADVANCED_FACE\(/g)).toBe(19);
  });

  it('total VERTEX_POINT = 8 (box) + 6 (tri) + 12 (hex) = 26', () => {
    const out = writeAssemblyAsStep(mixedAsm());
    expect(count(out, /VERTEX_POINT\(/g)).toBe(26);
  });

  it('one NAUO per part regardless of geometry kind', () => {
    const out = writeAssemblyAsStep(mixedAsm());
    expect(count(out, /NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g)).toBe(3);
  });

  it('every #N reference resolves to a defined entity', () => {
    const out = writeAssemblyAsStep(mixedAsm());
    const defined = new Set<number>();
    for (const m of out.matchAll(/^#(\d+)=/gm)) defined.add(Number(m[1]));
    const dataSection = out.slice(out.indexOf('DATA;'));
    for (const m of dataSection.matchAll(/#(\d+)/g)) {
      expect(defined.has(Number(m[1]))).toBe(true);
    }
  });
});

describe('writeAssemblyAsStep — polygon part fallback', () => {
  it('falls back to bbox for a concave polygon part and invokes onFallback', () => {
    const onFallback = vi.fn();
    const out = writeAssemblyAsStep(
      {
        assemblyName: 'fallback-asm',
        parts: [
          { kind: 'polygon', id: 'L', name: 'L', loop: concaveLLoop(), depth: 5 },
        ],
      },
      { onFallback },
    );
    expect(count(out, /ADVANCED_FACE\(/g)).toBe(6); // bbox
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]?.[0]?.partId).toBe('L');
    expect(onFallback.mock.calls[0]?.[0]?.reason).toBe('concave');
  });

  it('throws if a polygon part has < 3 vertices', () => {
    expect(() =>
      writeAssemblyAsStep({
        assemblyName: 'bad',
        parts: [
          { kind: 'polygon', id: 'p', name: 'p', loop: [{ x: 0, y: 0 }, { x: 1, y: 1 }], depth: 1 },
        ],
      }),
    ).toThrow(/≥ 3 points/);
  });

  it('throws if a polygon part has non-positive depth', () => {
    expect(() =>
      writeAssemblyAsStep({
        assemblyName: 'bad',
        parts: [
          { kind: 'polygon', id: 'p', name: 'p', loop: triangleLoop(), depth: 0 },
        ],
      }),
    ).toThrow(/depth must be positive/);
  });

  it('throws for a degenerate (collinear) polygon part rather than falling back', () => {
    expect(() =>
      writeAssemblyAsStep({
        assemblyName: 'bad',
        parts: [
          {
            kind: 'polygon',
            id: 'p',
            name: 'p',
            loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
            depth: 5,
          },
        ],
      }),
    ).toThrow(/degenerate/);
  });
});
