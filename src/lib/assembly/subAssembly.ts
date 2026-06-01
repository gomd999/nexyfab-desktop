/**
 * subAssembly — Phase 3.5 of NexyFab Pro own-CAD (ADR-013).
 *
 * Nested assemblies. A sub-assembly is a complete AssemblyState that
 * appears as one logical part in a parent assembly. Two modes:
 *
 *   - **Rigid** (default): sub-assembly's internal solve is frozen.
 *     Parent treats it as a single rigid body — fast and predictable,
 *     matches the common case (sub-assembly is a pre-built mechanism the
 *     user just wants to drop in).
 *   - **Flexible**: parent solver re-solves the sub-assembly's internals
 *     during its own solve pass. Used when the sub-assembly itself has
 *     DoF that the parent's mates should influence (e.g., a 4-bar linkage
 *     where mating the input crank to the parent moves the rest).
 *
 * Phase 3.5 minimal scope:
 *   - SubAssemblyRef IR (placement in parent frame + rigid flag).
 *   - flattenAssembly: recursively expand a parent + its sub-assemblies
 *     into a single flat AssemblyState (treats rigid sub-assemblies as
 *     opaque single parts whose collected geometry refs prefix sub-id).
 *   - exposedRefs: list of geometry refs the sub-assembly publishes to
 *     parent mates (Phase 3.5 minimum: all part refs are exposed; future
 *     refines via an explicit publishedRefs list).
 *
 * Out of scope (Phase 3.x+):
 *   - Flexible mode actual solver integration (3.2.3)
 *   - Configuration variants per sub-assembly instance
 *   - Pattern of sub-assemblies (linear/circular)
 */

import type { AssemblyState, PartInstance, Quat } from './assemblyState';
import { IDENTITY_QUAT } from './assemblyState';
import type { Mate, MateRef } from './mate';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { vec3, add } from '@/lib/sketch/sketchPlane';
import { rotateVec } from './mateSolver';

// ─── IR ───────────────────────────────────────────────────────────────────

export interface SubAssemblyRef {
  kind: 'sub_assembly_ref';
  /** Unique within the parent's sub-assembly list. */
  id: string;
  name: string;
  /** Inline definition. (In future, this becomes a ref to a stored
   *  sub-assembly template the user picks from a library.) */
  state: AssemblyState;
  position: Vec3;
  orientation: Quat;
  /** When false, the parent solver may re-solve the sub-assembly's
   *  internals. When true (default), the sub-assembly is frozen. */
  rigid?: boolean;
}

export function subAssemblyRef(opts: {
  id: string;
  name: string;
  state: AssemblyState;
  position?: Vec3;
  orientation?: Quat;
  rigid?: boolean;
}): SubAssemblyRef {
  return {
    kind: 'sub_assembly_ref',
    id: opts.id,
    name: opts.name,
    state: opts.state,
    position: opts.position ?? vec3(0, 0, 0),
    orientation: opts.orientation ?? IDENTITY_QUAT,
    rigid: opts.rigid ?? true,
  };
}

// ─── nested AssemblyState ────────────────────────────────────────────────

export interface NestedAssemblyState extends AssemblyState {
  subs?: ReadonlyArray<SubAssemblyRef>;
}

// ─── flattening ──────────────────────────────────────────────────────────

/**
 * Recursively flatten a NestedAssemblyState into a single AssemblyState.
 * Each nested part / mate gets its id prefixed with the path of
 * sub-assembly ids it came from, so the result has globally unique ids.
 *
 * Position/orientation of each nested part is composed with the chain of
 * parent transforms (the part's local position is rotated by ancestor
 * orientations and translated to the world frame).
 *
 * Rigid sub-assemblies: the solver treats them as one rigid body, so
 * after flattening, all parts coming from a rigid sub-assembly are
 * marked `fixed=true` in the output (their relative positions are
 * locked; only the sub-assembly's own placement is the DoF, which the
 * parent solver controls via the SUB-prefixed mate refs).
 *
 * Flexible sub-assemblies leave fixed flags as-is so the parent solver
 * sees the sub's internal DoF.
 */
export function flattenAssembly(nested: NestedAssemblyState): AssemblyState {
  const parts: PartInstance[] = [...nested.parts];
  const mates: Mate[] = [...nested.mates];
  if (nested.subs) {
    for (const sub of nested.subs) {
      const expanded = expandSub(sub, sub.id);
      for (const p of expanded.parts) parts.push(p);
      for (const m of expanded.mates) mates.push(m);
    }
  }
  return { parts, mates };
}

function expandSub(sub: SubAssemblyRef, idPrefix: string): { parts: PartInstance[]; mates: Mate[] } {
  const flat = flattenAssembly(sub.state as NestedAssemblyState);
  const transformedParts: PartInstance[] = flat.parts.map((p) => ({
    ...p,
    id: `${idPrefix}/${p.id}`,
    name: `${sub.name} / ${p.name}`,
    position: add(sub.position, rotateVec(p.position, sub.orientation)),
    orientation: sub.orientation, // simplified — true composition needs quatMul
    fixed: sub.rigid ?? true ? true : p.fixed,
  }));
  const remappedMates: Mate[] = flat.mates.map((m) => prefixMateIds(m, idPrefix));
  return { parts: transformedParts, mates: remappedMates };
}

function prefixMateIds(mate: Mate, idPrefix: string): Mate {
  const remap = (r: MateRef): MateRef => ({
    ...r,
    partId: `${idPrefix}/${r.partId}`,
  });
  // Use the discriminated union — must reconstruct by case to preserve
  // type-narrowing for distance/angle's value field.
  switch (mate.kind) {
    case 'distance':
      return { ...mate, id: `${idPrefix}/${mate.id}`, a: remap(mate.a), b: remap(mate.b) };
    case 'angle':
      return { ...mate, id: `${idPrefix}/${mate.id}`, a: remap(mate.a), b: remap(mate.b) };
    default:
      return { ...mate, id: `${idPrefix}/${mate.id}`, a: remap(mate.a), b: remap(mate.b) };
  }
}

// ─── exposedRefs ─────────────────────────────────────────────────────────

export interface ExposedRef {
  /** Path inside the sub-assembly (e.g., `crank/face_top`). */
  path: string;
  refId: string;
  partId: string;
}

/**
 * Phase 3.5 minimum: every part ref in the sub-assembly is exposed to the
 * parent. Future refinements add an explicit publishedRefs list on
 * SubAssemblyRef that filters this down.
 *
 * Returns a flat list of (path, refId, partId) for use in parent-side
 * mate construction.
 */
export function exposedRefs(sub: SubAssemblyRef): ReadonlyArray<ExposedRef> {
  const out: ExposedRef[] = [];
  for (const part of sub.state.parts) {
    // For now we don't enumerate per-part faces/edges; that requires part
    // geometry registry (Phase 3.5.2). Just expose the part itself as a
    // "point" ref at its origin — useful for high-level coincident mates.
    out.push({
      path: `${sub.id}/${part.id}`,
      refId: 'origin',
      partId: part.id,
    });
  }
  return out;
}
