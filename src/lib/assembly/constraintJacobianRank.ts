import type { AssemblyState, PartInstance } from './assemblyState';
import type { GeometryResolver, ResolvedGeometry } from './iterativeSolver';
import type { Mate } from './mate';
import { quatMul, quatNormalize } from './mateSolver';
import { cross, dot, lengthOf, sub, type Vec3 } from '@/lib/sketch/sketchPlane';

export type ConstraintRankResult = {
  method: 'multi-component-numeric-jacobian';
  rank: number;
  dof: number;
  columns: number;
  rows: number;
  redundantRows: number;
  unsupportedMateIds: string[];
  authoritative: boolean;
};

const EPS = 1e-6;

export function analyzeConstraintRank(state: AssemblyState, resolve: GeometryResolver): ConstraintRankResult {
  const free = state.parts.filter(part => !part.fixed);
  const columns = free.length * 6;
  const base = residualVector(state, resolve);
  const unsupportedMateIds = base.unsupported;
  const matrix = Array.from({ length: base.values.length }, () => Array<number>(columns).fill(0));
  free.forEach((part, partIndex) => {
    for (let axis = 0; axis < 6; axis += 1) {
      const plus = perturbState(state, part.id, axis, EPS);
      const minus = perturbState(state, part.id, axis, -EPS);
      const rp = residualVector(plus, resolve).values;
      const rm = residualVector(minus, resolve).values;
      for (let row = 0; row < base.values.length; row += 1) matrix[row]![partIndex * 6 + axis] = (rp[row]! - rm[row]!) / (2 * EPS);
    }
  });
  const rank = matrixRank(matrix);
  return { method: 'multi-component-numeric-jacobian', rank, dof: columns - rank, columns, rows: matrix.length, redundantRows: Math.max(0, matrix.length - rank), unsupportedMateIds, authoritative: unsupportedMateIds.length === 0 };
}

function residualVector(state: AssemblyState, resolve: GeometryResolver): { values: number[]; unsupported: string[] } {
  const parts = new Map(state.parts.map(part => [part.id, part]));
  const values: number[] = [];
  const unsupported: string[] = [];
  for (const mate of state.mates) {
    if (mate.suppressed) continue;
    const a = parts.get(mate.a.partId); const b = parts.get(mate.b.partId);
    if (!a || !b) { unsupported.push(mate.id); continue; }
    const ga = resolve(mate.a, a); const gb = resolve(mate.b, b);
    const vector = ga && gb ? mateVector(mate, ga, gb) : null;
    if (!vector) unsupported.push(mate.id); else values.push(...vector);
  }
  return { values, unsupported };
}

function mateVector(mate: Mate, a: ResolvedGeometry, b: ResolvedGeometry): number[] | null {
  if ((mate.kind === 'concentric' || mate.kind === 'hinge') && a.kind === 'axis' && b.kind === 'axis') {
    const delta = sub(b.world.origin, a.world.origin);
    const align = cross(a.world.direction, b.world.direction);
    const offset = cross(delta, a.world.direction);
    return mate.kind === 'hinge' ? [...xyz(align), ...xyz(offset), dot(delta, a.world.direction)] : [...xyz(align), ...xyz(offset)];
  }
  if (mate.kind === 'coincident' && a.kind === 'point' && b.kind === 'point') return xyz(sub(b.world, a.world));
  if (mate.kind === 'coincident' && a.kind === 'plane' && b.kind === 'plane') {
    return [...xyz(cross(a.world.normal, b.world.normal)), dot(sub(b.world.origin, a.world.origin), a.world.normal)];
  }
  const da = direction(a); const db = direction(b);
  if (mate.kind === 'parallel' && da && db) return xyz(cross(da, db));
  if (mate.kind === 'perpendicular' && da && db) return [dot(da, db)];
  if (mate.kind === 'angle' && da && db) {
    const targetCos = Math.cos(mate.value * Math.PI / 180);
    // dot(a,b)-cos(theta) has a zero first derivative at 0/180 degrees,
    // causing a numeric Jacobian to miss an otherwise real clocking/alignment
    // constraint. At those singular endpoints the cross-product residual is
    // the regular local representation; existing constraints remove any
    // dependent rows during rank reduction.
    if (Math.abs(Math.abs(targetCos) - 1) <= 1e-12) {
      const dbTarget = targetCos > 0 ? db : { x: -db.x, y: -db.y, z: -db.z };
      return xyz(cross(da, dbTarget));
    }
    return [dot(da, db) - targetCos];
  }
  if (mate.kind === 'distance' && a.kind === 'point' && b.kind === 'point') return [lengthOf(sub(b.world, a.world)) - mate.value];
  if (mate.kind === 'distance' && a.kind === 'plane' && b.kind === 'plane') return [dot(sub(b.world.origin, a.world.origin), a.world.normal) - mate.value];
  return null;
}

function direction(g: ResolvedGeometry): Vec3 | null {
  return g.kind === 'axis' ? g.world.direction : g.kind === 'plane' ? g.world.normal : null;
}
function xyz(v: Vec3): number[] { return [v.x, v.y, v.z]; }

function perturbState(state: AssemblyState, partId: string, axis: number, amount: number): AssemblyState {
  return { ...state, parts: state.parts.map(part => part.id === partId ? perturbPart(part, axis, amount) : part) };
}
function perturbPart(part: PartInstance, axis: number, amount: number): PartInstance {
  if (axis < 3) {
    const key = (['x', 'y', 'z'] as const)[axis]!;
    return { ...part, position: { ...part.position, [key]: part.position[key] + amount } };
  }
  const q = { x: axis === 3 ? amount / 2 : 0, y: axis === 4 ? amount / 2 : 0, z: axis === 5 ? amount / 2 : 0, w: 1 };
  return { ...part, orientation: quatNormalize(quatMul(q, part.orientation)) };
}

function matrixRank(input: number[][]): number {
  if (!input.length || !input[0]?.length) return 0;
  const a = input.map(row => [...row]);
  const scale = Math.max(1, ...a.flat().map(Math.abs));
  const threshold = scale * 1e-7;
  let rank = 0;
  for (let col = 0; col < a[0]!.length && rank < a.length; col += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < a.length; row += 1) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    if (Math.abs(a[pivot]![col]!) <= threshold) continue;
    [a[rank], a[pivot]] = [a[pivot]!, a[rank]!];
    for (let row = rank + 1; row < a.length; row += 1) {
      const factor = a[row]![col]! / a[rank]![col]!;
      for (let c = col; c < a[0]!.length; c += 1) a[row]![c] -= factor * a[rank]![c]!;
    }
    rank += 1;
  }
  return rank;
}
