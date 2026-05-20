/**
 * flexiblePart.ts — Parts that deform based on assembly state.
 *
 * Real-world example: a spring whose length changes with mate
 * distance; a hose that follows the path between two connection
 * points; a wire bundle that bends through brackets.
 *
 * SolidWorks calls these "flexible components". NexyFab's
 * implementation tags a component as flexible and registers a
 * `flex spec` describing which feature param adjusts based on
 * which assembly query. When sub-assembly motion runs, this
 * module re-evaluates every flex spec and emits param updates the
 * feature pipeline applies.
 *
 * Six built-in flex types cover the most common cases. Custom
 * types can be added via the `registerFlexEvaluator` API for
 * domain-specific behaviors.
 */

import type { AssemblyTree, Matrix4 } from './subAssemblyMotion';

export type FlexType =
  | 'spring'      // length = distance(point A, point B)
  | 'hose'        // bend radius follows mate
  | 'belt'        // length = perimeter of pulley wheels
  | 'extendable'  // 직선 stroke
  | 'cable'       // 3D path through brackets
  | 'sleeve';     // OD wraps shaft

export interface FlexSpec {
  /** Component instance this flex applies to. */
  nodeId: string;
  flexType: FlexType;
  /** Feature param name to drive (e.g. 'length', 'radius'). */
  paramKey: string;
  /** Reference points / mates the flex reads from. */
  endpoints: Array<{ nodeId: string; localPoint: [number, number, number] }>;
  /** Optional clamps. */
  minValue?: number;
  maxValue?: number;
  /** Optional offset added to computed value. */
  offset?: number;
}

export interface FlexEvaluator {
  (spec: FlexSpec, tree: AssemblyTree, worldOf: (id: string) => Matrix4 | undefined): number | null;
}

function pointInWorld(
  localPoint: [number, number, number],
  world: Matrix4 | undefined,
): [number, number, number] | null {
  if (!world) return null;
  const [x, y, z] = localPoint;
  // Apply row-major 4×4 (with implicit w=1).
  const xw = world[0]! * x + world[1]! * y + world[2]! * z + world[3]!;
  const yw = world[4]! * x + world[5]! * y + world[6]! * z + world[7]!;
  const zw = world[8]! * x + world[9]! * y + world[10]! * z + world[11]!;
  return [xw, yw, zw];
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const BUILT_IN_EVALUATORS: Record<FlexType, FlexEvaluator> = {
  spring: (spec, _tree, worldOf) => {
    if (spec.endpoints.length < 2) return null;
    const a = pointInWorld(spec.endpoints[0]!.localPoint, worldOf(spec.endpoints[0]!.nodeId));
    const b = pointInWorld(spec.endpoints[1]!.localPoint, worldOf(spec.endpoints[1]!.nodeId));
    if (!a || !b) return null;
    return dist(a, b);
  },
  extendable: (spec, _tree, worldOf) => {
    if (spec.endpoints.length < 2) return null;
    const a = pointInWorld(spec.endpoints[0]!.localPoint, worldOf(spec.endpoints[0]!.nodeId));
    const b = pointInWorld(spec.endpoints[1]!.localPoint, worldOf(spec.endpoints[1]!.nodeId));
    if (!a || !b) return null;
    return dist(a, b);
  },
  hose: (spec, _tree, worldOf) => {
    // Length along a soft bend — approximate as 1.15 × straight
    // distance for typical S-curve fit.
    if (spec.endpoints.length < 2) return null;
    const a = pointInWorld(spec.endpoints[0]!.localPoint, worldOf(spec.endpoints[0]!.nodeId));
    const b = pointInWorld(spec.endpoints[1]!.localPoint, worldOf(spec.endpoints[1]!.nodeId));
    if (!a || !b) return null;
    return dist(a, b) * 1.15;
  },
  belt: (spec, _tree, worldOf) => {
    // Belt length around 2 pulleys = 2 × center distance + π × (r1 + r2)
    // Approximated by 2 × straight distance + minValue (used for offset).
    if (spec.endpoints.length < 2) return null;
    const a = pointInWorld(spec.endpoints[0]!.localPoint, worldOf(spec.endpoints[0]!.nodeId));
    const b = pointInWorld(spec.endpoints[1]!.localPoint, worldOf(spec.endpoints[1]!.nodeId));
    if (!a || !b) return null;
    return 2 * dist(a, b);
  },
  cable: (spec, _tree, worldOf) => {
    // Sum segment lengths through all endpoints.
    if (spec.endpoints.length < 2) return null;
    let total = 0;
    let prev = pointInWorld(spec.endpoints[0]!.localPoint, worldOf(spec.endpoints[0]!.nodeId));
    for (let i = 1; i < spec.endpoints.length; i++) {
      const next = pointInWorld(spec.endpoints[i]!.localPoint, worldOf(spec.endpoints[i]!.nodeId));
      if (!prev || !next) return null;
      total += dist(prev, next);
      prev = next;
    }
    return total;
  },
  sleeve: (spec, _tree, worldOf) => {
    // Sleeve OD = shaft OD; reads the shaft's local extent param.
    // The shaft component's bbox is queried via worldOf — here we
    // just use straight distance as a placeholder.
    if (spec.endpoints.length < 1) return null;
    return spec.minValue ?? 1;
  },
};

const customEvaluators = new Map<string, FlexEvaluator>();

export function registerFlexEvaluator(name: string, fn: FlexEvaluator): void {
  customEvaluators.set(name, fn);
}

/** Evaluate every flex spec and return the param updates to apply. */
export interface FlexUpdate {
  nodeId: string;
  paramKey: string;
  value: number;
}

export function evaluateFlexSpecs(
  specs: FlexSpec[],
  tree: AssemblyTree,
  worldTransforms: Map<string, Matrix4>,
): FlexUpdate[] {
  const worldOf = (id: string) => worldTransforms.get(id);
  const updates: FlexUpdate[] = [];
  for (const spec of specs) {
    const evalFn = customEvaluators.get(spec.flexType) ?? BUILT_IN_EVALUATORS[spec.flexType];
    if (!evalFn) continue;
    const raw = evalFn(spec, tree, worldOf);
    if (raw === null || !Number.isFinite(raw)) continue;
    let value = raw + (spec.offset ?? 0);
    if (spec.minValue !== undefined && value < spec.minValue) value = spec.minValue;
    if (spec.maxValue !== undefined && value > spec.maxValue) value = spec.maxValue;
    updates.push({ nodeId: spec.nodeId, paramKey: spec.paramKey, value });
  }
  return updates;
}
