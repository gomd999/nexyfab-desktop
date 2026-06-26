/**
 * Parametric building → papercraft flat-pattern as a single layer-separated DXF.
 * Buildings are parametric so their faces are known — we lay the box net out
 * directly (no mesh unfolding) and emit a real laser-ready DXF: CUT lines
 * (outline + glue tabs) and FOLD lines (creases) on their own named layers, so a
 * laser/cutting plotter cuts one and scores the other.
 */

type Pt = [number, number];
interface Seg { a: Pt; b: Pt; layer: 'CUT' | 'FOLD' | 'TAB' }

function rectEdges(x: number, y: number, w: number, h: number, layers: { bottom: Seg['layer']; top: Seg['layer']; left: Seg['layer']; right: Seg['layer'] }): Seg[] {
  return [
    { a: [x, y], b: [x + w, y], layer: layers.bottom },
    { a: [x, y + h], b: [x + w, y + h], layer: layers.top },
    { a: [x, y], b: [x, y + h], layer: layers.left },
    { a: [x + w, y], b: [x + w, y + h], layer: layers.right },
  ];
}

/** Trapezoidal glue tab along the edge a→b, offset outward by `t`. */
function tab(a: Pt, b: Pt, t: number): Seg[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;       // along the edge
  const nx = uy, ny = -ux;                   // outward normal (right of a→b)
  const inset = Math.min(t, len / 3);
  const p1: Pt = [a[0] + ux * inset + nx * t, a[1] + uy * inset + ny * t];
  const p2: Pt = [b[0] - ux * inset + nx * t, b[1] - uy * inset + ny * t];
  return [
    { a, b: p1, layer: 'TAB' },
    { a: p1, b: p2, layer: 'TAB' },
    { a: p2, b, layer: 'TAB' },
  ];
}

/**
 * Box-building net (cross layout): floor centred, 4 walls folded out, lid on the
 * back wall. Floor↔wall edges are FOLD; outer wall edges are CUT; glue tabs sit
 * on the side-wall outer edges and the lid.
 */
export function buildingNetSegments(W: number, D: number, H: number, t: number): Seg[] {
  const segs: Seg[] = [];
  // floor — all 4 edges fold up to a wall
  segs.push(...rectEdges(0, 0, W, D, { bottom: 'FOLD', top: 'FOLD', left: 'FOLD', right: 'FOLD' }));
  // front wall (below, y<0): top edge is the fold (already on floor), rest cut
  segs.push(...rectEdges(0, -H, W, H, { bottom: 'CUT', top: 'FOLD', left: 'CUT', right: 'CUT' }));
  // back wall (above): bottom is fold, top folds to lid
  segs.push(...rectEdges(0, D, W, H, { bottom: 'FOLD', top: 'FOLD', left: 'CUT', right: 'CUT' }));
  // lid (above back wall)
  segs.push(...rectEdges(0, D + H, W, H, { bottom: 'FOLD', top: 'CUT', left: 'CUT', right: 'CUT' }));
  // left wall (x<0): right edge is fold
  segs.push(...rectEdges(-H, 0, H, D, { bottom: 'CUT', top: 'CUT', left: 'CUT', right: 'FOLD' }));
  // right wall (x>W): left edge is fold
  segs.push(...rectEdges(W, 0, H, D, { bottom: 'CUT', top: 'CUT', left: 'FOLD', right: 'CUT' }));
  // glue tabs: side-wall outer vertical edges + front/lid edges
  segs.push(...tab([-H, D], [-H, 0], t));      // left wall outer
  segs.push(...tab([W + H, 0], [W + H, D], t)); // right wall outer
  segs.push(...tab([W, -H], [0, -H], t));       // front wall bottom
  segs.push(...tab([0, D + 2 * H], [W, D + 2 * H], t)); // lid top
  return segs;
}

export function segmentsToDxf(segs: Seg[]): string {
  const header = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n'; // 4 = millimetres
  const tables =
    '0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n3\n' +
    '0\nLAYER\n2\nCUT\n70\n0\n62\n1\n6\nCONTINUOUS\n' +   // red, solid
    '0\nLAYER\n2\nFOLD\n70\n0\n62\n5\n6\nDASHED\n' +       // blue, dashed
    '0\nLAYER\n2\nTAB\n70\n0\n62\n3\n6\nCONTINUOUS\n' +    // green, solid
    '0\nENDTAB\n0\nENDSEC\n';
  const ents = segs.map(s =>
    `0\nLINE\n8\n${s.layer}\n10\n${s.a[0]}\n20\n${s.a[1]}\n30\n0\n11\n${s.b[0]}\n21\n${s.b[1]}\n31\n0\n`,
  ).join('');
  return header + tables + '0\nSECTION\n2\nENTITIES\n' + ents + '0\nENDSEC\n0\nEOF\n';
}

export function buildingNetDxf(W: number, D: number, H: number, t = 6): { dxf: string; counts: Record<string, number> } {
  const segs = buildingNetSegments(W, D, H, t);
  const counts = { CUT: 0, FOLD: 0, TAB: 0 } as Record<string, number>;
  for (const s of segs) counts[s.layer]++;
  return { dxf: segmentsToDxf(segs), counts };
}
