/**
 * explodedView.ts — Compute exploded-view offsets from assembly mates.
 *
 * An exploded view shifts each component along the mate axis that
 * connects it to its assembly neighbor, in proportion to the
 * neighbor depth and a user "explosion factor". Done well, it
 * reveals every part without occlusion and shows the assembly
 * sequence.
 *
 * Input: assembly tree (parts + mate constraints).
 * Output:
 *   - per-part 3-D offset vector
 *   - trail-line endpoints (start at assembled position, end at
 *     exploded position) for the drawing renderer to draw the
 *     dashed lines users expect.
 *
 * Strategy: build the mate graph, pick the assembly axis as the
 * dominant axis of mate normals, sort parts by signed projection
 * along that axis, and offset each by `factor × depth`.
 */

export type MateAxis = 'x' | 'y' | 'z' | 'auto';

export interface AssemblyPart {
  id: string;
  /** Centroid in assembled position (mm). */
  position: [number, number, number];
  /** Optional bounding extent — used to set minimum offset distance. */
  extentMm?: number;
  /** Parent (sub-assembly id) — siblings explode together if grouped. */
  parentId?: string;
}

export interface AssemblyMate {
  /** Two parts joined by this mate. */
  parts: [string, string];
  /** Mate axis in world coords (e.g. for a coaxial mate this is the shaft direction). */
  axis: [number, number, number];
}

export interface ExplodeOptions {
  /** Multiplier on the natural spacing (default 1.5 = explode by 150% extent). */
  factor?: number;
  /** Optional override for the global explode axis. */
  axis?: MateAxis;
}

export interface ExplodedTrail {
  partId: string;
  /** Original centroid. */
  fromMm: [number, number, number];
  /** Exploded centroid. */
  toMm: [number, number, number];
}

export interface ExplodedView {
  offsets: Map<string, [number, number, number]>;
  trails: ExplodedTrail[];
  /** The axis used (unit vector). */
  axis: [number, number, number];
}

function dominantAxisFromMates(mates: AssemblyMate[]): [number, number, number] {
  if (mates.length === 0) return [0, 0, 1];
  const sum = [0, 0, 0];
  for (const m of mates) {
    sum[0]! += Math.abs(m.axis[0]);
    sum[1]! += Math.abs(m.axis[1]);
    sum[2]! += Math.abs(m.axis[2]);
  }
  const idx = sum.indexOf(Math.max(...sum));
  const out: [number, number, number] = [0, 0, 0];
  out[idx] = 1;
  return out;
}

function axisVector(a: MateAxis): [number, number, number] {
  switch (a) {
    case 'x': return [1, 0, 0];
    case 'y': return [0, 1, 0];
    case 'z': return [0, 0, 1];
    default: return [0, 0, 0]; // sentinel — caller derives
  }
}

export function computeExplodedView(
  parts: AssemblyPart[],
  mates: AssemblyMate[],
  opts: ExplodeOptions = {},
): ExplodedView {
  const factor = opts.factor ?? 1.5;
  let axis: [number, number, number];
  if (opts.axis && opts.axis !== 'auto') axis = axisVector(opts.axis);
  else axis = dominantAxisFromMates(mates);
  const axisIdx = axis[0] === 1 ? 0 : axis[1] === 1 ? 1 : 2;

  // Sort parts by signed projection on axis.
  const sorted = parts.slice().sort((a, b) => a.position[axisIdx]! - b.position[axisIdx]!);

  const offsets = new Map<string, [number, number, number]>();
  const trails: ExplodedTrail[] = [];

  // Cumulative offset along axis as we walk parts in axis order.
  let cumulative = 0;
  let prevPos: number | null = null;
  for (const part of sorted) {
    const pos = part.position[axisIdx]!;
    const extent = part.extentMm ?? 10;
    // Add a base spacing per part = factor × extent.
    if (prevPos !== null) {
      const gap = factor * extent;
      cumulative += gap;
    }
    const off: [number, number, number] = [
      axis[0] * cumulative,
      axis[1] * cumulative,
      axis[2] * cumulative,
    ];
    offsets.set(part.id, off);
    const exploded: [number, number, number] = [
      part.position[0] + off[0],
      part.position[1] + off[1],
      part.position[2] + off[2],
    ];
    trails.push({ partId: part.id, fromMm: part.position, toMm: exploded });
    prevPos = pos;
  }

  return { offsets, trails, axis };
}
