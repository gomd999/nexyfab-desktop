/**
 * dxfArcDetect — collapse faceted line-segment chains into true circles / arcs.
 *
 * The auto-drawing projection (`autoDrawing.ts`) tessellates the model, so a
 * hole or a cylinder reads as a fan of short straight chords. Exporting those
 * as DXF `LINE` entities is correct but low-fidelity: a machinist / CAM tool
 * wants a real `CIRCLE` (one center + radius) or `ARC`, not 24 little lines.
 *
 * This pure module groups same-layer segments into connected chains, fits a
 * circle (algebraic Kåsa least-squares) to each chain's vertices, and — only
 * when the fit is tight AND the chain genuinely curves — emits a CIRCLE (closed
 * loop, ~360°) or ARC (open span). Anything that doesn't fit cleanly is returned
 * untouched as `remaining` segments, so the result is never worse than all-lines.
 */

export interface Seg { x1: number; y1: number; x2: number; y2: number }
export interface DetectedCircle { cx: number; cy: number; r: number }
export interface DetectedArc { cx: number; cy: number; r: number; startDeg: number; endDeg: number }
export interface ArcDetectResult {
  circles: DetectedCircle[];
  arcs: DetectedArc[];
  remaining: Seg[];
}

export interface ArcDetectOptions {
  /** Min segments in a chain to attempt a fit. */
  minSegments?: number;
  /** Absolute radial-residual tolerance (mm). */
  absTolMm?: number;
  /** Relative radial-residual tolerance (× radius). */
  relTol?: number;
  /** Endpoint-merge tolerance (mm). */
  weldTolMm?: number;
}

const DEFAULTS: Required<ArcDetectOptions> = {
  // 12+ chords distinguishes a genuinely-tessellated circle from an INTENDED
  // low-poly polygon (triangle/square/hexagon): a square's 4 corners lie exactly
  // on their circumcircle, so few-vertex fans are geometrically indistinguishable
  // from circles — only the facet count tells them apart. Real model
  // tessellation emits ≥24 chords per circle, well above this floor.
  minSegments: 12,
  absTolMm: 1e-3,
  relTol: 0.02,
  weldTolMm: 1e-4,
};

// ── small linear algebra ────────────────────────────────────────────────────

/** Solve a 3×3 system A x = b (Gaussian elimination, partial pivot). null if singular. */
function solve3(A: number[][], b: number[]): [number, number, number] | null {
  const m = [
    [A[0]![0]!, A[0]![1]!, A[0]![2]!, b[0]!],
    [A[1]![0]!, A[1]![1]!, A[1]![2]!, b[1]!],
    [A[2]![0]!, A[2]![1]!, A[2]![2]!, b[2]!],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    const d = m[col]![col]!;
    for (let c = col; c < 4; c++) m[col]![c]! /= d;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r]![col]!;
      for (let c = col; c < 4; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return [m[0]![3]!, m[1]![3]!, m[2]![3]!];
}

interface Pt { x: number; y: number }

/** Kåsa algebraic circle fit. Returns center+radius+max radial residual, or null. */
function fitCircle(pts: Pt[]): { cx: number; cy: number; r: number; maxResidual: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    Sx += p.x; Sy += p.y; Sxx += p.x * p.x; Syy += p.y * p.y; Sxy += p.x * p.y;
    Sxz += p.x * z; Syz += p.y * z; Sz += z;
  }
  const sol = solve3([[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]], [Sxz, Syz, Sz]);
  if (!sol) return null;
  const [A, B, C] = sol;
  const cx = A / 2, cy = B / 2;
  const r2 = C + cx * cx + cy * cy;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let maxResidual = 0;
  for (const p of pts) {
    maxResidual = Math.max(maxResidual, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
  }
  return { cx, cy, r, maxResidual };
}

// ── chaining ────────────────────────────────────────────────────────────────

function keyOf(x: number, y: number, weld: number): string {
  const q = (v: number) => Math.round(v / weld);
  return `${q(x)},${q(y)}`;
}

/**
 * Group segments into connected vertex chains (paths/loops). Only walks through
 * vertices of degree 2 (a junction of degree ≥3 ends a chain) so we never merge
 * two different curves through a shared corner.
 */
function buildChains(segs: Seg[], weld: number): { chains: Pt[][]; chainSegIdx: number[][] } {
  type Node = { x: number; y: number; edges: number[] };
  const nodes = new Map<string, Node>();
  const node = (x: number, y: number): Node => {
    const k = keyOf(x, y, weld);
    let n = nodes.get(k);
    if (!n) { n = { x, y, edges: [] }; nodes.set(k, n); }
    return n;
  };
  const endA: Node[] = [], endB: Node[] = [];
  segs.forEach((s, i) => {
    const a = node(s.x1, s.y1), b = node(s.x2, s.y2);
    a.edges.push(i); b.edges.push(i);
    endA[i] = a; endB[i] = b;
  });

  const used = new Array(segs.length).fill(false);
  const chains: Pt[][] = [];
  const chainSegIdx: number[][] = [];

  const other = (i: number, from: Node): Node => (endA[i] === from ? endB[i]! : endA[i]!);

  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    // Walk both directions from this seed segment.
    used[start] = true;
    const segIdx = [start];
    const a = endA[start]!, b = endB[start]!;
    const verts: Pt[] = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];

    // Extend forward from b.
    let cur = b, prevSeg = start;
    while (cur.edges.length === 2) {
      const next = cur.edges.find((e) => e !== prevSeg && !used[e]);
      if (next === undefined) break;
      used[next] = true; segIdx.push(next);
      const nx = other(next, cur);
      verts.push({ x: nx.x, y: nx.y });
      prevSeg = next; cur = nx;
      if (cur === a) break; // closed loop
    }
    // Extend backward from a (prepend).
    cur = a; prevSeg = start;
    while (cur.edges.length === 2) {
      const next = cur.edges.find((e) => e !== prevSeg && !used[e]);
      if (next === undefined) break;
      used[next] = true; segIdx.unshift(next);
      const nx = other(next, cur);
      verts.unshift({ x: nx.x, y: nx.y });
      prevSeg = next; cur = nx;
    }
    chains.push(verts);
    chainSegIdx.push(segIdx);
  }
  return { chains, chainSegIdx };
}

// ── public ──────────────────────────────────────────────────────────────────

export function detectCirclesAndArcs(segs: Seg[], options?: ArcDetectOptions): ArcDetectResult {
  const opt = { ...DEFAULTS, ...options };
  const circles: DetectedCircle[] = [];
  const arcs: DetectedArc[] = [];
  const consumed = new Set<number>();

  const { chains, chainSegIdx } = buildChains(segs, opt.weldTolMm);

  for (let ci = 0; ci < chains.length; ci++) {
    const verts = chains[ci]!;
    const idx = chainSegIdx[ci]!;
    if (idx.length < opt.minSegments) continue;

    const closed = Math.hypot(verts[0]!.x - verts[verts.length - 1]!.x, verts[0]!.y - verts[verts.length - 1]!.y) <= opt.weldTolMm * 4;
    // For a circle fit, drop the duplicate closing vertex.
    const fitPts = closed ? verts.slice(0, -1) : verts;
    if (fitPts.length < 3) continue;

    const fit = fitCircle(fitPts);
    if (!fit) continue;
    const tol = Math.max(opt.absTolMm, opt.relTol * fit.r);
    if (fit.maxResidual > tol) continue;

    // Curvature guard: reject near-collinear chains that a huge-radius circle
    // "fits" trivially. Require a real sagitta (bow) vs the endpoint chord.
    if (!closed) {
      const p0 = fitPts[0]!, p1 = fitPts[fitPts.length - 1]!;
      const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (chord < 1e-9) continue;
      let sagitta = 0;
      for (const p of fitPts) {
        // perpendicular distance to the chord line
        const d = Math.abs((p1.y - p0.y) * p.x - (p1.x - p0.x) * p.y + p1.x * p0.y - p1.y * p0.x) / chord;
        sagitta = Math.max(sagitta, d);
      }
      if (sagitta < Math.max(2 * tol, 0.01 * chord)) continue; // too straight
    }

    // Angular coverage → full circle vs arc (largest-gap method).
    const angles = fitPts.map((p) => Math.atan2(p.y - fit.cy, p.x - fit.cx)).sort((a, b) => a - b);
    let maxGap = angles[0]! + 2 * Math.PI - angles[angles.length - 1]!;
    let gapAt = angles.length - 1; // gap after the last (wrap)
    for (let i = 1; i < angles.length; i++) {
      const g = angles[i]! - angles[i - 1]!;
      if (g > maxGap) { maxGap = g; gapAt = i - 1; }
    }
    const meanStep = (2 * Math.PI) / fitPts.length;

    if (closed && maxGap < meanStep * 2.2) {
      circles.push({ cx: fit.cx, cy: fit.cy, r: fit.r });
    } else if (maxGap > meanStep * 1.5) {
      // Arc occupies everything except the largest gap: CCW from the vertex
      // after the gap to the vertex before it.
      const startA = angles[(gapAt + 1) % angles.length]!;
      const endA = angles[gapAt]!;
      const deg = (rad: number) => ((rad * 180) / Math.PI + 360) % 360;
      arcs.push({ cx: fit.cx, cy: fit.cy, r: fit.r, startDeg: deg(startA), endDeg: deg(endA) });
    } else {
      continue; // ambiguous — leave as lines
    }
    for (const i of idx) consumed.add(i);
  }

  const remaining = segs.filter((_, i) => !consumed.has(i));
  return { circles, arcs, remaining };
}
