/**
 * pocketToolpath.ts — 2.5D pocket clearing toolpath generation.
 *
 * Per `nexyfab-gtm`: CAM is "매우 어려움 ❌" for SW-grade depth.
 * NexyFab ships a **preview only** generator — it builds toolpath
 * polylines suitable for visualisation and time estimation, but the
 * actual G-code post-processing happens at the manufacturing partner.
 *
 * Scope:
 *   - Rectangular pocket only (offset along a 2D rectangle).
 *   - Three pattern families: `zigzag`, `spiral`, `contourParallel`.
 *   - Z stepdown via repeated planar passes.
 *   - Stepover = tool diameter × fraction (default 0.4 = 40%).
 *
 * Out of scope:
 *   - Arbitrary 2D pocket profile (would need an offset solver).
 *   - 3-axis surface machining.
 *   - Rest-machining / adaptive clearing.
 */

export interface RectPocket {
  /** Pocket extent on X (mm). */
  width: number;
  /** Pocket extent on Y (mm). */
  height: number;
  /** Total depth (mm). */
  depth: number;
  /** Bottom-left X of the pocket in workpiece coordinates. */
  originX?: number;
  /** Bottom-left Y of the pocket in workpiece coordinates. */
  originY?: number;
  /** Top of the pocket (Z), in workpiece coordinates. */
  topZ?: number;
}

export interface ToolingParams {
  /** Cutter diameter (mm). */
  diameter: number;
  /** Axial step per pass (mm). */
  stepdown: number;
  /** Radial step expressed as a fraction of diameter (0..1). */
  stepoverFraction?: number;
}

export type PocketPattern = 'zigzag' | 'spiral' | 'contourParallel';

export interface ToolpathSegment {
  /** Move kind: rapid (no cut), feed (cutting), plunge (Z-down). */
  kind: 'rapid' | 'feed' | 'plunge';
  /** Start point. */
  start: [number, number, number];
  /** End point. */
  end: [number, number, number];
}

export interface ToolpathResult {
  segments: ToolpathSegment[];
  /** Total feed-rate length (cutting only), mm. */
  cutLengthMm: number;
  /** Total rapid length (positioning), mm. */
  rapidLengthMm: number;
  /** Pass count along Z. */
  passCount: number;
  /** Set when the tool is too large for the pocket — no toolpath was produced. */
  toolTooLarge?: boolean;
}

const SAFE_Z_CLEARANCE = 5; // mm above topZ for rapids

function segLength(s: ToolpathSegment): number {
  const dx = s.end[0] - s.start[0];
  const dy = s.end[1] - s.start[1];
  const dz = s.end[2] - s.start[2];
  return Math.hypot(dx, dy, dz);
}

/** Compute the inset rectangle (offset by tool radius). */
function effectiveRect(p: RectPocket, toolRadius: number): {
  x0: number; y0: number; x1: number; y1: number;
} {
  const ox = p.originX ?? 0;
  const oy = p.originY ?? 0;
  return {
    x0: ox + toolRadius,
    y0: oy + toolRadius,
    x1: ox + p.width - toolRadius,
    y1: oy + p.height - toolRadius,
  };
}

/** Build a zigzag toolpath at a fixed Z. Lines run along X, stepping
 *  in +Y by `stepover`. */
function zigzagAtZ(
  rect: { x0: number; y0: number; x1: number; y1: number },
  z: number,
  stepover: number,
  topZ: number,
): ToolpathSegment[] {
  const out: ToolpathSegment[] = [];
  let y = rect.y0;
  let dir: 1 | -1 = 1;
  // Rapid to start.
  out.push({ kind: 'rapid', start: [rect.x0, y, topZ + SAFE_Z_CLEARANCE], end: [rect.x0, y, topZ + SAFE_Z_CLEARANCE] });
  out.push({ kind: 'plunge', start: [rect.x0, y, topZ + SAFE_Z_CLEARANCE], end: [rect.x0, y, z] });
  while (true) {
    const fromX = dir === 1 ? rect.x0 : rect.x1;
    const toX = dir === 1 ? rect.x1 : rect.x0;
    out.push({ kind: 'feed', start: [fromX, y, z], end: [toX, y, z] });
    if (y >= rect.y1 - 1e-6) break; // reached the far inset wall
    // Clamp the last step to y1 so the final pass clears the strip against the
    // far wall — otherwise (y1−y0) not being a multiple of the stepover leaves an
    // uncut ridge up to one stepover wide.
    const nextY = Math.min(y + stepover, rect.y1);
    out.push({ kind: 'feed', start: [toX, y, z], end: [toX, nextY, z] });
    y = nextY;
    dir = dir === 1 ? -1 : 1;
  }
  return out;
}

/** Inward spiral — concentric rectangles shrinking by `stepover`. */
function spiralAtZ(
  rect: { x0: number; y0: number; x1: number; y1: number },
  z: number,
  stepover: number,
  topZ: number,
): ToolpathSegment[] {
  const out: ToolpathSegment[] = [];
  let x0 = rect.x0, y0 = rect.y0, x1 = rect.x1, y1 = rect.y1;
  // Plunge.
  out.push({ kind: 'rapid', start: [x0, y0, topZ + SAFE_Z_CLEARANCE], end: [x0, y0, topZ + SAFE_Z_CLEARANCE] });
  out.push({ kind: 'plunge', start: [x0, y0, topZ + SAFE_Z_CLEARANCE], end: [x0, y0, z] });
  while (x1 - x0 > stepover && y1 - y0 > stepover) {
    out.push({ kind: 'feed', start: [x0, y0, z], end: [x1, y0, z] });
    out.push({ kind: 'feed', start: [x1, y0, z], end: [x1, y1, z] });
    out.push({ kind: 'feed', start: [x1, y1, z], end: [x0, y1, z] });
    out.push({ kind: 'feed', start: [x0, y1, z], end: [x0, y0 + stepover, z] });
    x0 += stepover; y0 += stepover; x1 -= stepover; y1 -= stepover;
  }
  return out;
}

/** Contour-parallel: same as spiral but with rapid-up between rings,
 *  which lets the cutter unload chips between passes. */
function contourParallelAtZ(
  rect: { x0: number; y0: number; x1: number; y1: number },
  z: number,
  stepover: number,
  topZ: number,
): ToolpathSegment[] {
  const out: ToolpathSegment[] = [];
  let x0 = rect.x0, y0 = rect.y0, x1 = rect.x1, y1 = rect.y1;
  while (x1 > x0 && y1 > y0) {
    out.push({ kind: 'rapid', start: [x0, y0, topZ + SAFE_Z_CLEARANCE], end: [x0, y0, topZ + SAFE_Z_CLEARANCE] });
    out.push({ kind: 'plunge', start: [x0, y0, topZ + SAFE_Z_CLEARANCE], end: [x0, y0, z] });
    out.push({ kind: 'feed', start: [x0, y0, z], end: [x1, y0, z] });
    out.push({ kind: 'feed', start: [x1, y0, z], end: [x1, y1, z] });
    out.push({ kind: 'feed', start: [x1, y1, z], end: [x0, y1, z] });
    out.push({ kind: 'feed', start: [x0, y1, z], end: [x0, y0, z] });
    x0 += stepover; y0 += stepover; x1 -= stepover; y1 -= stepover;
  }
  return out;
}

/** Top-level pocket toolpath builder. */
export function buildPocketToolpath(
  pocket: RectPocket,
  tool: ToolingParams,
  pattern: PocketPattern = 'zigzag',
): ToolpathResult {
  const radius = tool.diameter / 2;
  const stepover = tool.diameter * Math.max(0.05, Math.min(1, tool.stepoverFraction ?? 0.4));
  const topZ = pocket.topZ ?? 0;
  const stepdown = Math.max(0.01, tool.stepdown);
  const rect = effectiveRect(pocket, radius);

  // The tool does not fit: a pocket narrower than the tool diameter on either
  // axis insets to an inverted rectangle. Emit nothing rather than a meaningless
  // plunge (which the old code counted as cutting) — the caller must pick a
  // smaller tool.
  if (rect.x1 <= rect.x0 + 1e-9 || rect.y1 <= rect.y0 + 1e-9) {
    return { segments: [], cutLengthMm: 0, rapidLengthMm: 0, passCount: 0, toolTooLarge: true };
  }

  const segments: ToolpathSegment[] = [];
  let passCount = 0;
  for (let dz = stepdown; dz <= pocket.depth + 1e-9; dz += stepdown) {
    const z = topZ - dz;
    let passSegs: ToolpathSegment[];
    switch (pattern) {
      case 'zigzag':           passSegs = zigzagAtZ(rect, z, stepover, topZ); break;
      case 'spiral':           passSegs = spiralAtZ(rect, z, stepover, topZ); break;
      case 'contourParallel':  passSegs = contourParallelAtZ(rect, z, stepover, topZ); break;
    }
    segments.push(...passSegs);
    passCount++;
  }

  let cutLen = 0, rapidLen = 0;
  for (const s of segments) {
    const len = segLength(s);
    if (s.kind === 'feed' || s.kind === 'plunge') cutLen += len;
    else rapidLen += len;
  }

  return { segments, cutLengthMm: cutLen, rapidLengthMm: rapidLen, passCount };
}
