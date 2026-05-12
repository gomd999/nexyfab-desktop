/**
 * Ω1 — Topology optimization interface.
 *
 * Given a design domain (bbox), load points + magnitudes, and fixed
 * supports, propose N candidate geometries on the Pareto front of
 * (mass minimum, max stress under target). Agent uses this to seed
 * generative design exploration before refining one candidate manually.
 *
 * Real solver: OSS toolkits like ToPy (SIMP method), OpenLSTO (level-set),
 * FreeCAD OptiSwarm. This module ships a heuristic mock that:
 *   - splits the design domain into voxels (configurable resolution)
 *   - for each candidate, removes a random subset of voxels weighted by
 *     distance from the load-bearing path
 *   - reports estimated mass + max stress (toy linear-elastic estimate)
 *
 * The mock is shape-correct for the agent's tool contract — swap in
 * a real Docker-backed solver via the dockerSolverAdapter pattern (Π1)
 * when ToPy is wired.
 */

export interface TopOptInput {
  /** Design domain in mm. */
  domain: { w: number; h: number; d: number };
  /** Voxel resolution per axis (default 16, max 64). */
  resolution?: number;
  /** Material to optimize for. */
  material: 'aluminum_6061' | 'steel_a36' | 'steel_4140' | 'pla';
  /** Allowable max von-Mises stress (MPa). */
  maxStressMPa: number;
  /** Loads applied to the body. */
  loads: Array<{
    /** Position in domain coords (mm from origin). */
    location: [number, number, number];
    /** Force vector in Newtons. */
    force: [number, number, number];
  }>;
  /** Fixed supports — locations that don't move. */
  supports: Array<{
    location: [number, number, number];
  }>;
  /** Number of candidate designs to return (default 4, max 8). */
  candidateCount?: number;
  /** Random seed for reproducible mocks. */
  seed?: number;
}

export interface TopOptCandidate {
  id: string;
  /** Estimated mass in grams. */
  massG: number;
  /** Worst-case max von-Mises stress in MPa under given loads. */
  maxStressMPa: number;
  /** Safety factor = material yield / maxStressMPa. */
  safetyFactor: number;
  /** Material removal fraction (0 = full block, 1 = empty). */
  removalFraction: number;
  /** Compact representation: which voxels to keep (1) vs remove (0).
   *  Layout: x major, y mid, z minor. Length = res³. */
  voxelMask: Uint8Array;
}

export interface TopOptOutput {
  candidates: TopOptCandidate[];
  /** Pareto front: candidates sorted by mass (ascending). */
  paretoFront: string[];
  /** Total candidates evaluated (≥ candidateCount). */
  evaluations: number;
  notes: string;
}

const MATERIAL_PROPS: Record<TopOptInput['material'], { densityGCm3: number; yieldMPa: number }> = {
  aluminum_6061: { densityGCm3: 2.70, yieldMPa: 276 },
  steel_a36:     { densityGCm3: 7.85, yieldMPa: 250 },
  steel_4140:    { densityGCm3: 7.85, yieldMPa: 655 },
  pla:           { densityGCm3: 1.24, yieldMPa: 50 },
};

function rng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function optimizeTopology(input: TopOptInput): TopOptOutput {
  const res = Math.max(4, Math.min(64, input.resolution ?? 16));
  const candidateCount = Math.max(1, Math.min(8, input.candidateCount ?? 4));
  const props = MATERIAL_PROPS[input.material];
  if (!props) throw new Error(`unknown material ${input.material}`);

  const random = rng(input.seed ?? 42);
  const voxelVolumeMm3 = (input.domain.w * input.domain.h * input.domain.d) / (res ** 3);

  // Build load-path heatmap: voxels closer to (load → support) line
  // segments are marked as "load-bearing" and biased away from removal.
  const heatmap = buildLoadHeatmap(input, res);

  const candidates: TopOptCandidate[] = [];
  for (let i = 0; i < candidateCount; i++) {
    // Vary removal fraction across candidates so the Pareto front spans
    // mass minimization vs strength preservation.
    const targetRemoval = 0.2 + (i / Math.max(1, candidateCount - 1)) * 0.6;
    const mask = makeCandidateMask(heatmap, targetRemoval, random, res);
    const keptCount = mask.reduce((s, v) => s + v, 0);
    const removalFraction = 1 - keptCount / mask.length;
    const massG = (keptCount * voxelVolumeMm3 * props.densityGCm3) / 1000;

    // Toy stress estimate: a removed load-bearing voxel concentrates
    // stress on its neighbors. Sum heatmap of removed voxels → stress
    // multiplier on a baseline computed from total load / cross section.
    const totalLoadN = input.loads.reduce((s, l) => s + Math.hypot(...l.force), 0);
    const baselineMPa = (totalLoadN * 1.5) / Math.max(1, keptCount * voxelVolumeMm3 / 1e6);
    let removedHeat = 0;
    for (let v = 0; v < mask.length; v++) {
      if (mask[v] === 0) removedHeat += heatmap[v];
    }
    const concentrationMultiplier = 1 + removedHeat / Math.max(1, heatmap.reduce((s, h) => s + h, 0));
    const maxStressMPa = baselineMPa * concentrationMultiplier;
    const safetyFactor = props.yieldMPa / Math.max(0.001, maxStressMPa);

    candidates.push({
      id: `cand_${i + 1}`,
      massG,
      maxStressMPa,
      safetyFactor,
      removalFraction,
      voxelMask: new Uint8Array(mask),
    });
  }

  // Pareto sort by mass ascending; caller can re-rank by any objective.
  const paretoFront = candidates
    .filter(c => c.maxStressMPa <= input.maxStressMPa)
    .sort((a, b) => a.massG - b.massG)
    .map(c => c.id);

  return {
    candidates,
    paretoFront,
    evaluations: candidates.length,
    notes: paretoFront.length === 0
      ? `No candidate met maxStressMPa=${input.maxStressMPa}. Loosen the constraint or use a stronger material. (mock: real ToPy would refine convergence)`
      : `${paretoFront.length}/${candidates.length} candidates feasible. (mock SIMP heuristic — replace with ToPy/OpenLSTO Docker for production)`,
  };
}

function buildLoadHeatmap(input: TopOptInput, res: number): Float32Array {
  const heat = new Float32Array(res ** 3);
  const w = input.domain.w / res, h = input.domain.h / res, d = input.domain.d / res;

  // Score each voxel by how close it is to any (load → support) line.
  for (let xi = 0; xi < res; xi++) {
    const x = (xi + 0.5) * w;
    for (let yi = 0; yi < res; yi++) {
      const y = (yi + 0.5) * h;
      for (let zi = 0; zi < res; zi++) {
        const z = (zi + 0.5) * d;
        let score = 0;
        for (const load of input.loads) {
          for (const sup of input.supports) {
            const distToLine = pointToSegmentDist([x, y, z], load.location, sup.location);
            const forceMag = Math.hypot(...load.force);
            score += forceMag / Math.max(1, distToLine * distToLine);
          }
        }
        heat[xi * res * res + yi * res + zi] = score;
      }
    }
  }
  return heat;
}

function pointToSegmentDist(p: [number, number, number], a: [number, number, number], b: [number, number, number]): number {
  const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: [number, number, number] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.max(0, Math.min(1,
    (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) /
    Math.max(1e-9, ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2])
  ));
  const nearest: [number, number, number] = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]];
  return Math.hypot(p[0] - nearest[0], p[1] - nearest[1], p[2] - nearest[2]);
}

function makeCandidateMask(heat: Float32Array, targetRemoval: number, rand: () => number, res: number): number[] {
  // Build a noisy heat that shifts each voxel's score by a small random
  // amount per candidate so different seeds remove a slightly different
  // voxel set — not just a different order. The noise scale is small
  // enough that the load-bearing structure still wins, but big enough
  // that border voxels around the edge of the kept zone vary across
  // candidates (which is what real SIMP would do via initial conditions).
  const noisyHeat = new Float32Array(heat.length);
  let maxHeat = 0;
  for (let i = 0; i < heat.length; i++) if (heat[i] > maxHeat) maxHeat = heat[i];
  const noiseScale = maxHeat * 0.15;  // 15% jitter relative to peak
  for (let i = 0; i < heat.length; i++) {
    noisyHeat[i] = heat[i] + (rand() - 0.5) * noiseScale;
  }

  const indices = Array.from({ length: heat.length }, (_, i) => i);
  indices.sort((a, b) => noisyHeat[a] - noisyHeat[b]);
  const removeCount = Math.floor(heat.length * targetRemoval);
  const mask = new Array(heat.length).fill(1);
  for (let i = 0; i < removeCount; i++) {
    mask[indices[i]] = 0;
  }
  void res;
  return mask;
}
