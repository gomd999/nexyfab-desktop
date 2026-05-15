// CAM toolpath generation — derives G-code-ready 3D paths from a bounding
// volume + machining strategy. v1 supports the three workhorse strategies:
//
//   1. Facing — flat top-down zig-zag at one Z depth (finishing pass).
//   2. Adaptive pocket — concentric inward spiral inside a rectangular pocket.
//   3. Contour parallel — XY contour at the outer profile, stepped down in Z.
//
// All toolpaths are plain (x, y, z, feed) polyline segments — no rapids,
// no arcs. The post-processor wraps them in canonical Mach3 / Fanuc G-code.

import type { Box3 } from 'three';

export interface ToolSpec {
  diameterMm: number;
  flutes: number;
  rpm: number;
  feedRateMmPerMin: number;
  plungeRateMmPerMin: number;
  stepoverMm: number;
  stepdownMm: number;
}

export interface ToolpathSegment {
  start: [number, number, number];
  end: [number, number, number];
  feed: number; // mm/min
  kind: 'cut' | 'plunge' | 'retract' | 'traverse';
}

export interface ToolpathResult {
  segments: ToolpathSegment[];
  estimatedTimeMin: number;
  totalLengthMm: number;
}

// ─── Strategy 1: Facing ────────────────────────────────────────────────────

export function generateFacingToolpath(bbox: Box3, tool: ToolSpec, safeZ = 5): ToolpathResult {
  const segments: ToolpathSegment[] = [];
  const x0 = bbox.min.x, x1 = bbox.max.x;
  const y0 = bbox.min.y, y1 = bbox.max.y;
  const zCut = bbox.max.z; // face the top surface
  const stepover = Math.max(tool.stepoverMm, 0.1);
  let y = y0;
  let direction = 1;

  // Plunge to start.
  segments.push({ start: [x0, y, safeZ], end: [x0, y, zCut], feed: tool.plungeRateMmPerMin, kind: 'plunge' });
  while (y <= y1) {
    const x = direction === 1 ? x1 : x0;
    segments.push({ start: [direction === 1 ? x0 : x1, y, zCut], end: [x, y, zCut], feed: tool.feedRateMmPerMin, kind: 'cut' });
    y += stepover;
    if (y <= y1) {
      segments.push({ start: [x, y - stepover, zCut], end: [x, y, zCut], feed: tool.feedRateMmPerMin, kind: 'cut' });
      direction = -direction;
    }
  }
  segments.push({ start: [segments[segments.length - 1].end[0], y - stepover, zCut], end: [segments[segments.length - 1].end[0], y - stepover, safeZ], feed: tool.feedRateMmPerMin, kind: 'retract' });
  return summarize(segments);
}

// ─── Strategy 2: Adaptive pocket (concentric spiral) ────────────────────────

export function generateAdaptivePocketToolpath(bbox: Box3, tool: ToolSpec, safeZ = 5): ToolpathResult {
  const segments: ToolpathSegment[] = [];
  const stepover = Math.max(tool.stepoverMm, 0.1);
  const stepdown = Math.max(tool.stepdownMm, 0.1);
  const r = tool.diameterMm / 2;
  const zTop = bbox.max.z;
  const zBot = bbox.min.z;
  for (let z = zTop - stepdown; z >= zBot; z -= stepdown) {
    let x0 = bbox.min.x + r, x1 = bbox.max.x - r;
    let y0 = bbox.min.y + r, y1 = bbox.max.y - r;
    segments.push({ start: [x0, y0, safeZ], end: [x0, y0, z], feed: tool.plungeRateMmPerMin, kind: 'plunge' });
    while (x0 < x1 && y0 < y1) {
      segments.push({ start: [x0, y0, z], end: [x1, y0, z], feed: tool.feedRateMmPerMin, kind: 'cut' });
      segments.push({ start: [x1, y0, z], end: [x1, y1, z], feed: tool.feedRateMmPerMin, kind: 'cut' });
      segments.push({ start: [x1, y1, z], end: [x0, y1, z], feed: tool.feedRateMmPerMin, kind: 'cut' });
      segments.push({ start: [x0, y1, z], end: [x0, y0 + stepover, z], feed: tool.feedRateMmPerMin, kind: 'cut' });
      x0 += stepover; x1 -= stepover; y0 += stepover; y1 -= stepover;
    }
    segments.push({ start: [x0, y0, z], end: [x0, y0, safeZ], feed: tool.feedRateMmPerMin, kind: 'retract' });
  }
  return summarize(segments);
}

// ─── Strategy 3: Contour parallel (outer profile, stepped Z) ────────────────

export function generateContourToolpath(bbox: Box3, tool: ToolSpec, safeZ = 5): ToolpathResult {
  const segments: ToolpathSegment[] = [];
  const stepdown = Math.max(tool.stepdownMm, 0.1);
  const r = tool.diameterMm / 2;
  const x0 = bbox.min.x - r, x1 = bbox.max.x + r;
  const y0 = bbox.min.y - r, y1 = bbox.max.y + r;
  for (let z = bbox.max.z - stepdown; z >= bbox.min.z; z -= stepdown) {
    segments.push({ start: [x0, y0, safeZ], end: [x0, y0, z], feed: tool.plungeRateMmPerMin, kind: 'plunge' });
    segments.push({ start: [x0, y0, z], end: [x1, y0, z], feed: tool.feedRateMmPerMin, kind: 'cut' });
    segments.push({ start: [x1, y0, z], end: [x1, y1, z], feed: tool.feedRateMmPerMin, kind: 'cut' });
    segments.push({ start: [x1, y1, z], end: [x0, y1, z], feed: tool.feedRateMmPerMin, kind: 'cut' });
    segments.push({ start: [x0, y1, z], end: [x0, y0, z], feed: tool.feedRateMmPerMin, kind: 'cut' });
    segments.push({ start: [x0, y0, z], end: [x0, y0, safeZ], feed: tool.feedRateMmPerMin, kind: 'retract' });
  }
  return summarize(segments);
}

// ─── G-code post-processor ─────────────────────────────────────────────────

export function toolpathToGcode(path: ToolpathResult, tool: ToolSpec): string {
  const lines: string[] = [];
  lines.push('; NexyFab generated G-code');
  lines.push('G21 G90 G94'); // metric, absolute, feed/min
  lines.push(`M3 S${Math.round(tool.rpm)}`);
  let lastEnd: [number, number, number] | null = null;
  for (const seg of path.segments) {
    if (!lastEnd || seg.start[0] !== lastEnd[0] || seg.start[1] !== lastEnd[1] || seg.start[2] !== lastEnd[2]) {
      // Rapid to start of segment.
      lines.push(`G0 X${seg.start[0].toFixed(3)} Y${seg.start[1].toFixed(3)} Z${seg.start[2].toFixed(3)}`);
    }
    lines.push(`G1 X${seg.end[0].toFixed(3)} Y${seg.end[1].toFixed(3)} Z${seg.end[2].toFixed(3)} F${seg.feed.toFixed(0)}`);
    lastEnd = seg.end;
  }
  lines.push('M5');
  lines.push('M30');
  return lines.join('\n');
}

// ─── Internals ─────────────────────────────────────────────────────────────

function summarize(segments: ToolpathSegment[]): ToolpathResult {
  let totalLen = 0;
  let totalMin = 0;
  for (const s of segments) {
    const dx = s.end[0] - s.start[0], dy = s.end[1] - s.start[1], dz = s.end[2] - s.start[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    totalLen += len;
    totalMin += len / Math.max(s.feed, 1);
  }
  return { segments, estimatedTimeMin: totalMin, totalLengthMm: totalLen };
}
