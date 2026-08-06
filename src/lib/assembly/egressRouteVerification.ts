export interface EgressPoint2 { x: number; y: number }
export interface EgressNode { id: string; point: EgressPoint2; kind?: 'origin' | 'exit' | 'junction' }
export interface EgressEdge { id: string; from: string; to: string; clearWidthMm: number; blocked?: boolean; oneWay?: boolean }
export interface EgressRouteInput {
  nodes: EgressNode[];
  edges: EgressEdge[];
  originNodeIds: string[];
  exitNodeIds: string[];
  maximumTravelDistanceMm: number;
  minimumClearWidthMm: number;
  minimumIndependentExits?: number;
}
export interface EgressOriginResult {
  originNodeId: string;
  passed: boolean;
  exitNodeId?: string;
  pathNodeIds: string[];
  pathEdgeIds: string[];
  travelDistanceMm?: number;
  bottleneckWidthMm?: number;
  failure?: 'NO_ROUTE' | 'TRAVEL_DISTANCE_EXCEEDED';
}
export interface EgressRouteResult {
  passed: boolean;
  originResults: EgressOriginResult[];
  reachableExitCount: number;
  requiredIndependentExits: number;
  failures: Array<'UNKNOWN_NODE' | 'DUPLICATE_NODE' | 'INVALID_EDGE' | 'INSUFFICIENT_EXITS' | 'NO_ROUTE' | 'TRAVEL_DISTANCE_EXCEEDED'>;
  method: 'governed_width_filtered_dijkstra';
  conservative: true;
}

const distance = (a: EgressPoint2, b: EgressPoint2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Computes every governed egress route; edges below the required clear width are unavailable. */
export function verifyEgressRoutes(input: EgressRouteInput): EgressRouteResult {
  if (!(input.maximumTravelDistanceMm > 0) || !(input.minimumClearWidthMm > 0)
    || !Number.isFinite(input.maximumTravelDistanceMm) || !Number.isFinite(input.minimumClearWidthMm)) throw new Error('Governed egress limits must be finite and positive.');
  const failures = new Set<EgressRouteResult['failures'][number]>();
  const nodes = new Map<string, EgressNode>();
  input.nodes.forEach(node => { if (nodes.has(node.id)) failures.add('DUPLICATE_NODE'); else nodes.set(node.id, node); });
  const adjacency = new Map<string, Array<{ node: string; edge: string; length: number; width: number }>>();
  nodes.forEach((_, id) => adjacency.set(id, []));
  for (const edge of input.edges) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to || !(edge.clearWidthMm > 0) || !Number.isFinite(edge.clearWidthMm) || edge.from === edge.to) { failures.add('INVALID_EDGE'); continue; }
    if (edge.blocked || edge.clearWidthMm < input.minimumClearWidthMm) continue;
    const length = distance(from.point, to.point);
    if (!(length > 0) || !Number.isFinite(length)) { failures.add('INVALID_EDGE'); continue; }
    adjacency.get(edge.from)!.push({ node: edge.to, edge: edge.id, length, width: edge.clearWidthMm });
    if (!edge.oneWay) adjacency.get(edge.to)!.push({ node: edge.from, edge: edge.id, length, width: edge.clearWidthMm });
  }
  const exitSet = new Set(input.exitNodeIds.filter(id => nodes.has(id)));
  if (exitSet.size !== input.exitNodeIds.length || input.originNodeIds.some(id => !nodes.has(id))) failures.add('UNKNOWN_NODE');
  const reachableExits = new Set<string>();
  const originResults = input.originNodeIds.map(originNodeId => {
    if (!nodes.has(originNodeId)) return { originNodeId, passed: false, pathNodeIds: [], pathEdgeIds: [], failure: 'NO_ROUTE' as const };
    const costs = new Map<string, number>([[originNodeId, 0]]), previous = new Map<string, { node: string; edge: string; width: number }>(), pending = new Set(nodes.keys());
    while (pending.size) {
      let current: string | undefined, best = Number.POSITIVE_INFINITY;
      pending.forEach(id => { const cost = costs.get(id) ?? Number.POSITIVE_INFINITY; if (cost < best) { best = cost; current = id; } });
      if (current === undefined) break; pending.delete(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!pending.has(neighbor.node)) continue;
        const candidate = best + neighbor.length;
        if (candidate < (costs.get(neighbor.node) ?? Number.POSITIVE_INFINITY)) { costs.set(neighbor.node, candidate); previous.set(neighbor.node, { node: current, edge: neighbor.edge, width: neighbor.width }); }
      }
    }
    let exitNodeId: string | undefined, travelDistance = Number.POSITIVE_INFINITY;
    exitSet.forEach(id => { const cost = costs.get(id) ?? Number.POSITIVE_INFINITY; if (Number.isFinite(cost)) reachableExits.add(id); if (cost < travelDistance) { travelDistance = cost; exitNodeId = id; } });
    if (!exitNodeId || !Number.isFinite(travelDistance)) { failures.add('NO_ROUTE'); return { originNodeId, passed: false, pathNodeIds: [], pathEdgeIds: [], failure: 'NO_ROUTE' as const }; }
    const pathNodes = [exitNodeId], pathEdges: string[] = []; let cursor = exitNodeId, bottleneck = Number.POSITIVE_INFINITY;
    while (cursor !== originNodeId) { const step = previous.get(cursor); if (!step) break; pathEdges.unshift(step.edge); bottleneck = Math.min(bottleneck, step.width); cursor = step.node; pathNodes.unshift(cursor); }
    const passed = travelDistance <= input.maximumTravelDistanceMm;
    if (!passed) failures.add('TRAVEL_DISTANCE_EXCEEDED');
    return { originNodeId, passed, exitNodeId, pathNodeIds: pathNodes, pathEdgeIds: pathEdges, travelDistanceMm: travelDistance, bottleneckWidthMm: bottleneck, ...(!passed ? { failure: 'TRAVEL_DISTANCE_EXCEEDED' as const } : {}) };
  });
  const requiredIndependentExits = Math.max(1, Math.floor(input.minimumIndependentExits ?? 1));
  if (exitSet.size < requiredIndependentExits || reachableExits.size < requiredIndependentExits) failures.add('INSUFFICIENT_EXITS');
  return { passed: failures.size === 0 && originResults.length > 0 && originResults.every(result => result.passed), originResults, reachableExitCount: reachableExits.size, requiredIndependentExits, failures: [...failures], method: 'governed_width_filtered_dijkstra', conservative: true };
}
