/**
 * lineArt.ts — Technical-drawing line extraction from a 3D mesh.
 *
 * For 2D technical drawings + style-line previews, we need the
 * mesh's *visual* edges — not every triangle edge. Three categories
 * (DeCarlo et al. 2003):
 *
 *   - **Silhouette** — edges where one face faces camera and the
 *     other faces away (dot(normal_a, view) × dot(normal_b, view) < 0).
 *     Defines the part outline.
 *   - **Sharp crease** — edges whose adjacent faces differ by more
 *     than a dihedral threshold (e.g. 30°). Defines feature edges.
 *   - **Boundary** — open edges (no opposite face). Defines holes.
 *
 * Output is a list of line segments in world-space, classified by
 * kind. Downstream:
 *
 *   - 2D drawing: project to a plane and emit SVG / DXF.
 *   - 3D render: composite line layer over the shaded render
 *     ("toon" or "blueprint" style).
 */

export type Vec3 = [number, number, number];

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export type LineKind = 'silhouette' | 'crease' | 'boundary' | 'border';

export interface LineSegment {
  startMm: Vec3;
  endMm: Vec3;
  kind: LineKind;
  /** Dihedral angle (rad) between adjacent faces, if applicable. */
  dihedralRad?: number;
}

export interface LineArtOptions {
  /** Camera position (mm) — used for silhouette detection. */
  cameraPositionMm: Vec3;
  /** Dihedral angle threshold for "sharp crease" (deg). */
  creaseAngleDeg: number;
  /** Detect silhouette edges? */
  detectSilhouette: boolean;
  /** Detect creases? */
  detectCreases: boolean;
  /** Detect boundary edges? */
  detectBoundary: boolean;
}

export const DEFAULT_LINE_ART_OPTIONS: LineArtOptions = {
  cameraPositionMm: [0, 0, 100],
  creaseAngleDeg: 30,
  detectSilhouette: true,
  detectCreases: true,
  detectBoundary: true,
};

// ── Edge collection ────────────────────────────────────────────

interface EdgeBucket {
  v1: number;
  v2: number;
  triangleIndices: number[];
}

function collectEdges(mesh: MeshArrays): EdgeBucket[] {
  const map = new Map<string, EdgeBucket>();
  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const lo = Math.min(a!, b!), hi = Math.max(a!, b!);
      const key = `${lo}_${hi}`;
      const bucket = map.get(key);
      if (bucket) {
        bucket.triangleIndices.push(t);
      } else {
        map.set(key, { v1: lo, v2: hi, triangleIndices: [t] });
      }
    }
  }
  return [...map.values()];
}

// ── Triangle normal cache ──────────────────────────────────────

function triangleNormal(mesh: MeshArrays, t: number): Vec3 {
  const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
  const p0: Vec3 = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
  const p1: Vec3 = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
  const p2: Vec3 = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function triangleCentroid(mesh: MeshArrays, t: number): Vec3 {
  const i0 = mesh.indices[t * 3]!, i1 = mesh.indices[t * 3 + 1]!, i2 = mesh.indices[t * 3 + 2]!;
  return [
    (mesh.positions[i0 * 3]! + mesh.positions[i1 * 3]! + mesh.positions[i2 * 3]!) / 3,
    (mesh.positions[i0 * 3 + 1]! + mesh.positions[i1 * 3 + 1]! + mesh.positions[i2 * 3 + 1]!) / 3,
    (mesh.positions[i0 * 3 + 2]! + mesh.positions[i1 * 3 + 2]! + mesh.positions[i2 * 3 + 2]!) / 3,
  ];
}

// ── Top-level entry ─────────────────────────────────────────────

export function extractLineArt(mesh: MeshArrays, options: Partial<LineArtOptions> = {}): LineSegment[] {
  const opts = { ...DEFAULT_LINE_ART_OPTIONS, ...options };
  const edges = collectEdges(mesh);
  const segments: LineSegment[] = [];
  const cosCrease = Math.cos((opts.creaseAngleDeg * Math.PI) / 180);

  for (const edge of edges) {
    const start: Vec3 = [mesh.positions[edge.v1 * 3]!, mesh.positions[edge.v1 * 3 + 1]!, mesh.positions[edge.v1 * 3 + 2]!];
    const end: Vec3 = [mesh.positions[edge.v2 * 3]!, mesh.positions[edge.v2 * 3 + 1]!, mesh.positions[edge.v2 * 3 + 2]!];

    if (edge.triangleIndices.length === 1 && opts.detectBoundary) {
      segments.push({ startMm: start, endMm: end, kind: 'boundary' });
      continue;
    }

    if (edge.triangleIndices.length === 2) {
      const [tA, tB] = edge.triangleIndices;
      const nA = triangleNormal(mesh, tA!);
      const nB = triangleNormal(mesh, tB!);
      const dotN = nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2];

      // Crease test.
      if (opts.detectCreases && dotN < cosCrease) {
        segments.push({
          startMm: start, endMm: end, kind: 'crease',
          dihedralRad: Math.acos(Math.max(-1, Math.min(1, dotN))),
        });
      }

      // Silhouette test.
      if (opts.detectSilhouette) {
        const cA = triangleCentroid(mesh, tA!);
        const cB = triangleCentroid(mesh, tB!);
        const viewA: Vec3 = [opts.cameraPositionMm[0] - cA[0], opts.cameraPositionMm[1] - cA[1], opts.cameraPositionMm[2] - cA[2]];
        const viewB: Vec3 = [opts.cameraPositionMm[0] - cB[0], opts.cameraPositionMm[1] - cB[1], opts.cameraPositionMm[2] - cB[2]];
        const dotA = nA[0] * viewA[0] + nA[1] * viewA[1] + nA[2] * viewA[2];
        const dotB = nB[0] * viewB[0] + nB[1] * viewB[1] + nB[2] * viewB[2];
        if (dotA * dotB < 0) {
          segments.push({ startMm: start, endMm: end, kind: 'silhouette' });
        }
      }
    }

    if (edge.triangleIndices.length > 2 && opts.detectBoundary) {
      segments.push({ startMm: start, endMm: end, kind: 'border' });
    }
  }

  return segments;
}

// ── SVG output (for technical drawings) ────────────────────────

export interface SvgOptions {
  /** Output SVG size in px. */
  width: number;
  height: number;
  /** Projection: orthographic to XY plane, plus optional axis swap. */
  projectionPlane: 'XY' | 'XZ' | 'YZ';
  /** Stroke color per line kind. */
  strokeColors: Record<LineKind, string>;
  /** Stroke widths per kind. */
  strokeWidths: Record<LineKind, number>;
  /** Margin around the drawing (px). */
  marginPx: number;
}

export const DEFAULT_SVG_OPTIONS: SvgOptions = {
  width: 800,
  height: 600,
  projectionPlane: 'XY',
  strokeColors: { silhouette: '#000', crease: '#444', boundary: '#888', border: '#f00' },
  strokeWidths: { silhouette: 1.5, crease: 0.8, boundary: 0.5, border: 1 },
  marginPx: 20,
};

export function linesToSvg(segments: LineSegment[], options: Partial<SvgOptions> = {}): string {
  const opts = { ...DEFAULT_SVG_OPTIONS, ...options };
  if (segments.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}"></svg>`;
  }
  // Project to 2D.
  const proj2d = (p: Vec3): [number, number] => {
    if (opts.projectionPlane === 'XY') return [p[0], p[1]];
    if (opts.projectionPlane === 'XZ') return [p[0], p[2]];
    return [p[1], p[2]];
  };
  // Compute bounds.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of segments) {
    for (const p of [proj2d(seg.startMm), proj2d(seg.endMm)]) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
  }
  const usableW = opts.width - 2 * opts.marginPx;
  const usableH = opts.height - 2 * opts.marginPx;
  const scaleX = (maxX - minX) > 0 ? usableW / (maxX - minX) : 1;
  const scaleY = (maxY - minY) > 0 ? usableH / (maxY - minY) : 1;
  const scale = Math.min(scaleX, scaleY);
  const px = (p: [number, number]): [number, number] => [
    opts.marginPx + (p[0] - minX) * scale,
    opts.height - opts.marginPx - (p[1] - minY) * scale,
  ];

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}">`);
  for (const seg of segments) {
    const a = px(proj2d(seg.startMm));
    const b = px(proj2d(seg.endMm));
    const color = opts.strokeColors[seg.kind];
    const width = opts.strokeWidths[seg.kind];
    lines.push(`  <line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" stroke="${color}" stroke-width="${width}" />`);
  }
  lines.push('</svg>');
  return lines.join('\n');
}

// ── Stats ──────────────────────────────────────────────────────

export interface LineArtSummary {
  silhouetteCount: number;
  creaseCount: number;
  boundaryCount: number;
  borderCount: number;
  totalLength: number;
}

export function summarizeLineArt(segments: LineSegment[]): LineArtSummary {
  let silhouette = 0, crease = 0, boundary = 0, border = 0;
  let length = 0;
  for (const seg of segments) {
    if (seg.kind === 'silhouette') silhouette++;
    else if (seg.kind === 'crease') crease++;
    else if (seg.kind === 'boundary') boundary++;
    else border++;
    length += Math.hypot(seg.endMm[0] - seg.startMm[0], seg.endMm[1] - seg.startMm[1], seg.endMm[2] - seg.startMm[2]);
  }
  return { silhouetteCount: silhouette, creaseCount: crease, boundaryCount: boundary, borderCount: border, totalLength: length };
}
