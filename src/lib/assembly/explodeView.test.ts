/**
 * Smoke / correctness tests for explodeView (verification pass).
 * Covers axis heuristics, distance, ordering (leaf-first), interpolation,
 * and manual overrides.
 */
import { describe, it, expect } from 'vitest';
import {
  buildExplodedState,
  computeExplodeAxis,
  computeExplodeDistance,
  orderExplodeSteps,
  interpolateExplode,
  type ExplodeConfig,
} from './explodeView';
import { partInstance, IDENTITY_QUAT, type AssemblyState, type PartInstance } from './assemblyState';
import type { Mate } from './mate';
import { aabb, type AABB } from './interference';

const P = (id: string, pos: [number, number, number], fixed = false): PartInstance =>
  partInstance({
    id,
    name: id,
    partTemplateId: 't',
    position: { x: pos[0], y: pos[1], z: pos[2] },
    orientation: IDENTITY_QUAT,
    fixed,
  });

const coincident = (id: string, a: string, b: string): Mate =>
  ({
    id,
    kind: 'coincident',
    a: { partId: a, refId: `${a}.f`, refKind: 'face' },
    b: { partId: b, refId: `${b}.f`, refKind: 'face' },
  }) as Mate;

// A ── B ── C  chain, A fixed (root).
const chainState = (): AssemblyState => ({
  parts: [P('A', [0, 0, 0], true), P('B', [10, 0, 0]), P('C', [20, 0, 0])],
  mates: [coincident('m1', 'A', 'B'), coincident('m2', 'B', 'C')],
});

describe('computeExplodeAxis', () => {
  it('gravity_normal is world +Z', () => {
    expect(computeExplodeAxis(chainState(), 'B', 'gravity_normal')).toEqual({ x: 0, y: 0, z: 1 });
  });
  it('mate_axes points away from the mated partner', () => {
    // B at x=10 mated first to A at x=0 → direction B-A = +X.
    expect(computeExplodeAxis(chainState(), 'B', 'mate_axes')).toEqual({ x: 1, y: 0, z: 0 });
  });
  it('bbox_center points from centroid outward', () => {
    const axis = computeExplodeAxis(chainState(), 'C', 'bbox_center');
    expect(axis.x).toBeGreaterThan(0); // C is right of centroid (x=10)
  });
});

describe('computeExplodeDistance', () => {
  it('fixed parts do not move', () => {
    expect(computeExplodeDistance(chainState(), 'A', { x: 1, y: 0, z: 0 })).toBe(0);
  });
  it('uses bbox extent projected on axis', () => {
    const boxes = new Map<string, AABB>([
      ['B', aabb({ x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 })], // extent 4 on X
    ]);
    expect(computeExplodeDistance(chainState(), 'B', { x: 1, y: 0, z: 0 }, boxes)).toBeGreaterThanOrEqual(4);
  });
});

describe('orderExplodeSteps — leaf explodes first', () => {
  it('root gets the highest order, leaf order 0', () => {
    const steps = orderExplodeSteps(chainState(), new Map(), new Map());
    const order = Object.fromEntries(steps.map((s) => [s.partId, s.order]));
    // Depths: A=0 (root), B=1, C=2 → order = maxDepth-depth → C=0, B=1, A=2.
    expect(order.C).toBeLessThan(order.B);
    expect(order.B).toBeLessThan(order.A);
  });
  it('returns steps sorted ascending by order (play order)', () => {
    const steps = orderExplodeSteps(chainState(), new Map(), new Map());
    const orders = steps.map((s) => s.order);
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe('buildExplodedState', () => {
  it('does not mutate input, shifts non-fixed parts', () => {
    const state = chainState();
    const out = buildExplodedState({ state, axisHeuristic: 'gravity_normal' });
    expect(state.parts[1].position).toEqual({ x: 10, y: 0, z: 0 }); // input untouched
    const dispB = out.displacedState.parts.find((p) => p.id === 'B')!;
    expect(dispB.position.z).toBeGreaterThan(0); // pushed up +Z
  });

  it('fixed root part stays put with a degenerate trail line', () => {
    const out = buildExplodedState({ state: chainState() });
    const trailA = out.trailLines.find((t) => t.partId === 'A')!;
    expect(trailA.start).toEqual(trailA.end);
  });

  it('clearance adds to the distance', () => {
    const cfg = (clearance: number): ExplodeConfig => ({
      state: chainState(),
      axisHeuristic: 'gravity_normal',
      clearance,
    });
    const d0 = buildExplodedState(cfg(0)).steps.find((s) => s.partId === 'B')!.distance;
    const d50 = buildExplodedState(cfg(50)).steps.find((s) => s.partId === 'B')!.distance;
    expect(d50).toBeCloseTo(d0 + 50);
  });

  it('manual override forces axis + distance + order', () => {
    const out = buildExplodedState({
      state: chainState(),
      manualSteps: [{ partId: 'B', axis: { x: 0, y: 1, z: 0 }, distance: 99, order: 7 }],
    });
    const stepB = out.steps.find((s) => s.partId === 'B')!;
    expect(stepB.axis).toEqual({ x: 0, y: 1, z: 0 });
    expect(stepB.distance).toBe(99);
    expect(stepB.order).toBe(7);
  });
});

describe('interpolateExplode', () => {
  it('t=0 is the original, t=1 is fully exploded', () => {
    const state = chainState();
    const exploded = buildExplodedState({ state, axisHeuristic: 'gravity_normal' });
    const at0 = interpolateExplode(state, exploded, 0);
    const at1 = interpolateExplode(state, exploded, 1);
    const b0 = at0.parts.find((p) => p.id === 'B')!;
    const b1 = at1.parts.find((p) => p.id === 'B')!;
    expect(b0.position).toEqual({ x: 10, y: 0, z: 0 });
    expect(b1.position).toEqual(exploded.displacedState.parts.find((p) => p.id === 'B')!.position);
  });
  it('clamps t outside [0,1]', () => {
    const state = chainState();
    const exploded = buildExplodedState({ state, axisHeuristic: 'gravity_normal' });
    const over = interpolateExplode(state, exploded, 5).parts.find((p) => p.id === 'B')!;
    const at1 = interpolateExplode(state, exploded, 1).parts.find((p) => p.id === 'B')!;
    expect(over.position).toEqual(at1.position);
  });
});
