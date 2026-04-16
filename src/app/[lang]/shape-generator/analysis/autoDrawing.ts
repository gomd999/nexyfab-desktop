// ─── Automatic 2D Engineering Drawing from 3D Geometry ──────────────────────
// Projects 3D mesh edges onto 2D planes to produce standard orthographic views,
// with hidden-line detection, dimension annotations, and centerlines.

import * as THREE from 'three';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type ProjectionView = 'front' | 'top' | 'right' | 'left' | 'back' | 'bottom' | 'iso';

export interface DrawingLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: 'visible' | 'hidden' | 'center' | 'dimension';
}

/** Text annotation placed on the drawing (dimension values, tolerances, notes). */
export interface DrawingText {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  anchor: 'start' | 'middle' | 'end';
  /** 'dimension' = red, 'note' = dark-gray, 'roughness' = purple */
  style: 'dimension' | 'note' | 'roughness';
  /** Rotation in degrees (default 0 = horizontal) */
  rotate?: number;
}

/** Surface roughness specification attached to a view. */
export interface RoughnessSpec {
  /** Ra value in µm, e.g. 1.6, 3.2, 6.3 */
  ra: number;
  /** Where to attach on the view (normalised 0-1 within view bounds) */
  nx: number;
  ny: number;
}

/** General tolerance spec (applied globally or per-feature). */
export interface ToleranceSpec {
  linear: string;   // e.g. "±0.1"
  angular: string;  // e.g. "±0°30'"
  surfaceFinish?: number; // Ra µm
}

export interface DrawingConfig {
  views: ProjectionView[];
  scale: number;
  paperSize: 'A4' | 'A3' | 'A2';
  orientation: 'landscape' | 'portrait';
  showDimensions: boolean;
  showCenterlines: boolean;
  tolerance?: ToleranceSpec;
  roughness?: RoughnessSpec[];
  titleBlock: {
    partName: string;
    material: string;
    drawnBy: string;
    date: string;
    scale: string;
    revision: string;
  };
}

export interface ViewResult {
  projection: ProjectionView;
  lines: DrawingLine[];
  texts: DrawingText[];
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface DrawingResult {
  views: ViewResult[];
  titleBlock: DrawingConfig['titleBlock'];
  tolerance?: ToleranceSpec;
  paperWidth: number;
  paperHeight: number;
}

/* ─── Paper sizes in mm ──────────────────────────────────────────────────── */

const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Deduplicate 2D lines that are nearly identical (within epsilon). */
function deduplicateLines(lines: DrawingLine[], eps = 0.01): DrawingLine[] {
  const result: DrawingLine[] = [];
  for (const line of lines) {
    const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    if (len < eps) continue; // skip zero-length edges
    let dup = false;
    for (const r of result) {
      const match1 =
        Math.abs(r.x1 - line.x1) < eps &&
        Math.abs(r.y1 - line.y1) < eps &&
        Math.abs(r.x2 - line.x2) < eps &&
        Math.abs(r.y2 - line.y2) < eps;
      const match2 =
        Math.abs(r.x1 - line.x2) < eps &&
        Math.abs(r.y1 - line.y2) < eps &&
        Math.abs(r.x2 - line.x1) < eps &&
        Math.abs(r.y2 - line.y1) < eps;
      if (match1 || match2) {
        // Prefer visible over hidden
        if (line.type === 'visible') r.type = 'visible';
        dup = true;
        break;
      }
    }
    if (!dup) result.push({ ...line });
  }
  return result;
}

/* ─── Projection matrices per view ───────────────────────────────────────── */

interface ProjectionDef {
  project: (v: THREE.Vector3) => { x: number; y: number };
  normalSign: (n: THREE.Vector3) => number; // >0 means facing viewer
}

function getProjectionDef(view: ProjectionView): ProjectionDef {
  switch (view) {
    case 'front': // XY plane, looking from +Z
      return {
        project: (v) => ({ x: v.x, y: v.y }),
        normalSign: (n) => n.z,
      };
    case 'back': // XY plane, looking from -Z
      return {
        project: (v) => ({ x: -v.x, y: v.y }),
        normalSign: (n) => -n.z,
      };
    case 'top': // XZ plane, looking from +Y
      return {
        project: (v) => ({ x: v.x, y: -v.z }),
        normalSign: (n) => n.y,
      };
    case 'bottom': // XZ plane, looking from -Y
      return {
        project: (v) => ({ x: v.x, y: v.z }),
        normalSign: (n) => -n.y,
      };
    case 'right': // YZ plane, looking from +X
      return {
        project: (v) => ({ x: -v.z, y: v.y }),
        normalSign: (n) => n.x,
      };
    case 'left': // YZ plane, looking from -X
      return {
        project: (v) => ({ x: v.z, y: v.y }),
        normalSign: (n) => -n.x,
      };
    case 'iso': {
      // Standard isometric: rotate 45 deg around Y then ~35.26 deg around X
      const cos45 = Math.cos(Math.PI / 4);
      const sin45 = Math.sin(Math.PI / 4);
      const cosA = Math.cos(Math.asin(Math.tan(Math.PI / 6)));
      const sinA = Math.sin(Math.asin(Math.tan(Math.PI / 6)));
      return {
        project: (v) => {
          const rx = cos45 * v.x + sin45 * v.z;
          const rz = -sin45 * v.x + cos45 * v.z;
          const ry = cosA * v.y - sinA * rz;
          return { x: rx, y: ry };
        },
        normalSign: (n) => {
          // approximate: faces facing camera in iso view
          const dir = new THREE.Vector3(1, 1, 1).normalize();
          return n.dot(dir);
        },
      };
    }
    default:
      return {
        project: (v) => ({ x: v.x, y: v.y }),
        normalSign: (n) => n.z,
      };
  }
}

/* ─── Core projection ────────────────────────────────────────────────────── */

/**
 * Project 3D mesh edges onto a 2D plane for the given view direction.
 * Uses face-normal direction to classify edges as visible or hidden.
 */
export function projectGeometry(
  geometry: THREE.BufferGeometry,
  projection: ProjectionView,
  scale: number,
): DrawingLine[] {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  if (!pos) return [];

  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const def = getProjectionDef(projection);

  // Collect unique edges with adjacent face normals
  const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[] }>();

  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

    va.fromBufferAttribute(pos, i0);
    vb.fromBufferAttribute(pos, i1);
    vc.fromBufferAttribute(pos, i2);

    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    faceNormal.crossVectors(ab, ac).normalize();

    const edges = [
      { a: i0, b: i1, va: va.clone(), vb: vb.clone() },
      { a: i1, b: i2, va: vb.clone(), vb: vc.clone() },
      { a: i2, b: i0, va: vc.clone(), vb: va.clone() },
    ];

    for (const e of edges) {
      const key = edgeKey(e.a, e.b);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { a: e.va, b: e.vb, normals: [] });
      }
      edgeMap.get(key)!.normals.push(faceNormal.clone());
    }
  }

  // Project edges and classify
  const lines: DrawingLine[] = [];

  for (const [, edge] of edgeMap) {
    const p1 = def.project(edge.a);
    const p2 = def.project(edge.b);

    // Determine visibility: edge is visible if at least one adjacent face
    // has its normal pointing toward the viewer.
    let visible = false;
    let silhouette = false;
    const signs = edge.normals.map((n) => def.normalSign(n));

    if (signs.length === 1) {
      // Boundary edge (only one face) - always draw visible
      visible = signs[0] >= 0;
      silhouette = true;
    } else if (signs.length >= 2) {
      // Silhouette edge: adjacent faces have different visibility
      const hasFront = signs.some((s) => s > 0.01);
      const hasBack = signs.some((s) => s < -0.01);
      if (hasFront && hasBack) {
        silhouette = true;
        visible = true;
      } else {
        visible = hasFront;
        // For internal edges where both faces face the same way,
        // check if the edge angle is sharp enough to be a feature edge
        if (edge.normals.length >= 2) {
          const dot = edge.normals[0].dot(edge.normals[1]);
          if (dot < 0.95) {
            // Feature edge (angle > ~18 degrees)
            silhouette = true;
          }
        }
      }
    }

    if (!silhouette && !visible) continue;
    // Skip non-feature interior edges
    if (!silhouette) continue;

    lines.push({
      x1: p1.x * scale,
      y1: p1.y * scale,
      x2: p2.x * scale,
      y2: p2.y * scale,
      type: visible ? 'visible' : 'hidden',
    });
  }

  return deduplicateLines(lines);
}

/* ─── Auto key dimensions ────────────────────────────────────────────────── */

/** Compute 2D bounding box of geometry in the given projected view (in mm, pre-scale). */
function viewBounds2D(
  geometry: THREE.BufferGeometry,
  def: ProjectionDef,
): { x0: number; y0: number; x1: number; y1: number } {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const corners = [
    new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
    new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
    new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
    new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
    new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
    new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
    new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
    new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
  ];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of corners) {
    const p = def.project(c);
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Generate dimension annotation lines AND text labels for key measurements.
 * Returns { lines, texts } so the caller can keep geometry and annotations separate.
 */
export function generateAutoKeyDimensions(
  geometry: THREE.BufferGeometry,
  projection: ProjectionView,
  scale: number,
  tolerance?: ToleranceSpec,
): { lines: DrawingLine[]; texts: DrawingText[] } {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return { lines: [], texts: [] };

  const def = getProjectionDef(projection);
  let { x0, y0, x1, y1 } = viewBounds2D(geometry, def);
  x0 *= scale; y0 *= scale; x1 *= scale; y1 *= scale;

  const dimLines: DrawingLine[] = [];
  const dimTexts: DrawingText[] = [];
  const dimOffset = 10;
  const tolStr = tolerance ? ` ${tolerance.linear}` : '';

  // Real model dimensions (in mm)
  const realW = Math.abs(bb.max.x - bb.min.x);
  const realH = Math.abs(bb.max.y - bb.min.y);
  const realD = Math.abs(bb.max.z - bb.min.z);

  // Width dimension (horizontal, below the part)
  dimLines.push(
    { x1: x0, y1: y0 - dimOffset, x2: x1, y2: y0 - dimOffset, type: 'dimension' },
    { x1: x0, y1: y0 - 1, x2: x0, y2: y0 - dimOffset - 2, type: 'dimension' },
    { x1: x1, y1: y0 - 1, x2: x1, y2: y0 - dimOffset - 2, type: 'dimension' },
  );
  // Arrowheads (tiny ticks)
  const aw = 1.5;
  dimLines.push(
    { x1: x0, y1: y0 - dimOffset, x2: x0 + aw, y2: y0 - dimOffset + aw / 2, type: 'dimension' },
    { x1: x0, y1: y0 - dimOffset, x2: x0 + aw, y2: y0 - dimOffset - aw / 2, type: 'dimension' },
    { x1: x1, y1: y0 - dimOffset, x2: x1 - aw, y2: y0 - dimOffset + aw / 2, type: 'dimension' },
    { x1: x1, y1: y0 - dimOffset, x2: x1 - aw, y2: y0 - dimOffset - aw / 2, type: 'dimension' },
  );
  dimTexts.push({
    x: (x0 + x1) / 2,
    y: y0 - dimOffset - 1.5,
    text: `${realW.toFixed(1)}${tolStr}`,
    fontSize: 3,
    anchor: 'middle',
    style: 'dimension',
  });

  // Height dimension (vertical, to the right)
  dimLines.push(
    { x1: x1 + dimOffset, y1: y0, x2: x1 + dimOffset, y2: y1, type: 'dimension' },
    { x1: x1 + 1, y1: y0, x2: x1 + dimOffset + 2, y2: y0, type: 'dimension' },
    { x1: x1 + 1, y1: y1, x2: x1 + dimOffset + 2, y2: y1, type: 'dimension' },
  );
  dimLines.push(
    { x1: x1 + dimOffset, y1: y0, x2: x1 + dimOffset - aw / 2, y2: y0 + aw, type: 'dimension' },
    { x1: x1 + dimOffset, y1: y0, x2: x1 + dimOffset + aw / 2, y2: y0 + aw, type: 'dimension' },
    { x1: x1 + dimOffset, y1: y1, x2: x1 + dimOffset - aw / 2, y2: y1 - aw, type: 'dimension' },
    { x1: x1 + dimOffset, y1: y1, x2: x1 + dimOffset + aw / 2, y2: y1 - aw, type: 'dimension' },
  );
  dimTexts.push({
    x: x1 + dimOffset + 2,
    y: (y0 + y1) / 2,
    text: `${realH.toFixed(1)}${tolStr}`,
    fontSize: 3,
    anchor: 'start',
    style: 'dimension',
    rotate: -90,
  });

  // Depth (shown in front / right views)
  if ((projection === 'front' || projection === 'right') && realD > 0.5) {
    dimTexts.push({
      x: x0,
      y: y1 + dimOffset,
      text: `D: ${realD.toFixed(1)}${tolStr}`,
      fontSize: 2.5,
      anchor: 'start',
      style: 'note',
    });
  }

  return { lines: dimLines, texts: dimTexts };
}

/* ─── Surface roughness symbol generator ─────────────────────────────────── */

/**
 * Generate roughness symbol texts and lines for a view.
 * Symbol: √ Ra X.X at the bottom-right of the view.
 */
export function generateRoughnessAnnotations(
  viewWidth: number,
  viewHeight: number,
  roughnessSpecs: RoughnessSpec[],
): DrawingText[] {
  return roughnessSpecs.map((rs) => ({
    x: viewWidth * rs.nx,
    y: viewHeight * rs.ny,
    text: `✓ Ra ${rs.ra}`,
    fontSize: 3,
    anchor: 'middle' as const,
    style: 'roughness' as const,
  }));
}

/* ─── Centerlines ────────────────────────────────────────────────────────── */

function generateCenterlines(
  geometry: THREE.BufferGeometry,
  projection: ProjectionView,
  scale: number,
): DrawingLine[] {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return [];

  const def = getProjectionDef(projection);

  // Project bounding box corners
  const corners = [
    new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
    new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
    new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
    new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
    new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
    new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
    new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
    new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
  ];

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of corners) {
    const p = def.project(c);
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }

  x0 *= scale; y0 *= scale; x1 *= scale; y1 *= scale;

  const ext = 4; // extension beyond geometry edges
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  const lines: DrawingLine[] = [];

  // Horizontal centerline
  lines.push({
    x1: x0 - ext, y1: cy, x2: x1 + ext, y2: cy, type: 'center',
  });

  // Vertical centerline
  lines.push({
    x1: cx, y1: y0 - ext, x2: cx, y2: y1 + ext, type: 'center',
  });

  return lines;
}

/* ─── View layout ────────────────────────────────────────────────────────── */

function computeViewBounds(lines: DrawingLine[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  if (lines.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of lines) {
    if (l.x1 < minX) minX = l.x1;
    if (l.x2 < minX) minX = l.x2;
    if (l.y1 < minY) minY = l.y1;
    if (l.y2 < minY) minY = l.y2;
    if (l.x1 > maxX) maxX = l.x1;
    if (l.x2 > maxX) maxX = l.x2;
    if (l.y1 > maxY) maxY = l.y1;
    if (l.y2 > maxY) maxY = l.y2;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function normalizeLines(lines: DrawingLine[], bounds: { minX: number; minY: number }): DrawingLine[] {
  return lines.map((l) => ({
    ...l,
    x1: l.x1 - bounds.minX,
    y1: l.y1 - bounds.minY,
    x2: l.x2 - bounds.minX,
    y2: l.y2 - bounds.minY,
  }));
}

/** Standard third-angle layout order for common views. */
const VIEW_LAYOUT_ORDER: ProjectionView[] = ['front', 'top', 'right', 'left', 'back', 'bottom', 'iso'];

/* ─── Main drawing generator ─────────────────────────────────────────────── */

/**
 * Generate a complete 2D engineering drawing with multiple projected views
 * arranged on a paper layout with title block.
 */
export function generateDrawing(
  geometry: THREE.BufferGeometry,
  config: DrawingConfig,
): DrawingResult {
  const paper = PAPER_SIZES[config.paperSize] || PAPER_SIZES.A4;
  const paperWidth = config.orientation === 'landscape' ? paper.w : paper.h;
  const paperHeight = config.orientation === 'landscape' ? paper.h : paper.w;

  // Reserve space for title block (bottom 25mm) and margins (10mm each side)
  const marginX = 10;
  const marginY = 10;
  const titleBlockHeight = 25;
  const drawableW = paperWidth - marginX * 2;
  const drawableH = paperHeight - marginY * 2 - titleBlockHeight;

  // Sort views according to standard layout order
  const sortedViews = [...config.views].sort(
    (a, b) => VIEW_LAYOUT_ORDER.indexOf(a) - VIEW_LAYOUT_ORDER.indexOf(b),
  );

  // Project each view
  const rawViews: { projection: ProjectionView; lines: DrawingLine[]; texts: DrawingText[]; w: number; h: number }[] = [];
  for (const v of sortedViews) {
    let lines = projectGeometry(geometry, v, config.scale);
    let texts: DrawingText[] = [];
    if (config.showDimensions) {
      const dimResult = generateAutoKeyDimensions(geometry, v, config.scale, config.tolerance);
      lines = lines.concat(dimResult.lines);
      texts = texts.concat(dimResult.texts);
    }
    if (config.showCenterlines) {
      lines = lines.concat(generateCenterlines(geometry, v, config.scale));
    }
    const bounds = computeViewBounds(lines);
    lines = normalizeLines(lines, bounds);
    // Shift texts by same origin offset
    texts = texts.map(tx => ({ ...tx, x: tx.x - bounds.minX, y: tx.y - bounds.minY }));
    rawViews.push({ projection: v, lines, texts, w: bounds.w, h: bounds.h });
  }

  // Layout views on the paper (simple grid arrangement)
  const viewCount = rawViews.length;
  const cols = viewCount <= 1 ? 1 : viewCount <= 4 ? 2 : 3;
  const rows = Math.ceil(viewCount / cols);

  const cellW = drawableW / cols;
  const cellH = drawableH / rows;

  const viewResults: ViewResult[] = rawViews.map((rv, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);

    // Center each view within its cell
    const cellCX = marginX + col * cellW + cellW / 2;
    const cellCY = marginY + row * cellH + cellH / 2;

    // Scale to fit cell if view is too large
    const fitScale = Math.min(1, (cellW - 20) / Math.max(rv.w, 1), (cellH - 20) / Math.max(rv.h, 1));

    const scaledLines = rv.lines.map((l) => ({
      ...l,
      x1: l.x1 * fitScale,
      y1: l.y1 * fitScale,
      x2: l.x2 * fitScale,
      y2: l.y2 * fitScale,
    }));
    const scaledTexts = rv.texts.map((tx) => ({
      ...tx,
      x: tx.x * fitScale,
      y: tx.y * fitScale,
      fontSize: tx.fontSize * fitScale,
    }));

    // Add roughness symbols if configured
    if (config.roughness && config.roughness.length > 0) {
      const roughTexts = generateRoughnessAnnotations(rv.w * fitScale, rv.h * fitScale, config.roughness);
      scaledTexts.push(...roughTexts);
    }

    const posX = cellCX - (rv.w * fitScale) / 2;
    const posY = cellCY - (rv.h * fitScale) / 2;

    return {
      projection: rv.projection,
      lines: scaledLines,
      texts: scaledTexts,
      position: { x: posX, y: posY },
      width: rv.w * fitScale,
      height: rv.h * fitScale,
    };
  });

  return {
    views: viewResults,
    titleBlock: config.titleBlock,
    tolerance: config.tolerance,
    paperWidth,
    paperHeight,
  };
}
