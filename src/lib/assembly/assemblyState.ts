/**
 * assemblyState — Phase 3.1 of NexyFab Pro own-CAD (ADR-013).
 *
 * Top-level assembly IR: a collection of part instances (each with an
 * initial transform) plus a list of mate constraints. The solver
 * (Phase 3.2) takes one of these and produces a new set of transforms
 * that satisfies every mate.
 *
 * Scope (Phase 3.1):
 *   - PartInstance: part-template ref + 6-DoF rigid-body transform
 *     (position + orientation as quaternion) + optional 'fixed' flag
 *     (excluded from solver — anchors the assembly in world frame).
 *   - AssemblyState: parts[] + mates[]
 *   - Validation: unique part ids, every mate references a known part,
 *     at least one part fixed (else assembly floats in space — solver
 *     would have infinite DoF).
 *   - Approximate DoF total = sum(6 × unfixed parts) - sum(mate reductions).
 *
 * Out of scope (Phase 3.x+):
 *   - Sub-assembly nesting (rigid/flexible)
 *   - Configurations / display states
 *   - Bill of materials extraction
 *   - Interference / clearance analysis (Phase 3.4)
 */

import type { Mate } from './mate';
import { validateMate, approxDofReduction } from './mate';

// ─── Quaternion (rigid-body orientation) ─────────────────────────────────

/**
 * Unit quaternion (x, y, z, w). Identity = (0, 0, 0, 1).
 * Stored separately from transform so future axis-angle / euler editors
 * can convert without touching the IR.
 */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function quat(x: number, y: number, z: number, w: number): Quat {
  return { x, y, z, w };
}

// ─── PartInstance ────────────────────────────────────────────────────────

export interface PartInstance {
  /** Unique within an AssemblyState. */
  id: string;
  /** Human-readable label shown in the assembly tree UI. */
  name: string;
  /** Reference to the part template this instance is based on. Future
   *  versions resolve this into a real PartDef; for Phase 3.1 it's an
   *  opaque string. */
  partTemplateId: string;
  /** World-frame position of the part origin. */
  position: { x: number; y: number; z: number };
  /** World-frame orientation. */
  orientation: Quat;
  /** When true the solver does not move this part. At least one part must
   *  be fixed (or the solver has infinite DoF — see validateAssembly). */
  fixed?: boolean;
}

export function partInstance(opts: Omit<PartInstance, 'fixed'> & { fixed?: boolean }): PartInstance {
  return { ...opts, fixed: opts.fixed ?? false };
}

// ─── AssemblyState ───────────────────────────────────────────────────────

export interface AssemblyState {
  parts: ReadonlyArray<PartInstance>;
  mates: ReadonlyArray<Mate>;
}

// ─── validation ──────────────────────────────────────────────────────────

export class AssemblyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssemblyValidationError';
  }
}

export function validateAssembly(state: AssemblyState): void {
  const ids = new Set<string>();
  let fixedCount = 0;
  for (const part of state.parts) {
    if (!part.id) throw new AssemblyValidationError('part instance with empty id');
    if (ids.has(part.id)) {
      throw new AssemblyValidationError(`duplicate part instance id: ${part.id}`);
    }
    ids.add(part.id);
    if (part.fixed) fixedCount += 1;
  }
  if (state.parts.length > 0 && fixedCount === 0) {
    throw new AssemblyValidationError(
      'assembly has no fixed part — would float in space; pin at least one part with fixed=true',
    );
  }
  const mateIds = new Set<string>();
  for (const mate of state.mates) {
    if (mateIds.has(mate.id)) {
      throw new AssemblyValidationError(`duplicate mate id: ${mate.id}`);
    }
    mateIds.add(mate.id);
    if (!ids.has(mate.a.partId)) {
      throw new AssemblyValidationError(
        `mate ${mate.id}: refers to unknown part ${mate.a.partId}`,
      );
    }
    if (!ids.has(mate.b.partId)) {
      throw new AssemblyValidationError(
        `mate ${mate.id}: refers to unknown part ${mate.b.partId}`,
      );
    }
    validateMate(mate);
  }
}

// ─── DoF ─────────────────────────────────────────────────────────────────

export interface AssemblyDoF {
  /** Sum of 6 × unfixed parts. */
  rawDoF: number;
  /** Sum of approxDofReduction per non-suppressed mate. */
  removedByMates: number;
  /** rawDoF - removedByMates. Can be negative (over-constrained). */
  approximate: number;
}

/**
 * Approximate degrees of freedom for the whole assembly. Heuristic — see
 * `approxDofReduction` for per-mate caveats. Phase 3.2 solver will give
 * the rank-based authoritative number.
 */
export function approximateAssemblyDoF(state: AssemblyState): AssemblyDoF {
  let raw = 0;
  for (const part of state.parts) {
    if (!part.fixed) raw += 6;
  }
  let removed = 0;
  for (const mate of state.mates) {
    if (mate.suppressed) continue;
    removed += approxDofReduction(mate);
  }
  return { rawDoF: raw, removedByMates: removed, approximate: raw - removed };
}

// ─── edit helpers ────────────────────────────────────────────────────────

export function addPart(state: AssemblyState, part: PartInstance): AssemblyState {
  if (state.parts.some((p) => p.id === part.id)) {
    throw new AssemblyValidationError(`addPart: id ${part.id} already exists`);
  }
  return { ...state, parts: [...state.parts, part] };
}

export function removePart(state: AssemblyState, partId: string): AssemblyState {
  if (!state.parts.some((p) => p.id === partId)) {
    throw new AssemblyValidationError(`removePart: id ${partId} not found`);
  }
  // Reject if any mate still references this part.
  for (const mate of state.mates) {
    if (mate.a.partId === partId || mate.b.partId === partId) {
      throw new AssemblyValidationError(
        `removePart: part ${partId} is referenced by mate ${mate.id} — remove mate first`,
      );
    }
  }
  return { ...state, parts: state.parts.filter((p) => p.id !== partId) };
}

export function addMate(state: AssemblyState, mate: Mate): AssemblyState {
  if (state.mates.some((m) => m.id === mate.id)) {
    throw new AssemblyValidationError(`addMate: id ${mate.id} already exists`);
  }
  // Tentatively validate by running validateAssembly on a candidate.
  const candidate: AssemblyState = { ...state, mates: [...state.mates, mate] };
  validateAssembly(candidate);
  return candidate;
}

export function removeMate(state: AssemblyState, mateId: string): AssemblyState {
  if (!state.mates.some((m) => m.id === mateId)) {
    throw new AssemblyValidationError(`removeMate: id ${mateId} not found`);
  }
  return { ...state, mates: state.mates.filter((m) => m.id !== mateId) };
}

export function setPartFixed(
  state: AssemblyState,
  partId: string,
  fixed: boolean,
): AssemblyState {
  const idx = state.parts.findIndex((p) => p.id === partId);
  if (idx < 0) throw new AssemblyValidationError(`setPartFixed: ${partId} not found`);
  const parts = state.parts.slice();
  parts[idx] = { ...parts[idx]!, fixed };
  return { ...state, parts };
}
