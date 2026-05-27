/**
 * elementWarpDetector.ts — Compute warp / skew / Jacobian metrics
 * for FEA element quality.
 *
 * For shell elements (quad / triangle) and solid elements (hex /
 * tet), various distortion metrics indicate mesh quality. Standard
 * thresholds (NAFEMS):
 *
 *   - Aspect ratio < 5     (preferably < 3)
 *   - Skew angle < 60°     (corner deviation from 90°)
 *   - Warp angle < 5°      (out-of-plane for quads)
 *   - Jacobian > 0.6       (parametric mapping non-degeneracy)
 *
 * Module computes these per element + classifies elements as
 * acceptable / marginal / fail, returns the worst offenders for
 * mesh-refinement guidance.
 */

export interface Vec3 { x: number; y: number; z: number }

export type ElementKind = 'triangle' | 'quad' | 'tet' | 'hex';

export interface ElementGeometry {
  id: string;
  kind: ElementKind;
  /** Nodal positions in order (3 for tri, 4 for quad/tet, 8 for hex). */
  nodes: Vec3[];
}

export interface ElementMetrics {
  id: string;
  kind: ElementKind;
  aspectRatio: number;
  skewAngleDeg: number;
  warpAngleDeg: number;
  jacobian: number;
  classification: 'pass' | 'marginal' | 'fail';
  notes: string[];
}

export interface DetectorOptions {
  aspectRatioMax: number;
  skewMaxDeg: number;
  warpMaxDeg: number;
  jacobianMin: number;
}

export const DEFAULT_OPTIONS: DetectorOptions = {
  aspectRatioMax: 5,
  skewMaxDeg: 60,
  warpMaxDeg: 5,
  jacobianMin: 0.6,
};

// ── Top-level entry ────────────────────────────────────────────

export function evaluateElements(elements: ElementGeometry[], options: Partial<DetectorOptions> = {}): ElementMetrics[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return elements.map(e => evaluateOne(e, opts));
}

function evaluateOne(el: ElementGeometry, opts: DetectorOptions): ElementMetrics {
  const aspect = computeAspectRatio(el);
  const skew = computeSkewAngleDeg(el);
  const warp = computeWarpAngleDeg(el);
  const jac = computeJacobian(el);
  const notes: string[] = [];
  let classification: 'pass' | 'marginal' | 'fail' = 'pass';
  if (aspect > opts.aspectRatioMax) {
    classification = aspect > opts.aspectRatioMax * 2 ? 'fail' : 'marginal';
    notes.push(`Aspect ratio ${aspect.toFixed(2)} > ${opts.aspectRatioMax}.`);
  }
  if (skew > opts.skewMaxDeg) {
    classification = skew > opts.skewMaxDeg * 1.2 ? 'fail' : escalate(classification, 'marginal');
    notes.push(`Skew ${skew.toFixed(1)}° > ${opts.skewMaxDeg}°.`);
  }
  if (warp > opts.warpMaxDeg) {
    classification = escalate(classification, warp > opts.warpMaxDeg * 2 ? 'fail' : 'marginal');
    notes.push(`Warp ${warp.toFixed(1)}° > ${opts.warpMaxDeg}°.`);
  }
  if (jac < opts.jacobianMin) {
    classification = jac < opts.jacobianMin * 0.5 ? 'fail' : escalate(classification, 'marginal');
    notes.push(`Jacobian ${jac.toFixed(2)} < ${opts.jacobianMin}.`);
  }
  return {
    id: el.id, kind: el.kind, aspectRatio: aspect, skewAngleDeg: skew, warpAngleDeg: warp, jacobian: jac,
    classification, notes,
  };
}

function escalate(current: 'pass' | 'marginal' | 'fail', next: 'marginal' | 'fail'): 'pass' | 'marginal' | 'fail' {
  if (current === 'fail') return 'fail';
  if (next === 'fail') return 'fail';
  return 'marginal';
}

// ── Metric helpers ────────────────────────────────────────────

function computeAspectRatio(el: ElementGeometry): number {
  const lengths = edgeLengths(el);
  if (lengths.length === 0) return 1;
  let min = Infinity;
  let max = 0;
  for (const l of lengths) {
    if (l < min) min = l;
    if (l > max) max = l;
  }
  return min === 0 ? Infinity : max / min;
}

function edgeLengths(el: ElementGeometry): number[] {
  const edges: [number, number][] = [];
  if (el.kind === 'triangle') edges.push([0, 1], [1, 2], [2, 0]);
  else if (el.kind === 'quad') edges.push([0, 1], [1, 2], [2, 3], [3, 0]);
  else if (el.kind === 'tet') edges.push([0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]);
  else if (el.kind === 'hex') {
    const bottomEdges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];
    const topEdges: [number, number][] = [[4, 5], [5, 6], [6, 7], [7, 4]];
    const verticalEdges: [number, number][] = [[0, 4], [1, 5], [2, 6], [3, 7]];
    edges.push(...bottomEdges, ...topEdges, ...verticalEdges);
  }
  return edges.map(([a, b]) => distance(el.nodes[a]!, el.nodes[b]!));
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function computeSkewAngleDeg(el: ElementGeometry): number {
  if (el.kind !== 'quad') return 0;
  const corners = el.nodes;
  let maxDeviation = 0;
  for (let i = 0; i < 4; i++) {
    const prev = corners[(i + 3) % 4]!;
    const cur = corners[i]!;
    const next = corners[(i + 1) % 4]!;
    const v1 = sub(prev, cur);
    const v2 = sub(next, cur);
    const dotV = dot(v1, v2);
    const cos = dotV / (norm(v1) * norm(v2));
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    const deviation = Math.abs(angleDeg - 90);
    if (deviation > maxDeviation) maxDeviation = deviation;
  }
  return maxDeviation;
}

function computeWarpAngleDeg(el: ElementGeometry): number {
  if (el.kind !== 'quad') return 0;
  // Compute normals of two triangles formed by the quad diagonals.
  const [a, b, c, d] = el.nodes as [Vec3, Vec3, Vec3, Vec3];
  const n1 = cross(sub(b, a), sub(c, a));
  const n2 = cross(sub(c, a), sub(d, a));
  const cosAngle = dot(n1, n2) / Math.max(0.0001, norm(n1) * norm(n2));
  return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
}

function computeJacobian(el: ElementGeometry): number {
  if (el.kind === 'triangle') {
    const [a, b, c] = el.nodes as [Vec3, Vec3, Vec3];
    const area = norm(cross(sub(b, a), sub(c, a))) / 2;
    const edges = edgeLengths(el);
    const idealArea = (Math.sqrt(3) / 4) * Math.pow(Math.max(...edges), 2);
    return idealArea === 0 ? 0 : area / idealArea;
  }
  if (el.kind === 'quad') {
    const skew = computeSkewAngleDeg(el);
    return Math.max(0, 1 - skew / 90);
  }
  if (el.kind === 'tet') {
    const [a, b, c, d] = el.nodes as [Vec3, Vec3, Vec3, Vec3];
    const vol = Math.abs(dot(sub(b, a), cross(sub(c, a), sub(d, a)))) / 6;
    const edges = edgeLengths(el);
    const maxEdge = Math.max(...edges);
    const idealVol = (Math.sqrt(2) / 12) * Math.pow(maxEdge, 3);
    return idealVol === 0 ? 0 : vol / idealVol;
  }
  // Hex Jacobian — use a normalised volume.
  if (el.kind === 'hex') {
    const edges = edgeLengths(el);
    const minE = Math.min(...edges);
    const maxE = Math.max(...edges);
    return maxE === 0 ? 0 : minE / maxE;
  }
  return 1;
}

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(v: Vec3): number { return Math.hypot(v.x, v.y, v.z); }

// ── Aggregate quality ────────────────────────────────────────

export interface QualityReport {
  total: number;
  passCount: number;
  marginalCount: number;
  failCount: number;
  worstAspect: number;
  worstSkew: number;
  worstWarp: number;
  worstJacobian: number;
}

export function aggregateQuality(metrics: ElementMetrics[]): QualityReport {
  let pass = 0, marg = 0, fail = 0;
  let worstA = 0, worstS = 0, worstW = 0, worstJ = Infinity;
  for (const m of metrics) {
    if (m.classification === 'pass') pass++;
    else if (m.classification === 'marginal') marg++;
    else fail++;
    if (m.aspectRatio > worstA) worstA = m.aspectRatio;
    if (m.skewAngleDeg > worstS) worstS = m.skewAngleDeg;
    if (m.warpAngleDeg > worstW) worstW = m.warpAngleDeg;
    if (m.jacobian < worstJ) worstJ = m.jacobian;
  }
  return { total: metrics.length, passCount: pass, marginalCount: marg, failCount: fail, worstAspect: worstA, worstSkew: worstS, worstWarp: worstW, worstJacobian: metrics.length === 0 ? 1 : worstJ };
}

// ── Summary ────────────────────────────────────────────────────

export interface WarpSummary {
  elementCount: number;
  passFraction: number;
  failCount: number;
  worstJacobian: number;
}

export function summarize(metrics: ElementMetrics[]): WarpSummary {
  const r = aggregateQuality(metrics);
  return {
    elementCount: r.total,
    passFraction: r.total === 0 ? 1 : r.passCount / r.total,
    failCount: r.failCount,
    worstJacobian: r.worstJacobian,
  };
}
