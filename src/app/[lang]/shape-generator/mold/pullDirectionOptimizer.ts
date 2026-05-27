/**
 * pullDirectionOptimizer.ts — Search the best mold pull direction.
 *
 * For injection molding the chosen pull direction shapes the mold
 * cost (more undercuts → more side actions / slides → more cost).
 * Designers often default to "up along Z" but a 5° tilt or a
 * different axis can dramatically cut undercuts.
 *
 * This module evaluates candidate pull directions:
 *
 *   - **Score** = positive-draft-area − undercut-area − zero-draft-area.
 *   - **Candidates** = uniformly-sampled directions on the unit sphere
 *     (Fibonacci lattice) + the 6 axis-aligned options as priors.
 *
 * Output: ranked pull-direction candidates with per-axis scores. The
 * UI shows the top 3 with arrows over the part for the user to pick.
 */

export type Vec3 = [number, number, number];

export interface FaceSample {
  /** Outward face normal. */
  normal: Vec3;
  /** Face area (mm²). */
  areaMm2: number;
}

export interface PullDirectionCandidate {
  direction: Vec3;
  /** Total positive-draft area (area × dot(normal, pull) where positive). */
  positiveDraftArea: number;
  /** Total undercut area (negative draft). */
  undercutArea: number;
  /** Total zero-draft area (within ±tolerance). */
  zeroDraftArea: number;
  /** Score = positive − undercut − zero. Bigger is better. */
  score: number;
  /** Direction label (e.g. "+Z" for axis-aligned). */
  label?: string;
}

export interface OptimizerOptions {
  /** Tolerance in degrees for "zero" classification. */
  zeroToleranceDeg: number;
  /** Number of Fibonacci-lattice samples beyond the 6 axis candidates. */
  sampleCount: number;
}

export const DEFAULT_OPTIMIZER_OPTIONS: OptimizerOptions = {
  zeroToleranceDeg: 1,
  sampleCount: 64,
};

// ── Top-level entry ─────────────────────────────────────────────

export function optimizePullDirection(
  faces: FaceSample[],
  options: Partial<OptimizerOptions> = {},
): PullDirectionCandidate[] {
  const opts = { ...DEFAULT_OPTIMIZER_OPTIONS, ...options };
  const candidates = generateCandidates(opts.sampleCount);
  const scored = candidates.map(c => evaluateCandidate(c.direction, c.label, faces, opts));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function evaluateCandidate(
  direction: Vec3,
  label: string | undefined,
  faces: FaceSample[],
  opts: OptimizerOptions,
): PullDirectionCandidate {
  const d = normalize(direction);
  const cosTol = Math.cos((90 - opts.zeroToleranceDeg) * Math.PI / 180);
  let pos = 0, neg = 0, zero = 0;
  for (const face of faces) {
    const n = normalize(face.normal);
    const dotV = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
    if (Math.abs(dotV) < cosTol) {
      zero += face.areaMm2;
    } else if (dotV > 0) {
      pos += face.areaMm2 * dotV;
    } else {
      neg += face.areaMm2 * -dotV;
    }
  }
  const result: PullDirectionCandidate = {
    direction: d,
    positiveDraftArea: pos,
    undercutArea: neg,
    zeroDraftArea: zero,
    score: pos - neg - zero * 0.5,
  };
  if (label !== undefined) result.label = label;
  return result;
}

// ── Candidate generation ────────────────────────────────────────

export function generateCandidates(sampleCount: number): Array<{ direction: Vec3; label?: string }> {
  const candidates: Array<{ direction: Vec3; label?: string }> = [
    { direction: [1, 0, 0], label: '+X' },
    { direction: [-1, 0, 0], label: '-X' },
    { direction: [0, 1, 0], label: '+Y' },
    { direction: [0, -1, 0], label: '-Y' },
    { direction: [0, 0, 1], label: '+Z' },
    { direction: [0, 0, -1], label: '-Z' },
  ];
  // Fibonacci lattice on unit sphere.
  const golden = (1 + Math.sqrt(5)) / 2;
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    const phi = Math.acos(1 - 2 * t);
    const theta = 2 * Math.PI * i / golden;
    candidates.push({
      direction: [
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      ],
    });
  }
  return candidates;
}

// ── Side-action recommendation ──────────────────────────────────

export interface SideActionRecommendation {
  /** Direction (unit vec). */
  direction: Vec3;
  /** Area of faces that would mold cleanly with this side action. */
  rescuedArea: number;
  /** True if this side action would replace more area than it adds. */
  beneficial: boolean;
}

/** After picking a main pull direction, identify what additional side
 *  actions would unlock more area. Tries the 5 best alternative axes
 *  perpendicular to the main pull. */
export function recommendSideActions(
  mainPull: Vec3,
  faces: FaceSample[],
  opts: OptimizerOptions = DEFAULT_OPTIMIZER_OPTIONS,
): SideActionRecommendation[] {
  const main = normalize(mainPull);
  const candidates: Vec3[] = [];
  // Sample perpendicular plane.
  const u = pickPerpendicular(main);
  const v = cross(main, u);
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * 2 * Math.PI;
    candidates.push([
      u[0] * Math.cos(angle) + v[0] * Math.sin(angle),
      u[1] * Math.cos(angle) + v[1] * Math.sin(angle),
      u[2] * Math.cos(angle) + v[2] * Math.sin(angle),
    ]);
  }

  // Faces currently in undercut on main pull = candidates for rescue.
  const undercuts = faces.filter(f => {
    const n = normalize(f.normal);
    return n[0] * main[0] + n[1] * main[1] + n[2] * main[2] < 0;
  });

  const recs: SideActionRecommendation[] = [];
  for (const dir of candidates) {
    let rescuedArea = 0;
    for (const f of undercuts) {
      const n = normalize(f.normal);
      const dotV = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
      if (dotV > Math.cos((opts.zeroToleranceDeg * Math.PI) / 180)) {
        rescuedArea += f.areaMm2 * dotV;
      }
    }
    recs.push({
      direction: dir,
      rescuedArea,
      beneficial: rescuedArea > 0,
    });
  }
  recs.sort((a, b) => b.rescuedArea - a.rescuedArea);
  return recs;
}

// ── Vector helpers ──────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function pickPerpendicular(n: Vec3): Vec3 {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const seed: Vec3 = ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1];
  const d = n[0] * seed[0] + n[1] * seed[1] + n[2] * seed[2];
  return normalize([seed[0] - d * n[0], seed[1] - d * n[1], seed[2] - d * n[2]]);
}
