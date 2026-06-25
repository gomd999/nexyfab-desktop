/**
 * inferAssemblyMates — deterministic geometric mate inference for an
 * AI-composed heterogeneous assembly.
 *
 * Given the placed parts (shapeId + params + world position), detect the
 * obvious relationships a human would mate:
 *   - concentric  — two round parts that share an axis (a pin/bolt in a hole,
 *                   a coaxial stack)
 *   - distance    — the axial gap between two parts that line up on an axis
 *                   (stacked plates 5mm apart, a leg standing under a plate)
 *
 * Pure + headless-testable. This is the INFERENCE layer (increment 1 of mate
 * auto-constraint). It does NOT solve or reposition — it produces the mate
 * descriptors. Wiring them to a solver that holds the constraint when a
 * dimension changes (so the assembly stays mated, not just placed) is the
 * remaining work and needs face-topology resolution + the geometry solver
 * (applyGeometryMatesToPlaced) verified in a real browser, because the
 * reactive synthetic-axis path collapses off-axis parts.
 */

export interface InferMatePart {
  id: string;
  name?: string;
  shapeId: string;
  params: Record<string, number>;
  /** World position (mm), default [0,0,0]. */
  position?: [number, number, number];
}

export interface InferredMate {
  id: string;
  type: 'concentric' | 'distance';
  partA: string;
  partB: string;
  /** distance (mm) for `distance` mates — the measured axial gap. */
  value?: number;
  /** Which world axis the parts line up on (for diagnostics / future solving). */
  axis: 'x' | 'y' | 'z';
  /** 0..100 confidence in the inferred relationship. */
  confidence: number;
  locked: boolean;
}

/**
 * Fastener-style INSERTS — a bolt/screw/pin/rod is unambiguously meant to go
 * THROUGH another part, so when one lines up with another we can confidently
 * call it concentric. (Two plain cylinders sharing two coords are ambiguous —
 * coaxial stack vs parallel legs — and need the part's axis direction to tell
 * apart, which positions alone don't give. So we don't guess those.)
 */
const INSERT_SHAPES = new Set(['bolt', 'screw', 'threadedRod']);

const pos = (p: InferMatePart): [number, number, number] => p.position ?? [0, 0, 0];

/**
 * Infer mates across all part pairs. Two parts "line up on an axis" when their
 * coordinates match on the other two axes within `tolMm` — i.e. they're coaxial
 * / stacked along that axis. Round coaxial pairs get a concentric mate; every
 * lined-up pair gets a distance mate capturing the axial gap.
 */
export function inferAssemblyMates(parts: InferMatePart[], tolMm = 1.0): InferredMate[] {
  const mates: InferredMate[] = [];
  let n = 0;
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i]!;
      const b = parts[j]!;
      const pa = pos(a);
      const pb = pos(b);
      const d: [number, number, number] = [
        Math.abs(pa[0] - pb[0]),
        Math.abs(pa[1] - pb[1]),
        Math.abs(pa[2] - pb[2]),
      ];
      // Lined up on axis k ⟺ the OTHER two coords match within tol.
      for (let k = 0; k < 3; k++) {
        const other = [0, 1, 2].filter((x) => x !== k);
        const linedUp = d[other[0]!]! <= tolMm && d[other[1]!]! <= tolMm;
        if (!linedUp) continue;
        const gap = d[k]!;
        const hasInsert = INSERT_SHAPES.has(a.shapeId) || INSERT_SHAPES.has(b.shapeId);

        if (hasInsert) {
          // A fastener lined up with another part → it goes through it: concentric.
          mates.push({
            id: `imate_${n++}`,
            type: 'concentric',
            partA: a.id,
            partB: b.id,
            axis: axes[k]!,
            confidence: 85,
            locked: false,
          });
        }
        if (gap > tolMm) {
          // A real axial gap between lined-up parts → hold the distance.
          mates.push({
            id: `imate_${n++}`,
            type: 'distance',
            partA: a.id,
            partB: b.id,
            value: Math.round(gap * 1000) / 1000,
            axis: axes[k]!,
            confidence: 75,
            locked: false,
          });
        }
        break; // one lining-up axis per pair is enough
      }
    }
  }
  return mates;
}
