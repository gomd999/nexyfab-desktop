/**
 * Tests for sketchSvgExport — SVG serialization + browser download.
 *
 * These exercises lean on substring/regex assertions over the SVG string
 * rather than spinning up a DOM parser. The exporter writes a small,
 * predictable subset of SVG (no namespaces beyond default, no CSS, no
 * scripts) so string matching is reliable and the test stays fast.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  exportSketchToSvg,
  downloadSketchAsSvg,
  type SketchEntities,
  type SketchSvgOptions,
} from './sketchSvgExport';

const baseOpts: SketchSvgOptions = { width: 100, height: 100 };

const empty: SketchEntities = { points: [], lines: [], circles: [], arcs: [] };

describe('exportSketchToSvg — document scaffolding', () => {
  it('empty entities produces a valid, parseable SVG document', () => {
    const svg = exportSketchToSvg(empty, baseOpts);
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toMatch(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('</svg>');
    // No content elements when entities are empty.
    expect(svg).not.toContain('data-kind="point"');
    expect(svg).not.toContain('data-kind="line"');
  });

  it('emits mm units on width/height', () => {
    const svg = exportSketchToSvg(empty, { width: 297, height: 210 });
    expect(svg).toMatch(/width="297mm"/);
    expect(svg).toMatch(/height="210mm"/);
  });

  it('viewBox auto-fits content with margin padding', () => {
    const entities: SketchEntities = {
      points: [],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 10, y2: 20 },
      ],
      circles: [],
      arcs: [],
    };
    const svg = exportSketchToSvg(entities, { width: 100, height: 100, margin: 5 });
    // bbox = (0,0)-(10,20) padded by 5 → (-5,-5)-(15,25)
    expect(svg).toMatch(/viewBox="-5 -5 20 30"/);
  });

  it('includes <title> metadata when supplied', () => {
    const svg = exportSketchToSvg(empty, { ...baseOpts, title: 'Bracket A' });
    expect(svg).toContain('<title>Bracket A</title>');
  });

  it('escapes XML-unsafe characters in title', () => {
    const svg = exportSketchToSvg(empty, { ...baseOpts, title: 'A & <B>' });
    expect(svg).toContain('<title>A &amp; &lt;B&gt;</title>');
    expect(svg).not.toContain('<B>');
  });

  it('emits generator metadata + descriptive <desc>', () => {
    const svg = exportSketchToSvg(empty, baseOpts);
    expect(svg).toContain('<metadata>generator=NexyFab sketchSvgExport v1</metadata>');
    expect(svg).toMatch(/<desc>[^<]*NexyFab sketchSvgExport/);
  });
});

describe('exportSketchToSvg — Y-axis flip', () => {
  it('wraps content in transform="translate ... scale(1 -1)"', () => {
    const svg = exportSketchToSvg(empty, baseOpts);
    expect(svg).toMatch(/<g transform="translate\([^)]*\) scale\(1 -1\)">/);
  });

  it('Y-flip translation matches (minY + maxY) of bbox', () => {
    // bbox of single point (0, 10) padded by margin=2 → (-2,8)-(2,12)
    // minY+maxY = 8 + 12 = 20
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0, y: 10 }],
      lines: [],
      circles: [],
      arcs: [],
    };
    const svg = exportSketchToSvg(entities, { width: 50, height: 50, margin: 2 });
    expect(svg).toMatch(/translate\(0 20\) scale\(1 -1\)/);
  });
});

describe('exportSketchToSvg — points', () => {
  it('renders a point as <circle cx cy r fill>', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 5, y: 7 }],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    expect(svg).toMatch(/<circle[^>]*data-kind="point"[^>]*cx="5"[^>]*cy="7"[^>]*fill="black"/);
  });

  it('renders a fixed point with red fill', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0, y: 0, isFixed: true }],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    expect(svg).toMatch(/<circle[^>]*data-kind="point"[^>]*fill="red"/);
  });

  it('tags each point with its sketch id', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p42', x: 0, y: 0 }],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    expect(svg).toMatch(/data-sketch-id="p42"[^>]*data-kind="point"/);
  });
});

describe('exportSketchToSvg — lines', () => {
  it('renders a line as <line x1 y1 x2 y2 stroke>', () => {
    const entities: SketchEntities = {
      points: [],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 1, y1: 2, x2: 3, y2: 4 }],
      circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    expect(svg).toMatch(
      /<line[^>]*data-kind="line"[^>]*x1="1"[^>]*y1="2"[^>]*x2="3"[^>]*y2="4"/,
    );
    expect(svg).toMatch(/stroke="black"/);
  });

  it('respects custom stroke-width', () => {
    const entities: SketchEntities = {
      points: [],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 1, y2: 0 }],
      circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, { ...baseOpts, strokeWidth: 0.5 });
    expect(svg).toMatch(/stroke-width="0\.5"/);
  });
});

describe('exportSketchToSvg — circles', () => {
  it('renders a circle as <circle cx cy r fill="none" stroke>', () => {
    const entities: SketchEntities = {
      points: [],
      lines: [],
      circles: [{ id: 'c1', cx: 5, cy: 5, radius: 3 }],
      arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    expect(svg).toMatch(
      /<circle[^>]*data-kind="circle"[^>]*cx="5"[^>]*cy="5"[^>]*r="3"[^>]*fill="none"[^>]*stroke="black"/,
    );
  });
});

describe('exportSketchToSvg — arcs', () => {
  it('renders an arc as <path d="M ... A ...">', () => {
    const entities: SketchEntities = {
      points: [],
      lines: [],
      circles: [],
      arcs: [
        { id: 'a1', cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2 },
      ],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    expect(svg).toMatch(/<path[^>]*data-kind="arc"[^>]*d="M[^"]*A[^"]*"/);
  });

  it('arc endpoints computed from polar coordinates', () => {
    // startAngle=0 → start at (cx+r, cy) = (10, 0)
    // endAngle=π/2 → end at (cx, cy+r) = (0, 10)
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [
        { id: 'a1', cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2 },
      ],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    // M 10 0 A 10 10 0 0 0 0 10  (large=0 since π/2 ≤ π, sweep=0 since CCW)
    expect(svg).toMatch(/d="M 10 0 A 10 10 0 0 0 0 10"/);
  });

  it('large-arc-flag = 1 when sweep > π', () => {
    // startAngle=0 → endAngle=3π/2 is a 270° sweep
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [
        { id: 'a1', cx: 0, cy: 0, radius: 1, startAngle: 0, endAngle: (3 * Math.PI) / 2 },
      ],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    // Pattern: A 1 1 0 <large> <sweep> ...
    expect(svg).toMatch(/A 1 1 0 1 0 /);
  });

  it('sweep-flag inverted for CW (negative delta) arcs', () => {
    // CCW from 0 → π/2 gives sweep=0 (verified above).
    // CW from π/2 → 0 (delta = -π/2) gives sweep=1.
    const entities: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [
        { id: 'a1', cx: 0, cy: 0, radius: 1, startAngle: Math.PI / 2, endAngle: 0 },
      ],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    expect(svg).toMatch(/A 1 1 0 0 1 /);
  });
});

describe('exportSketchToSvg — mixed entities', () => {
  it('renders points, lines, circles, and arcs together', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 5, y2: 0 }],
      circles: [{ id: 'c1', cx: 10, cy: 0, radius: 2 }],
      arcs: [{ id: 'a1', cx: 0, cy: 5, radius: 2, startAngle: 0, endAngle: Math.PI }],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    expect(svg).toContain('data-kind="point"');
    expect(svg).toContain('data-kind="line"');
    expect(svg).toContain('data-kind="circle"');
    expect(svg).toContain('data-kind="arc"');
  });

  it('viewBox expands to enclose every entity type', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: -100, y: 0 }],
      lines: [],
      circles: [{ id: 'c1', cx: 50, cy: 50, radius: 50 }],
      arcs: [],
    };
    const svg = exportSketchToSvg(entities, { width: 200, height: 200, margin: 0 });
    // x ∈ [-100, 100], y ∈ [0, 100] → viewBox = -100 0 200 100
    expect(svg).toMatch(/viewBox="-100 0 200 100"/);
  });
});

describe('exportSketchToSvg — grid option', () => {
  it('omits grid when showGrid is false (default)', () => {
    const svg = exportSketchToSvg(empty, baseOpts);
    expect(svg).not.toContain('data-kind="grid"');
  });

  it('emits grid <g> when showGrid is true', () => {
    const svg = exportSketchToSvg(empty, { ...baseOpts, showGrid: true });
    expect(svg).toContain('<g data-kind="grid"');
  });
});

describe('downloadSketchAsSvg', () => {
  let createUrlSpy: ReturnType<typeof vi.fn>;
  let revokeUrlSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Build a minimal DOM stub. Vitest's default env here is 'node', so
    // window/document/URL don't exist out of the box — we install just
    // enough to let the function run end-to-end.
    createUrlSpy = vi.fn(() => 'blob:mock-url-1');
    revokeUrlSpy = vi.fn();

    const anchorBag: { href: string; download: string; style: { display: string }; click: () => void } = {
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
    downloadSketchAsSvg(empty, 'sketch.svg', baseOpts);
    expect(createUrlSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('appends .svg extension when missing from filename', () => {
    let capturedDownload = '';
    const doc = {
      createElement: vi.fn(() => {
        const a = {
          href: '',
          download: '',
          style: { display: '' },
          click: vi.fn(),
          set _download(v: string) { capturedDownload = v; },
        };
        // Use a getter/setter via Object.defineProperty so assignments
        // route through our capture without breaking the normal API.
        Object.defineProperty(a, 'download', {
          get() { return capturedDownload; },
          set(v: string) { capturedDownload = v; },
        });
        return a;
      }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    };
    vi.stubGlobal('document', doc);
    downloadSketchAsSvg(empty, 'my-sketch', baseOpts);
    expect(capturedDownload).toBe('my-sketch.svg');
  });

  it('throws when called outside a DOM environment', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    expect(() => downloadSketchAsSvg(empty, 'x.svg', baseOpts)).toThrow(/browser/);
  });
});

describe('exportSketchToSvg — edge cases', () => {
  it('formats negative-zero as 0 to keep diffs stable', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: -0, y: -0 }],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    expect(svg).not.toContain('cx="-0"');
    expect(svg).toMatch(/cx="0"/);
  });

  it('rounds long-decimal coordinates to 6 decimal places', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0.1 + 0.2, y: 0 }],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    // 0.1 + 0.2 = 0.30000000000000004 → rounded to 0.3
    expect(svg).toMatch(/cx="0\.3"/);
  });

  it('preserves entity ordering: circles, then arcs, then lines, then points', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 1, y2: 0 }],
      circles: [{ id: 'c1', cx: 0, cy: 0, radius: 1 }],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 2, startAngle: 0, endAngle: 1 }],
    };
    const svg = exportSketchToSvg(entities, baseOpts);
    const idxCircle = svg.indexOf('data-kind="circle"');
    const idxArc = svg.indexOf('data-kind="arc"');
    const idxLine = svg.indexOf('data-kind="line"');
    const idxPoint = svg.indexOf('data-kind="point"');
    expect(idxCircle).toBeGreaterThan(-1);
    expect(idxCircle).toBeLessThan(idxArc);
    expect(idxArc).toBeLessThan(idxLine);
    expect(idxLine).toBeLessThan(idxPoint);
  });

  it('default margin is 10mm when not supplied', () => {
    const entities: SketchEntities = {
      points: [{ id: 'p1', x: 0, y: 0 }],
      lines: [], circles: [], arcs: [],
    };
    const svg = exportSketchToSvg(entities, { width: 50, height: 50 });
    // bbox of single point (0,0) padded by default 10 → (-10,-10)-(10,10)
    expect(svg).toMatch(/viewBox="-10 -10 20 20"/);
  });
});
