/**
 * mateDependencyGraph.ts — Build a directed dependency graph of
 * assembly mates and analyse for ordering, cycles, ground reach.
 *
 * Each mate constrains two bodies. The "dependency" arrow goes from
 * the body whose pose is already fixed (relative to the assembly
 * datum) to the body being constrained. Starting from ground, a
 * BFS/DFS reveals:
 *
 *   - Order in which bodies become fully constrained (rebuild order).
 *   - Bodies unreachable from ground (floating / under-constrained).
 *   - Cycles (over-constrained that shouldn't be solvable).
 *
 * Used by the solver scheduler to determine the rebuild order and
 * to flag illegal closed kinematic chains.
 */

export interface Mate {
  id: string;
  /** Body whose pose is established. */
  fromBody: string;
  /** Body being constrained relative to fromBody. */
  toBody: string;
  /** Mate kind for diagnostic. */
  kind: string;
}

export interface Body {
  id: string;
  /** Whether this body is the ground (fixed to assembly origin). */
  isGround?: boolean;
}

export interface DependencyResult {
  /** Order in which bodies become reachable from ground (rebuild order). */
  rebuildOrder: string[];
  /** Bodies not reachable from ground. */
  floatingBodies: string[];
  /** Cycles (lists of body IDs forming a back-edge cycle). */
  cycles: string[][];
  /** Per-body dependency depth (ground = 0). */
  depthByBody: Record<string, number>;
}

// ── Top-level entry ────────────────────────────────────────────

export function buildGraph(bodies: Body[], mates: Mate[]): DependencyResult {
  const adjacency = new Map<string, string[]>();
  for (const b of bodies) adjacency.set(b.id, []);
  for (const m of mates) {
    if (!adjacency.has(m.fromBody)) adjacency.set(m.fromBody, []);
    adjacency.get(m.fromBody)!.push(m.toBody);
  }

  // BFS from each ground body.
  const groundIds = bodies.filter(b => b.isGround).map(b => b.id);
  if (groundIds.length === 0 && bodies.length > 0) {
    // Treat first body as ground.
    groundIds.push(bodies[0]!.id);
  }
  const depth = new Map<string, number>();
  const order: string[] = [];
  const queue: string[] = [];
  for (const id of groundIds) {
    depth.set(id, 0);
    queue.push(id);
    order.push(id);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const neighbours = adjacency.get(cur) ?? [];
    for (const n of neighbours) {
      if (depth.has(n)) continue;
      depth.set(n, depth.get(cur)! + 1);
      order.push(n);
      queue.push(n);
    }
  }

  const floating: string[] = bodies.filter(b => !depth.has(b.id)).map(b => b.id);
  const cycles = findCycles(bodies, adjacency);
  const depthRecord: Record<string, number> = {};
  for (const [k, v] of depth) depthRecord[k] = v;

  return { rebuildOrder: order, floatingBodies: floating, cycles, depthByBody: depthRecord };
}

// ── Cycle detection ───────────────────────────────────────────

function findCycles(bodies: Body[], adjacency: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const colour = new Map<string, 'white' | 'grey' | 'black'>();
  const parent = new Map<string, string | null>();
  for (const b of bodies) {
    colour.set(b.id, 'white');
    parent.set(b.id, null);
  }
  for (const b of bodies) {
    if (colour.get(b.id) === 'white') {
      visit(b.id, adjacency, colour, parent, cycles);
    }
  }
  return cycles;
}

function visit(
  node: string,
  adjacency: Map<string, string[]>,
  colour: Map<string, 'white' | 'grey' | 'black'>,
  parent: Map<string, string | null>,
  cycles: string[][],
): void {
  colour.set(node, 'grey');
  const neighbours = adjacency.get(node) ?? [];
  for (const next of neighbours) {
    const c = colour.get(next);
    if (c === 'white') {
      parent.set(next, node);
      visit(next, adjacency, colour, parent, cycles);
    } else if (c === 'grey') {
      // Back edge → cycle from next to node.
      const cycle: string[] = [next];
      let cur: string | null = node;
      while (cur && cur !== next) {
        cycle.push(cur);
        cur = parent.get(cur) ?? null;
      }
      cycle.reverse();
      cycles.push(cycle);
    }
  }
  colour.set(node, 'black');
}

// ── DOF accumulator (per body) ────────────────────────────────

export interface BodyDof {
  bodyId: string;
  inboundMateCount: number;
  outboundMateCount: number;
  depth: number;
}

export function bodyDofUsage(bodies: Body[], mates: Mate[], result: DependencyResult): BodyDof[] {
  return bodies.map(b => {
    const inb = mates.filter(m => m.toBody === b.id).length;
    const out = mates.filter(m => m.fromBody === b.id).length;
    return {
      bodyId: b.id,
      inboundMateCount: inb,
      outboundMateCount: out,
      depth: result.depthByBody[b.id] ?? -1,
    };
  });
}

// ── Diagnostics ───────────────────────────────────────────────

export interface Diagnostic {
  severity: 'error' | 'warn' | 'info';
  message: string;
}

export function diagnoseGraph(result: DependencyResult, bodies: Body[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (result.floatingBodies.length > 0) {
    out.push({
      severity: 'warn',
      message: `${result.floatingBodies.length} body(ies) not reachable from ground: ${result.floatingBodies.join(', ')}.`,
    });
  }
  if (result.cycles.length > 0) {
    out.push({
      severity: 'error',
      message: `Found ${result.cycles.length} mate cycle(s); break cycles for solver to converge.`,
    });
  }
  if (bodies.every(b => !b.isGround)) {
    out.push({
      severity: 'info',
      message: 'No body explicitly marked as ground — first body used as datum.',
    });
  }
  return out;
}

// ── Summary ────────────────────────────────────────────────────

export interface GraphSummary {
  bodyCount: number;
  mateCount: number;
  rebuildOrderLength: number;
  floatingCount: number;
  cycleCount: number;
}

export function summarize(bodies: Body[], mates: Mate[], result: DependencyResult): GraphSummary {
  return {
    bodyCount: bodies.length,
    mateCount: mates.length,
    rebuildOrderLength: result.rebuildOrder.length,
    floatingCount: result.floatingBodies.length,
    cycleCount: result.cycles.length,
  };
}
