/**
 * bendSequence.ts — Press-brake bend sequence planner.
 *
 * A sheet-metal part with N bends has N! possible bend orders. The
 * order matters because:
 *
 *   - **Tool collision** — once a flange is bent up, it can hit the
 *     punch / die on subsequent bends. Some orders are physically
 *     impossible without re-orienting the part.
 *   - **Operator fatigue / handling** — bending against a long
 *     flange is harder than against a short one; small parts may
 *     fall through the die after certain bends.
 *   - **Tolerance stack** — angular error accumulates. Locating off a
 *     reliable edge first then bending away reduces stack-up.
 *   - **Tool changes** — different bend angles or punch radii share
 *     a setup; grouping minimizes ATC dwell.
 *
 * Inputs:
 *   - Bend list with line position (along the unfolded part), angle,
 *     direction (up/down), tool id, flange length.
 *   - Optional precedence constraints (e.g. bottom-up offset must
 *     come before top forming).
 *
 * Outputs:
 *   - Ordered bend list + collision report + setup-change count.
 *
 * Algorithm: a simple heuristic combining:
 *   - Smallest-flange-first to avoid early collisions.
 *   - Same-tool clustering for setup-time reduction.
 *   - Precedence enforcement via topological sort.
 */

export type BendDirection = 'up' | 'down';

export interface Bend {
  id: string;
  /** Distance from datum edge along unfolded length (mm). */
  positionMm: number;
  /** Bend angle (deg). */
  angleDeg: number;
  /** Direction relative to part normal. */
  direction: BendDirection;
  /** Punch tool id. */
  toolId: string;
  /** Flange length created by this bend (mm). */
  flangeLengthMm: number;
  /** Hard precedence: must be after these ids. */
  afterIds?: string[];
}

export interface BendSequenceOptions {
  /** Punch travel clearance (mm). Below this, collision flagged. */
  punchClearanceMm: number;
  /** Die opening width (mm). */
  dieOpeningMm: number;
  /** Strategy weight: 0 = pure flange-order, 1 = pure tool-cluster. */
  toolClusterWeight: number;
}

export const DEFAULT_BEND_SEQ_OPTIONS: BendSequenceOptions = {
  punchClearanceMm: 25,
  dieOpeningMm: 8,
  toolClusterWeight: 0.5,
};

export interface BendSequenceResult {
  /** Ordered bend ids. */
  order: string[];
  /** Tool changes between consecutive bends. */
  toolChangeCount: number;
  /** Bends that collide with punch / die at their current order. */
  collisions: Array<{ bendId: string; reason: string }>;
  /** Total flange-clearance margin (sum of safe clearances). */
  totalClearanceMm: number;
  /** Whether all precedence constraints are honoured. */
  precedenceSatisfied: boolean;
}

// ── Collision detection ─────────────────────────────────────────

/** A flange "stands up" after its bend. Subsequent bends at positions
 *  within the flange's reach must clear it. */
export function detectCollision(
  candidate: Bend,
  alreadyBentBends: Bend[],
  opts: BendSequenceOptions,
): string | null {
  // For each already-bent bend, check if its raised flange would interfere.
  for (const prev of alreadyBentBends) {
    // Flange on the candidate side?
    const flangeReach = prev.flangeLengthMm * Math.sin(toRad(prev.angleDeg));
    const distance = Math.abs(candidate.positionMm - prev.positionMm);
    // If the candidate is positioned within the raised flange's footprint
    // AND on the side that would touch the punch, flag.
    if (distance < flangeReach && distance < opts.punchClearanceMm) {
      // Same direction at proximity is the worst case.
      if (prev.direction === candidate.direction) {
        return `Flange from bend ${prev.id} (reach ${flangeReach.toFixed(1)}mm) collides with punch at ${distance.toFixed(1)}mm`;
      }
    }
    // Die-opening collision: if a previously bent flange points down
    // into the die, the part can't sit flat.
    if (prev.direction === 'down' && distance < opts.dieOpeningMm / 2) {
      return `Bend ${prev.id} flange occupies die opening`;
    }
  }
  return null;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ── Sequencing ──────────────────────────────────────────────────

export function planBendSequence(
  bends: Bend[],
  options: Partial<BendSequenceOptions> = {},
): BendSequenceResult {
  const opts = { ...DEFAULT_BEND_SEQ_OPTIONS, ...options };
  if (bends.length === 0) {
    return { order: [], toolChangeCount: 0, collisions: [], totalClearanceMm: 0, precedenceSatisfied: true };
  }

  // Step 1: precedence-aware topological seed, breaking ties by short flange first.
  const seed = topologicalSeed(bends);
  // Step 2: local optimization swaps within precedence constraints.
  const refined = swapImprovement(seed, bends, opts);

  // Step 3: collision detection.
  const order = refined;
  const collisions: Array<{ bendId: string; reason: string }> = [];
  const placed: Bend[] = [];
  let totalClearance = 0;
  for (const id of order) {
    const b = bends.find(x => x.id === id);
    if (!b) continue;
    const reason = detectCollision(b, placed, opts);
    if (reason) collisions.push({ bendId: id, reason });
    else totalClearance += opts.punchClearanceMm;
    placed.push(b);
  }

  // Tool changes.
  let toolChanges = 0;
  for (let i = 1; i < order.length; i++) {
    const prev = bends.find(b => b.id === order[i - 1]);
    const cur = bends.find(b => b.id === order[i]);
    if (prev && cur && prev.toolId !== cur.toolId) toolChanges++;
  }

  const precedenceSatisfied = isPrecedenceValid(order, bends);

  return {
    order,
    toolChangeCount: toolChanges,
    collisions,
    totalClearanceMm: totalClearance,
    precedenceSatisfied,
  };
}

function topologicalSeed(bends: Bend[]): string[] {
  // Group by tool first, then within each group sort by flange length asc.
  const byTool = new Map<string, Bend[]>();
  for (const b of bends) {
    if (!byTool.has(b.toolId)) byTool.set(b.toolId, []);
    byTool.get(b.toolId)!.push(b);
  }
  for (const list of byTool.values()) {
    list.sort((a, b) => a.flangeLengthMm - b.flangeLengthMm);
  }
  const initial: string[] = [];
  for (const list of byTool.values()) {
    for (const b of list) initial.push(b.id);
  }
  // Enforce precedence.
  return topoEnforce(initial, bends);
}

function topoEnforce(order: string[], bends: Bend[]): string[] {
  const bendMap = new Map(bends.map(b => [b.id, b]));
  const result: string[] = [];
  const seen = new Set<string>();
  let progress = true;
  while (progress && result.length < bends.length) {
    progress = false;
    for (const id of order) {
      if (seen.has(id)) continue;
      const b = bendMap.get(id);
      if (!b) continue;
      const deps = b.afterIds ?? [];
      if (deps.every(d => seen.has(d))) {
        result.push(id);
        seen.add(id);
        progress = true;
      }
    }
  }
  for (const id of order) if (!seen.has(id)) result.push(id);
  return result;
}

function isPrecedenceValid(order: string[], bends: Bend[]): boolean {
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const b of bends) {
    for (const dep of b.afterIds ?? []) {
      const depPos = pos.get(dep);
      const bPos = pos.get(b.id);
      if (depPos === undefined || bPos === undefined) continue;
      if (depPos >= bPos) return false;
    }
  }
  return true;
}

function swapImprovement(order: string[], bends: Bend[], opts: BendSequenceOptions): string[] {
  let best = order.slice();
  let bestScore = scoreOrder(best, bends, opts);
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      const trial = best.slice();
      [trial[i], trial[i + 1]] = [trial[i + 1]!, trial[i]!];
      if (!isPrecedenceValid(trial, bends)) continue;
      const score = scoreOrder(trial, bends, opts);
      if (score < bestScore - 1e-6) {
        best = trial;
        bestScore = score;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return best;
}

function scoreOrder(order: string[], bends: Bend[], opts: BendSequenceOptions): number {
  // Score = collisions × heavy_penalty + tool_changes × cluster_weight + flange_growth_penalty.
  const bendMap = new Map(bends.map(b => [b.id, b]));
  let score = 0;
  const placed: Bend[] = [];
  let lastTool: string | null = null;
  for (const id of order) {
    const b = bendMap.get(id);
    if (!b) continue;
    if (detectCollision(b, placed, opts)) score += 1000;
    if (lastTool !== null && lastTool !== b.toolId) score += opts.toolClusterWeight * 10;
    placed.push(b);
    lastTool = b.toolId;
  }
  return score;
}

// ── Bend deduction lookup ───────────────────────────────────────

/** Bend deduction (mm) given material thickness, angle, and K-factor.
 *  This is a placeholder — production uses a full bend-deduction table. */
export function bendDeduction(thicknessMm: number, angleDeg: number, kFactor: number = 0.44): number {
  const radius = thicknessMm; // assume R = T as a default.
  const angleRad = toRad(angleDeg);
  const ba = (Math.PI / 180) * angleDeg * (radius + kFactor * thicknessMm);
  const ssb = (radius + thicknessMm) * Math.tan(angleRad / 2);
  return 2 * ssb - ba;
}

// ── Reporting ───────────────────────────────────────────────────

export interface BendSetupSummary {
  setupCount: number;
  setupGroups: Array<{ toolId: string; bendIds: string[] }>;
}

export function summarizeSetups(order: string[], bends: Bend[]): BendSetupSummary {
  const bendMap = new Map(bends.map(b => [b.id, b]));
  const groups: Array<{ toolId: string; bendIds: string[] }> = [];
  let current: { toolId: string; bendIds: string[] } | null = null;
  for (const id of order) {
    const b = bendMap.get(id);
    if (!b) continue;
    if (!current || current.toolId !== b.toolId) {
      current = { toolId: b.toolId, bendIds: [id] };
      groups.push(current);
    } else {
      current.bendIds.push(id);
    }
  }
  return { setupCount: groups.length, setupGroups: groups };
}
