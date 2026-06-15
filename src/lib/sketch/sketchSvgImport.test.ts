/**
 * Tests for sketchSvgImport — SVG → SketchEntities parsing + export round-trip.
 *
 * Mirrors the structure of sketchSvgExport.test.ts: each public-facing
 * behavior gets a small focused case, plus a handful of end-to-end
 * round-trip exercises that pin down the contract with the exporter.
 */
import { describe, it, expect } from 'vitest';
import { importSketchFromSvg } from './sketchSvgImport';
import {
  exportSketchToSvg,
  type SketchEntities,
  type SketchSvgOptions,
} from './sketchSvgExport';

const baseOpts: SketchSvgOptions = { width: 100, height: 100 };

const empty: SketchEntities = { points: [], lines: [], circles: [], arcs: [] };

/** Small helper: round a number to 4 decimals so floating noise from atan2
 *  reconstruction doesn't make round-trip assertions fragile. Normalizes
 *  -0 to +0 so `toBe(0)` Object.is-equality doesn't fail spuriously. */
const r4 = (n: number): number => {
  const v = Math.round(n * 1e4) / 1e4;
  return Object.is(v, -0) ? 0 : v;
};

describe('importSketchFromSvg — input validation', () => {
  it('rejects empty input', () => {
    const r = importSketchFromSvg('');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/);
    expect(r.entities).toBeUndefined();
  });

  it('rejects whitespace-only input', () => {
    const r = importSketchFromSvg('   \n\t  ');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/);
  });

  it('rejects non-SVG content', () => {
    const r = importSketchFromSvg('<html><body>not svg</body></html>');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no <svg>/);
  });

  it('rejects unterminated <svg>', () => {
    const r = importSketchFromSvg('<svg xmlns="http://www.w3.org/2000/svg">');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unterminated/);
  });
});

describe('importSketchFromSvg — empty document', () => {
  it('export(empty) → import returns empty entities', () => {
    const svg = exportSketchToSvg(empty, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities).toEqual(empty);
  });
});

describe('importSketchFromSvg — points (circle r=1 heuristic)', () => {
  it('round-trips a single unfixed point', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 5, y: 7 }],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(1);
    expect(r.entities?.points[0]).toMatchObject({ id: 'p1', x: 5, y: 7 });
    expect(r.entities?.points[0].isFixed).toBeUndefined();
  });

  it('round-trips a fixed point (red fill ⇒ isFixed:true)', () => {
    const entities: SketchEntities = {
      points: [{ id: 'pF', x: 0, y: 0, isFixed: true }],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.points[0].isFixed).toBe(true);
  });

  it('preserves data-sketch-id on points', () => {
    const entities: SketchEntities = {
      points: [{ id: 'point-42', x: 3, y: 4 }],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.entities?.points[0].id).toBe('point-42');
  });
});

describe('importSketchFromSvg — lines', () => {
  it('round-trips a single line', () => {
    const entities: SketchEntities = {
      points: [],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 1, y1: 2, x2: 3, y2: 4 }],
      circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.lines).toHaveLength(1);
    expect(r.entities?.lines[0]).toMatchObject({
      id: 'l1', x1: 1, y1: 2, x2: 3, y2: 4,
    });
  });

  it('grid lines (stroke=#e5e5ea) are filtered out', () => {
    const svg = exportSketchToSvg(empty, { ...baseOpts, showGrid: true });
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.lines).toEqual([]);
  });
});

describe('importSketchFromSvg — circles', () => {
  it('round-trips a single circle (r > 1)', () => {
    const entities: SketchEntities = {
      points: [],
      lines: [],
      circles: [{ id: 'c1', cx: 5, cy: 5, radius: 3 }],
      arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.circles).toHaveLength(1);
    expect(r.entities?.circles[0]).toMatchObject({ id: 'c1', cx: 5, cy: 5, radius: 3 });
    expect(r.entities?.points).toEqual([]);
  });

  it('hand-rolled SVG circle with r=2 parses as circle, not point', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="2"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.circles).toHaveLength(1);
    expect(r.entities?.points).toEqual([]);
  });

  it('hand-rolled circle with r=1 (no data-kind) parses as point', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="1"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.entities?.points).toHaveLength(1);
    expect(r.entities?.circles).toEqual([]);
  });
});

describe('importSketchFromSvg — arcs', () => {
  it('round-trips a quarter arc (CCW)', () => {
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2 }],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.arcs).toHaveLength(1);
    const a = r.entities!.arcs[0];
    expect(r4(a.cx)).toBe(0);
    expect(r4(a.cy)).toBe(0);
    expect(r4(a.radius)).toBe(10);
    expect(r4(a.startAngle)).toBe(0);
    expect(r4(a.endAngle)).toBe(r4(Math.PI / 2));
  });

  it('round-trips a CW arc (negative delta) — sweep flag inverted', () => {
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 5, startAngle: Math.PI / 2, endAngle: 0 }],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    const a = r.entities!.arcs[0];
    expect(r4(a.cx)).toBe(0);
    expect(r4(a.cy)).toBe(0);
    expect(r4(a.radius)).toBe(5);
    // start/end may be reported as equivalent wrapped angles — assert via
    // endpoint positions rather than raw radians.
    const sx = a.cx + a.radius * Math.cos(a.startAngle);
    const sy = a.cy + a.radius * Math.sin(a.startAngle);
    const ex = a.cx + a.radius * Math.cos(a.endAngle);
    const ey = a.cy + a.radius * Math.sin(a.endAngle);
    expect(r4(sx)).toBe(0);
    expect(r4(sy)).toBe(5);
    expect(r4(ex)).toBe(5);
    expect(r4(ey)).toBe(0);
  });

  it('round-trips a large arc (>180°)', () => {
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 4, startAngle: 0, endAngle: (3 * Math.PI) / 2 }],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    const a = r.entities!.arcs[0];
    expect(r4(a.cx)).toBe(0);
    expect(r4(a.cy)).toBe(0);
    expect(r4(a.radius)).toBe(4);
    // Endpoints should match original geometry.
    const sx = a.cx + a.radius * Math.cos(a.startAngle);
    const sy = a.cy + a.radius * Math.sin(a.startAngle);
    const ex = a.cx + a.radius * Math.cos(a.endAngle);
    const ey = a.cy + a.radius * Math.sin(a.endAngle);
    expect(r4(sx)).toBe(4);
    expect(r4(sy)).toBe(0);
    expect(r4(ex)).toBe(0);
    expect(r4(ey)).toBe(-4);
  });

  it('round-trips an arc with non-origin center', () => {
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [{ id: 'a1', cx: 7, cy: 3, radius: 2, startAngle: 0, endAngle: Math.PI / 2 }],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    const a = r.entities!.arcs[0];
    expect(r4(a.cx)).toBe(7);
    expect(r4(a.cy)).toBe(3);
    expect(r4(a.radius)).toBe(2);
  });

  it('skips bezier path with warning', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 C 10 0 10 10 0 10"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.arcs).toEqual([]);
    expect(r.warnings.some((w) => /unsupported path/.test(w))).toBe(true);
  });

  it('skips path with missing d', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><path stroke="black"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /missing d/.test(w))).toBe(true);
  });
});

describe('importSketchFromSvg — mixed entities', () => {
  it('round-trips a mixed sketch (point + line + circle + arc)', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 5, y2: 0 }],
      circles: [{ id: 'c1', cx: 10, cy: 0, radius: 2 }],
      arcs: [{ id: 'a1', cx: 0, cy: 5, radius: 2, startAngle: 0, endAngle: Math.PI }],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(1);
    expect(r.entities?.lines).toHaveLength(1);
    expect(r.entities?.circles).toHaveLength(1);
    expect(r.entities?.arcs).toHaveLength(1);
    // Sample one coord from each kind.
    expect(r.entities?.lines[0]).toMatchObject({ x1: 0, y1: 0, x2: 5, y2: 0 });
    expect(r.entities?.circles[0]).toMatchObject({ cx: 10, cy: 0, radius: 2 });
  });
});

describe('importSketchFromSvg — unsupported elements warn', () => {
  it('warns on <text>', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="0">hi</text></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /<text>/.test(w))).toBe(true);
  });

  it('warns on <polygon> (Phase 2)', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><polygon points="0,0 1,0 1,1"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /<polygon>/.test(w))).toBe(true);
  });

  it('warns on <rect>', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.warnings.some((w) => /<rect>/.test(w))).toBe(true);
  });

  it('warns on <ellipse>', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><ellipse cx="0" cy="0" rx="5" ry="3"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.warnings.some((w) => /<ellipse>/.test(w))).toBe(true);
  });
});

describe('importSketchFromSvg — Y-axis handling', () => {
  it('warns when no scale(1 -1) wrapper is present', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="1"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.warnings.some((w) => /Y-flip/.test(w))).toBe(true);
  });

  it('no warning when exporter wrapper is present', () => {
    const svg = exportSketchToSvg(empty, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.warnings.some((w) => /Y-flip/.test(w))).toBe(false);
  });
});

describe('importSketchFromSvg — robustness', () => {
  it('tolerates single-quoted attributes', () => {
    const svg = `<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'><circle cx='1' cy='2' r='3'/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.circles[0]).toMatchObject({ cx: 1, cy: 2, radius: 3 });
  });

  it('strips XML comments before parsing', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><!-- a comment with <circle cx="99" cy="99" r="99"/> --><circle cx="1" cy="2" r="3"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    // The fake circle inside the comment must not be picked up.
    expect(r.entities?.circles).toHaveLength(1);
    expect(r.entities?.circles[0].cx).toBe(1);
  });

  it('skips circles with missing coordinates', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle r="3"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.circles).toEqual([]);
    expect(r.warnings.some((w) => /missing\/invalid cx\/cy\/r/.test(w))).toBe(true);
  });

  it('skips lines with missing coordinates', () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0"/></svg>`;
    const r = importSketchFromSvg(svg);
    expect(r.ok).toBe(true);
    expect(r.entities?.lines).toEqual([]);
    expect(r.warnings.some((w) => /missing\/invalid/.test(w))).toBe(true);
  });

  it('handles multiple points in one document', () => {
    const entities: SketchEntities = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 0 },
        { id: 'p3', x: 0, y: 10, isFixed: true },
      ],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    expect(r.entities?.points).toHaveLength(3);
    const fixedCount = r.entities!.points.filter((p) => p.isFixed === true).length;
    expect(fixedCount).toBe(1);
  });

  it('preserves coordinate sign through the flip', () => {
    const entities: SketchEntities = {
      points: [
        { id: 'pq1', x: -5, y: 5 },
        { id: 'pq2', x: 5, y: -5 },
      ],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const r = importSketchFromSvg(svg);
    const byId = Object.fromEntries(r.entities!.points.map((p) => [p.id, p]));
    expect(byId.pq1).toMatchObject({ x: -5, y: 5 });
    expect(byId.pq2).toMatchObject({ x: 5, y: -5 });
  });
});

describe('importSketchFromSvg — round-trip integrity', () => {
  it('export → import → export reproduces a deterministic SVG (mixed)', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 1, y: 2 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 5, y2: 5 }],
      circles: [{ id: 'c1', cx: 0, cy: 0, radius: 3 }],
      arcs: [{ id: 'a1', cx: 2, cy: 2, radius: 2, startAngle: 0, endAngle: Math.PI / 2 }],
    };
    const svg1 = exportSketchToSvg(entities, baseOpts);
    const imp = importSketchFromSvg(svg1);
    expect(imp.ok).toBe(true);
    // Re-exporting the parsed result should produce a structurally identical
    // SVG (numeric precision permitting). We compare the entity COUNTS and
    // key coordinate samples rather than byte-equality because arc angles
    // come back as atan2-wrapped values whose textual representation may
    // differ from the originals.
    expect(imp.entities?.points.length).toBe(entities.points.length);
    expect(imp.entities?.lines.length).toBe(entities.lines.length);
    expect(imp.entities?.circles.length).toBe(entities.circles.length);
    expect(imp.entities?.arcs.length).toBe(entities.arcs.length);
    // Second-cycle round-trip should converge — geometry on the second
    // import should equal geometry on the first import.
    const svg2 = exportSketchToSvg(imp.entities!, baseOpts);
    const imp2 = importSketchFromSvg(svg2);
    expect(imp2.entities?.points.map((p) => [r4(p.x), r4(p.y)]))
      .toEqual(imp.entities?.points.map((p) => [r4(p.x), r4(p.y)]));
    expect(imp2.entities?.circles.map((c) => [r4(c.cx), r4(c.cy), r4(c.radius)]))
      .toEqual(imp.entities?.circles.map((c) => [r4(c.cx), r4(c.cy), r4(c.radius)]));
  });
});
