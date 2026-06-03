/**
 * sheetSnap — drawing sheet snap target detection tests.
 *
 * Phase 4.7 of NexyFab Pro own-CAD (ADR-013).
 *
 * Validates:
 *   - grid rounding on the sheet
 *   - viewport corner / midpoint / center proximity
 *   - distance threshold cutoff
 *   - priority ordering on distance ties
 *   - toggle flags (enableGrid / enableViewport)
 *   - default option fallbacks
 *
 * Viewport box convention (matches `viewportSheetBox` in dxfExport.ts):
 *   - center  = vp.centerOnSheet
 *   - width   = vp.widthOnSheet
 *   - height  = vp.widthOnSheet * 0.75  (4:3 placeholder aspect)
 *
 * Most fixtures use a single viewport with width 100 → halfW=50, halfH=37.5
 * centered at (150, 100). That yields corners at:
 *   BL (100,  62.5), BR (200,  62.5), TR (200, 137.5), TL (100, 137.5)
 * midpoints at:
 *   bot (150, 62.5), right (200, 100), top (150, 137.5), left (100, 100)
 * center: (150, 100).
 */

import { describe, it, expect } from 'vitest';
import { findSheetSnapTarget, viewportBoxCorners } from './sheetSnap';
import type { Sheet, Viewport } from './sheet';

// ─── fixtures ─────────────────────────────────────────────────────────────

function makeViewport(id: string, cx: number, cy: number, width = 100): Viewport {
  return {
    id,
    sourceId: 'src',
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: cx, y: cy },
    widthOnSheet: width,
    scale: 1,
  };
}

function makeSheet(viewports: Viewport[]): Sheet {
  return {
    id: 's1',
    name: 'Test',
    paperSize: 'A3',
    viewports,
  };
}

const EMPTY_SHEET = makeSheet([]);
const SINGLE_VP_SHEET = makeSheet([makeViewport('v1', 150, 100, 100)]);
// width 100 → halfW=50, halfH=37.5
// corners: BL(100,62.5) BR(200,62.5) TR(200,137.5) TL(100,137.5)
// midpts:  bot(150,62.5) right(200,100) top(150,137.5) left(100,100)
// center:  (150,100)

// ─── viewportBoxCorners helper ───────────────────────────────────────────

describe('viewportBoxCorners', () => {
  it('returns 4 corners CCW from bottom-left with 4:3 aspect', () => {
    const vp = makeViewport('v', 150, 100, 100);
    const box = viewportBoxCorners(vp);
    expect(box.corners).toEqual([
      { x: 100, y: 62.5 },
      { x: 200, y: 62.5 },
      { x: 200, y: 137.5 },
      { x: 100, y: 137.5 },
    ]);
  });

  it('returns 4 edge midpoints (bot, right, top, left)', () => {
    const vp = makeViewport('v', 150, 100, 100);
    const box = viewportBoxCorners(vp);
    expect(box.midpoints).toEqual([
      { x: 150, y: 62.5 },
      { x: 200, y: 100 },
      { x: 150, y: 137.5 },
      { x: 100, y: 100 },
    ]);
  });

  it('returns center matching centerOnSheet', () => {
    const vp = makeViewport('v', 150, 100, 100);
    const box = viewportBoxCorners(vp);
    expect(box.center).toEqual({ x: 150, y: 100 });
  });
});

// ─── grid snap ────────────────────────────────────────────────────────────

describe('findSheetSnapTarget — grid', () => {
  it('empty sheet → grid candidate only', () => {
    const r = findSheetSnapTarget({ x: 3, y: 7 }, EMPTY_SHEET, { gridSpacing: 5 });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
    expect(r!.pos).toEqual({ x: 5, y: 5 });
  });

  it('rounds cursor (12, 13) with spacing 5 → (10, 15)', () => {
    const r = findSheetSnapTarget(
      { x: 12, y: 13 },
      EMPTY_SHEET,
      { gridSpacing: 5, pointRadius: 10 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
    expect(r!.pos).toEqual({ x: 10, y: 15 });
  });

  it('exact-on-grid cursor → distance 0', () => {
    const r = findSheetSnapTarget({ x: 10, y: 10 }, EMPTY_SHEET, { gridSpacing: 5 });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
    expect(r!.distance).toBeCloseTo(0, 6);
  });

  it('grid disabled + empty sheet → null', () => {
    const r = findSheetSnapTarget({ x: 3, y: 7 }, EMPTY_SHEET, { enableGrid: false });
    expect(r).toBeNull();
  });

  it('uses default gridSpacing 5 when not supplied', () => {
    const r = findSheetSnapTarget({ x: 1, y: 1 }, EMPTY_SHEET, {});
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
    expect(r!.pos).toEqual({ x: 0, y: 0 });
  });

  it('grid candidate beyond threshold is dropped', () => {
    // spacing 100, threshold 5 → nearest node (0,0) is 50/50 away from (50,50).
    const r = findSheetSnapTarget(
      { x: 50, y: 50 },
      EMPTY_SHEET,
      { gridSpacing: 100, pointRadius: 5 },
    );
    expect(r).toBeNull();
  });

  it('grid candidate carries no refId', () => {
    const r = findSheetSnapTarget({ x: 5, y: 5 }, EMPTY_SHEET, { gridSpacing: 5 });
    expect(r).not.toBeNull();
    expect(r!.refId).toBeUndefined();
  });
});

// ─── viewport snap ────────────────────────────────────────────────────────

describe('findSheetSnapTarget — viewport corner', () => {
  it('cursor near corner BL → viewport_corner', () => {
    // BL is (100, 62.5). Cursor at (101, 63).
    const r = findSheetSnapTarget(
      { x: 101, y: 63 },
      SINGLE_VP_SHEET,
      { enableGrid: false, pointRadius: 5 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_corner');
    expect(r!.refId).toBe('v1');
    expect(r!.pos).toEqual({ x: 100, y: 62.5 });
  });

  it('cursor near corner TR → viewport_corner', () => {
    // TR is (200, 137.5).
    const r = findSheetSnapTarget(
      { x: 199, y: 138 },
      SINGLE_VP_SHEET,
      { enableGrid: false, pointRadius: 5 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_corner');
    expect(r!.pos).toEqual({ x: 200, y: 137.5 });
  });
});

describe('findSheetSnapTarget — viewport midpoint', () => {
  it('cursor near bottom edge midpoint → viewport_midpoint', () => {
    // bottom mid is (150, 62.5).
    const r = findSheetSnapTarget(
      { x: 151, y: 63 },
      SINGLE_VP_SHEET,
      { enableGrid: false, pointRadius: 5 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_midpoint');
    expect(r!.refId).toBe('v1');
    expect(r!.pos).toEqual({ x: 150, y: 62.5 });
  });

  it('cursor near left edge midpoint → viewport_midpoint', () => {
    // left mid is (100, 100).
    const r = findSheetSnapTarget(
      { x: 101, y: 99 },
      SINGLE_VP_SHEET,
      { enableGrid: false, pointRadius: 5 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_midpoint');
    expect(r!.pos).toEqual({ x: 100, y: 100 });
  });
});

describe('findSheetSnapTarget — viewport center', () => {
  it('cursor near viewport center → viewport_center', () => {
    // center is (150, 100). Cursor at (151, 101).
    const r = findSheetSnapTarget(
      { x: 151, y: 101 },
      SINGLE_VP_SHEET,
      { enableGrid: false, pointRadius: 5 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_center');
    expect(r!.refId).toBe('v1');
    expect(r!.pos).toEqual({ x: 150, y: 100 });
  });

  it('exact-on-center cursor → distance 0', () => {
    const r = findSheetSnapTarget(
      { x: 150, y: 100 },
      SINGLE_VP_SHEET,
      { enableGrid: false },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_center');
    expect(r!.distance).toBeCloseTo(0, 6);
  });
});

describe('findSheetSnapTarget — viewport coverage', () => {
  it('single viewport exposes 9 distinct snap points (4 corner + 4 mid + 1 center)', () => {
    // Probe each of the 9 expected sites and confirm the right kind comes back.
    const probes: Array<{ at: { x: number; y: number }; expect: string; pos: { x: number; y: number } }> = [
      { at: { x: 100, y: 62.5 },  expect: 'viewport_corner',   pos: { x: 100, y: 62.5 } },
      { at: { x: 200, y: 62.5 },  expect: 'viewport_corner',   pos: { x: 200, y: 62.5 } },
      { at: { x: 200, y: 137.5 }, expect: 'viewport_corner',   pos: { x: 200, y: 137.5 } },
      { at: { x: 100, y: 137.5 }, expect: 'viewport_corner',   pos: { x: 100, y: 137.5 } },
      { at: { x: 150, y: 62.5 },  expect: 'viewport_midpoint', pos: { x: 150, y: 62.5 } },
      { at: { x: 200, y: 100 },   expect: 'viewport_midpoint', pos: { x: 200, y: 100 } },
      { at: { x: 150, y: 137.5 }, expect: 'viewport_midpoint', pos: { x: 150, y: 137.5 } },
      { at: { x: 100, y: 100 },   expect: 'viewport_midpoint', pos: { x: 100, y: 100 } },
      { at: { x: 150, y: 100 },   expect: 'viewport_center',   pos: { x: 150, y: 100 } },
    ];
    for (const p of probes) {
      const r = findSheetSnapTarget(p.at, SINGLE_VP_SHEET, { enableGrid: false, pointRadius: 1 });
      expect(r, `probe at ${p.at.x},${p.at.y}`).not.toBeNull();
      expect(r!.kind, `probe at ${p.at.x},${p.at.y}`).toBe(p.expect);
      expect(r!.pos, `probe at ${p.at.x},${p.at.y}`).toEqual(p.pos);
    }
  });

  it('viewport disabled → no viewport candidates emitted', () => {
    // Sit exactly on a corner; with viewport off and grid off → null.
    const r = findSheetSnapTarget(
      { x: 100, y: 62.5 },
      SINGLE_VP_SHEET,
      { enableViewport: false, enableGrid: false },
    );
    expect(r).toBeNull();
  });
});

// ─── priority + threshold ────────────────────────────────────────────────

describe('findSheetSnapTarget — priority', () => {
  it('grid + viewport both enabled, cursor on corner → viewport_corner wins (closer)', () => {
    // BL corner (100, 62.5). Grid spacing 5 → nearest node (100, 65), dist 2.5.
    // Corner distance is 0, so corner wins on distance alone.
    const r = findSheetSnapTarget(
      { x: 100, y: 62.5 },
      SINGLE_VP_SHEET,
      { gridSpacing: 5, pointRadius: 5 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_corner');
    expect(r!.distance).toBeCloseTo(0, 6);
  });

  it('priority: corner < midpoint on distance tie', () => {
    // Construct a viewport where one corner and one midpoint of a SECOND
    // viewport coincide. Easiest path: make 2 viewports such that
    // viewport A's corner and viewport B's midpoint share a sheet point
    // equidistant to the cursor.
    //
    // VP_a centered at (150, 100), width 100  → BR corner = (200, 62.5)
    // VP_b centered at (250, 62.5), width 100 → left-edge midpt = (200, 62.5)
    // (VP_b: halfW=50, halfH=37.5 → minX=200, cy=62.5 → left mid = (200, 62.5))
    const sheet = makeSheet([
      makeViewport('a', 150, 100, 100),
      makeViewport('b', 250, 62.5, 100),
    ]);
    // Cursor at (200, 62.5) → distance 0 to both candidates → tie.
    const r = findSheetSnapTarget(
      { x: 200, y: 62.5 },
      sheet,
      { enableGrid: false, pointRadius: 1 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_corner');
  });

  it('priority: midpoint < center on distance tie', () => {
    // VP_a's right-edge midpoint at (200, 100). VP_b centered at (200, 100).
    const sheet = makeSheet([
      makeViewport('a', 150, 100, 100),
      makeViewport('b', 200, 100, 100),
    ]);
    const r = findSheetSnapTarget(
      { x: 200, y: 100 },
      sheet,
      { enableGrid: false, pointRadius: 1 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_midpoint');
  });

  it('priority: center < grid on distance tie', () => {
    // VP centered at (150, 100). Grid spacing 5 → (150, 100) is itself a grid node.
    // Cursor exactly on (150, 100) → both candidates distance 0; center wins.
    const r = findSheetSnapTarget(
      { x: 150, y: 100 },
      SINGLE_VP_SHEET,
      { gridSpacing: 5, pointRadius: 1 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_center');
  });

  it('closer grid beats farther viewport corner', () => {
    // Cursor at (10, 10) — far from any viewport corner. Grid node at (10, 10).
    const r = findSheetSnapTarget(
      { x: 10, y: 10 },
      SINGLE_VP_SHEET,
      { gridSpacing: 5, pointRadius: 5 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
  });

  it('closer corner beats farther midpoint when both are within threshold', () => {
    // BL corner (100, 62.5). Bottom mid (150, 62.5). Cursor at (101, 62.5).
    // Distance to corner = 1, distance to midpoint = 49. Corner wins on
    // distance regardless of priority.
    const r = findSheetSnapTarget(
      { x: 101, y: 62.5 },
      SINGLE_VP_SHEET,
      { enableGrid: false, pointRadius: 100 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_corner');
    expect(r!.distance).toBeCloseTo(1, 6);
  });
});

describe('findSheetSnapTarget — threshold cutoff', () => {
  it('cursor far from any candidate (viewport off, grid off) → null', () => {
    const r = findSheetSnapTarget(
      { x: 500, y: 500 },
      SINGLE_VP_SHEET,
      { enableViewport: false, enableGrid: false },
    );
    expect(r).toBeNull();
  });

  it('cursor outside viewport threshold but inside grid threshold → grid', () => {
    // Cursor at (10, 10). VP corners are far away. Grid at (10, 10).
    const r = findSheetSnapTarget(
      { x: 10, y: 10 },
      SINGLE_VP_SHEET,
      { gridSpacing: 5, pointRadius: 2 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('grid');
  });

  it('cursor exactly at threshold from corner → still snaps', () => {
    // BL corner (100, 62.5). Cursor at (105, 62.5) → distance 5.
    const r = findSheetSnapTarget(
      { x: 105, y: 62.5 },
      SINGLE_VP_SHEET,
      { enableGrid: false, pointRadius: 5 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_corner');
    expect(r!.distance).toBeCloseTo(5, 6);
  });

  it('cursor just past threshold from corner → no viewport snap', () => {
    // BL corner (100, 62.5). Cursor at (106, 62.5) → distance 6 > threshold 5.
    // Grid disabled → null.
    const r = findSheetSnapTarget(
      { x: 106, y: 62.5 },
      SINGLE_VP_SHEET,
      { enableGrid: false, pointRadius: 5 },
    );
    expect(r).toBeNull();
  });
});

// ─── multi-viewport ──────────────────────────────────────────────────────

describe('findSheetSnapTarget — multi-viewport', () => {
  it('picks the nearest viewport corner across multiple viewports', () => {
    const sheet = makeSheet([
      makeViewport('a', 150, 100, 100), // BL = (100, 62.5)
      makeViewport('b', 300, 200, 100), // BL = (250, 162.5)
    ]);
    // Cursor at (251, 162.5) — clearly closer to b's BL corner.
    const r = findSheetSnapTarget(
      { x: 251, y: 162.5 },
      sheet,
      { enableGrid: false, pointRadius: 5 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_corner');
    expect(r!.refId).toBe('b');
    expect(r!.pos).toEqual({ x: 250, y: 162.5 });
  });

  it('refId correctly identifies the source viewport for center snaps', () => {
    const sheet = makeSheet([
      makeViewport('a', 100, 100, 100),
      makeViewport('b', 300, 200, 100),
    ]);
    const r = findSheetSnapTarget(
      { x: 300, y: 200 },
      sheet,
      { enableGrid: false, pointRadius: 1 },
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_center');
    expect(r!.refId).toBe('b');
  });
});

// ─── option defaults ─────────────────────────────────────────────────────

describe('findSheetSnapTarget — defaults', () => {
  it('default options enable both grid and viewport', () => {
    // Empty options. Cursor at viewport center → should snap.
    const r = findSheetSnapTarget({ x: 150, y: 100 }, SINGLE_VP_SHEET);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_center');
  });

  it('default pointRadius is 5mm', () => {
    // BL corner (100, 62.5). Cursor exactly 5 mm away → must snap.
    const r = findSheetSnapTarget({ x: 105, y: 62.5 }, SINGLE_VP_SHEET, { enableGrid: false });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('viewport_corner');
  });

  it('zero gridSpacing disables grid even with enableGrid true', () => {
    const r = findSheetSnapTarget(
      { x: 3, y: 7 },
      EMPTY_SHEET,
      { gridSpacing: 0, enableGrid: true },
    );
    expect(r).toBeNull();
  });
});
