import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  projectGeometry,
  generateAutoKeyDimensions,
  computeDrawingGeometryFingerprint,
  type ProjectionView,
} from './autoDrawing';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildDrawingSvgString } from './drawingExport';

function makeBox(w = 60, h = 40, d = 20): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  g.computeBoundingBox();
  return g;
}

describe('projectGeometry · view-direction sanity', () => {
  // For a centred box, the front projection should produce 2D extents
  // matching the box width × height (X × Y in world). Other views map
  // different axes — we sanity-check the bbox of the produced lines.
  function projectedBBox(view: ProjectionView, box = makeBox(60, 40, 20)) {
    const lines = projectGeometry(box, view, 1);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of lines) {
      minX = Math.min(minX, l.x1, l.x2);
      maxX = Math.max(maxX, l.x1, l.x2);
      minY = Math.min(minY, l.y1, l.y2);
      maxY = Math.max(maxY, l.y1, l.y2);
    }
    return { w: maxX - minX, h: maxY - minY };
  }

  it('front view shows world X × Y (60 × 40 box → 60 wide, 40 tall)', () => {
    const r = projectedBBox('front');
    expect(r.w).toBeCloseTo(60, 0);
    expect(r.h).toBeCloseTo(40, 0);
  });

  it('top view shows world X × Z (60 × 40 × 20 → 60 wide, 20 tall)', () => {
    const r = projectedBBox('top');
    expect(r.w).toBeCloseTo(60, 0);
    expect(r.h).toBeCloseTo(20, 0);
  });

  it('right view shows world Z × Y (60 × 40 × 20 → 20 wide, 40 tall)', () => {
    const r = projectedBBox('right');
    expect(r.w).toBeCloseTo(20, 0);
    expect(r.h).toBeCloseTo(40, 0);
  });

  it('produces non-empty output for all 7 view types', () => {
    const box = makeBox();
    const views: ProjectionView[] = ['front', 'top', 'right', 'left', 'back', 'bottom', 'iso'];
    for (const v of views) {
      const lines = projectGeometry(box, v, 1);
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  it('scale multiplier scales line coordinates linearly', () => {
    const box = makeBox(60, 40, 20);
    const at1 = projectGeometry(box, 'front', 1);
    const at2 = projectGeometry(box, 'front', 2);
    // Same number of lines, every coordinate doubled.
    expect(at2.length).toBe(at1.length);
    for (let i = 0; i < at1.length; i++) {
      expect(at2[i].x1).toBeCloseTo(at1[i].x1 * 2, 3);
      expect(at2[i].y1).toBeCloseTo(at1[i].y1 * 2, 3);
    }
  });

  it('returns empty for geometry without a position attribute', () => {
    const empty = new THREE.BufferGeometry();
    expect(projectGeometry(empty, 'front', 1)).toEqual([]);
  });
});

describe('projectGeometry · unwelded mesh weld (no triangulation artifacts)', () => {
  // An L-shaped profile extruded with THREE — like every primitive / Extrude /
  // boolean result the drawing pipeline actually feeds in — comes out UNWELDED
  // (each triangle owns its vertices). projectGeometry keys edges by vertex
  // index, so without an internal weld the front face's triangulation diagonals
  // survive as spurious "feature" lines. The clean L outline has exactly 6
  // edges; the face has 4 fan triangles → 3 interior diagonals that must NOT
  // appear. Front view also bounds 40 × 40.
  function lProfile(): THREE.BufferGeometry {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(40, 0); s.lineTo(40, 20); s.lineTo(20, 20);
    s.lineTo(20, 40); s.lineTo(0, 40); s.lineTo(0, 0);
    return new THREE.ExtrudeGeometry(s, { depth: 10, bevelEnabled: false });
  }
  const bbox = (lines: { x1: number; y1: number; x2: number; y2: number }[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of lines) {
      minX = Math.min(minX, l.x1, l.x2); maxX = Math.max(maxX, l.x1, l.x2);
      minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2);
    }
    return { w: maxX - minX, h: maxY - minY };
  };

  it('an unwelded L-extrusion front view is the clean 6-edge outline, not 9', () => {
    const lines = projectGeometry(lProfile(), 'front', 1);
    expect(lines.length).toBe(6);                 // 6 outline edges, 0 diagonals
    const b = bbox(lines);
    expect(b.w).toBeCloseTo(40, 3);
    expect(b.h).toBeCloseTo(40, 3);
  });

  it('is idempotent: pre-welding the same mesh yields the identical line count', () => {
    const raw = lProfile();
    const welded = mergeVertices(raw);
    expect(projectGeometry(welded, 'front', 1).length)
      .toBe(projectGeometry(raw, 'front', 1).length);
  });
});

describe('projectGeometry · true HLR opt-in (depth occlusion)', () => {
  it('a convex box is unchanged — no edge is falsely hidden by its own faces', () => {
    const box = makeBox(20, 30, 40);
    const def = projectGeometry(box, 'front', 1);
    const hlr = projectGeometry(box, 'front', 1, { trueHlr: true });
    // Same 4-edge silhouette, all visible either way (no self-occlusion).
    expect(hlr.filter(l => l.type === 'hidden')).toHaveLength(0);
    expect(hlr.filter(l => l.type === 'visible').length).toBe(def.filter(l => l.type === 'visible').length);
  });

  it('a box parked behind a larger box has its edges marked hidden', () => {
    // Front block 40×40×10 at the origin; a smaller block behind it at z=−30.
    const front = new THREE.BoxGeometry(40, 40, 10).toNonIndexed();
    const back = new THREE.BoxGeometry(20, 20, 10); back.translate(0, 0, -30);
    const backNI = back.toNonIndexed();
    const fa = front.getAttribute('position').array as Float32Array;
    const ba = backNI.getAttribute('position').array as Float32Array;
    const merged = new Float32Array(fa.length + ba.length);
    merged.set(fa, 0); merged.set(ba, fa.length);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(merged, 3));

    const hlr = projectGeometry(g, 'front', 1, { trueHlr: true });
    // The back block's silhouette is occluded → some hidden lines appear, which
    // the face-normal pass alone never produces here.
    expect(hlr.filter(l => l.type === 'hidden').length).toBeGreaterThan(0);
    expect(hlr.filter(l => l.type === 'visible').length).toBeGreaterThan(0);
  });
});

describe('generateAutoKeyDimensions · per-view dimension VALUES (verified)', () => {
  // The dimension TEXT must report the projected extents of THIS view, not a
  // fixed pair of world axes. For a 20(X) × 30(Y) × 40(Z) box: front sees X×Y,
  // top sees X×Z, right sees Z×Y, etc. Regression: width/height were hardcoded
  // to world X/Y, so a top view labeled its 40 mm depth as "30.0".
  const box = () => new THREE.BoxGeometry(20, 30, 40);
  const dimValues = (view: ProjectionView, scale = 1): [number, number] => {
    const { texts } = generateAutoKeyDimensions(box(), view, scale);
    return [parseFloat(texts[0].text), parseFloat(texts[1].text)];
  };

  it.each([
    ['front', 20, 30],
    ['top', 20, 40],
    ['right', 40, 30],
    ['left', 40, 30],
    ['bottom', 20, 40],
  ] as [ProjectionView, number, number][])(
    '%s view labels [W=%d, H=%d] matching its projected axes',
    (view, w, h) => {
      const [vw, vh] = dimValues(view);
      expect(vw).toBeCloseTo(w, 1);
      expect(vh).toBeCloseTo(h, 1);
    },
  );

  it('reports the true model length regardless of drawing scale', () => {
    expect(dimValues('top', 1)).toEqual(dimValues('top', 3)); // scale-invariant text
  });
});

describe('computeDrawingGeometryFingerprint', () => {
  it('is stable for the same geometry across calls', () => {
    const a = makeBox(50, 30, 20);
    const f1 = computeDrawingGeometryFingerprint(a);
    const f2 = computeDrawingGeometryFingerprint(a);
    expect(f1).toBe(f2);
  });

  it('differs when the geometry size changes', () => {
    const a = makeBox(50, 30, 20);
    const b = makeBox(80, 30, 20);
    expect(computeDrawingGeometryFingerprint(a))
      .not.toBe(computeDrawingGeometryFingerprint(b));
  });

  it('returns the empty marker for an empty geometry', () => {
    const empty = new THREE.BufferGeometry();
    expect(computeDrawingGeometryFingerprint(empty)).toBe('g:empty');
  });
});

describe('buildDrawingSvgString', () => {
  it('emits a valid SVG document with viewBox + paper rectangle', () => {
    const drawing = {
      views: [],
      titleBlock: { partName: 'P', material: 'M', drawnBy: 'D', date: '2026-05-17', scale: '1:1', revision: 'A' },
      paperWidth: 297,
      paperHeight: 210,
    };
    const svg = buildDrawingSvgString(drawing);
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toContain('viewBox="0 0 297 210"');
    expect(svg).toContain('width="297mm"');
    expect(svg).toContain('<rect');
  });

  it('escapes XML special characters in view labels', () => {
    const drawing = {
      views: [{
        projection: 'front' as const,
        lines: [],
        texts: [{ x: 0, y: 0, text: 'A & B <ok>', fontSize: 3, anchor: 'middle' as const, style: 'note' as const }],
        position: { x: 50, y: 50 },
        width: 50,
        height: 50,
      }],
      titleBlock: { partName: '', material: '', drawnBy: '', date: '', scale: '', revision: '' },
      paperWidth: 297,
      paperHeight: 210,
    };
    const svg = buildDrawingSvgString(drawing);
    expect(svg).toContain('A &amp; B &lt;ok&gt;');
    expect(svg).not.toContain('A & B <ok>');
  });
});
